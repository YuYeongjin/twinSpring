package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dao.BimDAO;
import yyj.project.twinspring.dto.BimElementColorDTO;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimLayerDTO;
import yyj.project.twinspring.dto.BimProjectDTO;
import yyj.project.twinspring.service.BimService;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class BimServiceImpl implements BimService {

    private static final Logger log = LoggerFactory.getLogger(BimServiceImpl.class);

    private final WebClient webClient;
    private final BimDAO bimDAO;

    @Autowired
    private ObjectMapper objectMapper;

    public BimServiceImpl(WebClient webClient, BimDAO bimDAO) {
        this.webClient = webClient;
        this.bimDAO = bimDAO;
    }

    // ── JSON 변환 헬퍼 ─────────────────────────────────────────────

    private List<String> parseIds(Object obj) {
        if (obj == null) return new ArrayList<>();
        String json = obj.toString().trim();
        if (json.isEmpty() || json.equals("null")) return new ArrayList<>();
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private String toJson(List<String> list) {
        if (list == null) return "[]";
        try {
            return objectMapper.writeValueAsString(list);
        } catch (Exception e) {
            return "[]";
        }
    }

    private BimLayerDTO rowToLayer(Map<String, Object> row) {
        BimLayerDTO dto = new BimLayerDTO();
        dto.setLayerId((String) row.get("layerId"));
        dto.setProjectId((String) row.get("projectId"));
        dto.setLayerName((String) row.get("layerName"));
        dto.setColor((String) row.get("color"));
        Object vis = row.get("visible");
        dto.setVisible(vis != null && (Boolean.TRUE.equals(vis) || "1".equals(vis.toString()) || (vis instanceof Number && ((Number) vis).intValue() == 1)));
        dto.setElementIds(parseIds(row.get("elementIds")));
        Object order = row.get("sortOrder");
        dto.setSortOrder(order instanceof Number ? ((Number) order).intValue() : 0);
        return dto;
    }

    @Override
    public Mono<String> getModelData(String projectId) {
        log.debug("C# 서버 모델 요청: projectId={}", projectId);
        return webClient.get()
                .uri("/api/bim/model/{projectId}", projectId)
                .retrieve()
                .bodyToMono(String.class)
                .doOnError(e -> log.error("C# 서버 통신 오류: {}", e.getMessage()));
    }

    @Override
    public Mono<List<BimProjectDTO>> getProjectList() {
        log.debug("C# 서버 프로젝트 목록 요청");
        return webClient.get()
                .uri("/api/bim/projects")
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse ->
                        Mono.error(new RuntimeException("C# Server Error: " + clientResponse.statusCode())))
                .bodyToFlux(BimProjectDTO.class)
                .collectList();
    }

    @Override
    public ResponseEntity<Mono<List<BimElementDTO>>> getModelElements(String projectId) {
        log.debug("getModelElements: projectId={}", projectId);
        return ResponseEntity.ok(
                webClient.get()
                        .uri("/api/bim/projects")
                        .retrieve()
                        .bodyToFlux(BimElementDTO.class)
                        .collectList());
    }

    @Override
    public ResponseEntity<Mono<Void>> deleteProject(String projectId) {
        return ResponseEntity.ok(
                webClient.delete()
                        .uri("/api/bim/project/{projectId}", projectId)
                        .retrieve()
                        .bodyToMono(Void.class));
    }

    @Override
    public ResponseEntity<Mono<Void>> updateElement(BimElementDTO element) {
        log.debug("Element 수정 요청: {}", element);
        return ResponseEntity.ok(
                webClient.put()
                        .uri("/api/bim/element")
                        .bodyValue(element)
                        .retrieve()
                        .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(), clientResponse -> {
                            log.error("C# Element 업데이트 실패: {}", clientResponse.statusCode());
                            return Mono.error(new RuntimeException("C# Element update failed: " + clientResponse.statusCode()));
                        })
                        .bodyToMono(Void.class));
    }

    @Override
    public Mono<ResponseEntity<Void>> newProject(String category) {
        // TODO: 카테고리별 프로젝트 생성 로직 구현 필요
        throw new UnsupportedOperationException("newProject(category) is not yet implemented");
    }

    @Override
    public Mono<BimProjectDTO> createProject(BimProjectDTO project) {
        String projectId = "P-" + UUID.randomUUID().toString().substring(0, 5);
        project.setProjectId(projectId);
        log.info("프로젝트 생성 요청: {}", project);

        return webClient.post()
                .uri("/api/bim/project")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(project)
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse -> {
                    log.error("C# 프로젝트 생성 실패: {}", clientResponse.statusCode());
                    return Mono.error(new RuntimeException("C# Project creation failed."));
                })
                .bodyToMono(BimProjectDTO.class);
    }

    @Override
    public ResponseEntity<Mono<List<BimElementDTO>>> getProject(String projectId) {
        log.debug("프로젝트 요소 조회: projectId={}", projectId);
        ParameterizedTypeReference<List<BimElementDTO>> typeRef = new ParameterizedTypeReference<>() {};
        Mono<List<BimElementDTO>> responseBodyMono = webClient.get()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(typeRef);
        return ResponseEntity.ok(responseBodyMono);
    }

    /**
     * 단일 부재 신규 생성
     * C# POST /api/bim/element 로 전달, 생성된 부재(elementId 포함)를 반환
     * Revit의 "부재 배치" 기능에 해당
     */
    @Override
    public Mono<BimElementDTO> createElement(BimElementDTO element) {
        // elementId가 없으면 Spring에서 자동 생성 (에이전트 경유 시에도 보장)
        if (element.getElementId() == null || element.getElementId().isBlank()) {
            element.setElementId("ELEM-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        }
        log.info("부재 생성 요청: type={}, projectId={}, elementId={}", element.getElementType(), element.getProjectId(), element.getElementId());
        return webClient.post()
                .uri("/api/bim/element")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(element)
                .retrieve()
                .onStatus(status -> status.isError(), response -> {
                    log.error("C# 부재 생성 실패: {}", response.statusCode());
                    return Mono.error(new RuntimeException("C# element creation failed"));
                })
                .bodyToMono(BimElementDTO.class);
    }

    // 타입별 기본 크기 (X, Y, Z) 단위: m  — bim_builder.py의 _DEFAULT_SIZES와 동일하게 유지
    private static final java.util.Map<String, double[]> DEFAULT_SIZES = java.util.Map.of(
            "IfcColumn", new double[]{0.5, 3.0, 0.5},
            "IfcBeam",   new double[]{5.0, 0.4, 0.4},
            "IfcWall",   new double[]{5.0, 3.0, 0.2},
            "IfcSlab",   new double[]{5.0, 0.2, 5.0},
            "IfcPier",   new double[]{1.0, 5.0, 1.0}
    );

    /**
     * 특정 좌표에 부재 생성
     * elementType별 기본 크기를 적용하여 C# POST /api/bim/element 호출
     */
    @Override
    public Mono<BimElementDTO> createElementAt(String projectId, String elementType, String material,
                                               double x, double y, double z) {
        double[] size = DEFAULT_SIZES.getOrDefault(elementType, new double[]{0.5, 3.0, 0.5});

        BimElementDTO element = new BimElementDTO();
        element.setProjectId(projectId);
        element.setElementType(elementType);
        element.setMaterial(material != null ? material : "Concrete");
        element.setPositionX(x);
        element.setPositionY(y);
        element.setPositionZ(z);
        element.setSizeX(size[0]);
        element.setSizeY(size[1]);
        element.setSizeZ(size[2]);

        log.info("좌표 지정 부재 생성: type={}, pos=({},{},{}), projectId={}", elementType, x, y, z, projectId);
        return createElement(element);
    }

    /**
     * 복합 구조물 배치 생성
     * 교각·골조 등 다수 부재를 순차적으로 C# 서버에 생성 요청
     */
    @Override
    public Mono<List<BimElementDTO>> createElements(List<BimElementDTO> elements) {
        log.info("배치 부재 생성 요청: {}개", elements.size());
        return Flux.fromIterable(elements)
                .concatMap(this::createElement)   // 순차 처리로 C# 서버 부하 방지
                .collectList();
    }

    /**
     * 단일 부재 삭제
     * C# DELETE /api/bim/element/{elementId} 로 전달
     * Revit의 Delete 키 삭제에 해당
     */
    @Override
    public ResponseEntity<Mono<Void>> deleteElement(String elementId) {
        log.info("부재 삭제 요청: elementId={}", elementId);
        return ResponseEntity.ok(
                webClient.delete()
                        .uri("/api/bim/element/{elementId}", elementId)
                        .retrieve()
                        .onStatus(status -> status.isError(), response -> {
                            log.error("C# 부재 삭제 실패: elementId={}, status={}", elementId, response.statusCode());
                            return Mono.error(new RuntimeException("C# element delete failed"));
                        })
                        .bodyToMono(Void.class));
    }

    @Override
    public List<BimLayerDTO> getLayersByProject(String projectId) {
        return List.of();
    }

    @Override
    public BimLayerDTO createLayer(BimLayerDTO layer) {
        return null;
    }

    @Override
    public BimLayerDTO updateLayer(BimLayerDTO layer) {
        return null;
    }

    @Override
    public void deleteLayer(String layerId) {

    }

    @Override
    public List<BimElementColorDTO> getColorsByProject(String projectId) {
        return List.of();
    }

    @Override
    public void upsertColor(BimElementColorDTO colorDTO) {

    }

    @Override
    public void deleteColor(String elementId) {

    }
}