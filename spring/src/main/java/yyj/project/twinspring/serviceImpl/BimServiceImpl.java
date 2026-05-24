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
import yyj.project.twinspring.dto.BimLineDTO;
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
        return bimDAO.getLayersByProject(projectId).stream()
                .map(this::rowToLayer)
                .collect(Collectors.toList());
    }

    @Override
    public BimLayerDTO createLayer(BimLayerDTO layer) {
        if (layer.getLayerId() == null || layer.getLayerId().isBlank()) {
            layer.setLayerId("layer-" + UUID.randomUUID().toString().substring(0, 8));
        }
        if (layer.getVisible() == null) layer.setVisible(true);
        if (layer.getSortOrder() == null) layer.setSortOrder(0);

        Map<String, Object> params = new HashMap<>();
        params.put("layerId",    layer.getLayerId());
        params.put("projectId",  layer.getProjectId());
        params.put("layerName",  layer.getLayerName());
        params.put("color",      layer.getColor());
        params.put("visible",    layer.getVisible());
        params.put("elementIds", toJson(layer.getElementIds() != null ? layer.getElementIds() : new ArrayList<>()));
        params.put("sortOrder",  layer.getSortOrder());
        bimDAO.insertLayer(params);
        return layer;
    }

    @Override
    public BimLayerDTO updateLayer(BimLayerDTO layer) {
        Map<String, Object> params = new HashMap<>();
        params.put("layerId",    layer.getLayerId());
        params.put("layerName",  layer.getLayerName());
        params.put("color",      layer.getColor());
        params.put("visible",    layer.getVisible() != null ? layer.getVisible() : true);
        params.put("elementIds", toJson(layer.getElementIds() != null ? layer.getElementIds() : new ArrayList<>()));
        params.put("sortOrder",  layer.getSortOrder() != null ? layer.getSortOrder() : 0);
        bimDAO.updateLayer(params);
        return layer;
    }

    @Override
    public void deleteLayer(String layerId) {
        bimDAO.deleteLayer(layerId);
    }

    @Override
    public List<BimElementColorDTO> getColorsByProject(String projectId) {
        return bimDAO.getColorsByProject(projectId).stream()
                .map(row -> {
                    BimElementColorDTO dto = new BimElementColorDTO();
                    dto.setElementId((String) row.get("elementId"));
                    dto.setProjectId((String) row.get("projectId"));
                    dto.setColor((String) row.get("color"));
                    return dto;
                })
                .collect(Collectors.toList());
    }

    @Override
    public void upsertColor(BimElementColorDTO colorDTO) {
        Map<String, Object> params = new HashMap<>();
        params.put("elementId", colorDTO.getElementId());
        params.put("projectId", colorDTO.getProjectId());
        params.put("color",     colorDTO.getColor());
        bimDAO.upsertColor(params);
    }

    @Override
    public void deleteColor(String elementId) {
        bimDAO.deleteColor(elementId);
    }

    // ── 선 CRUD ────────────────────────────────────────────────────

    @Override
    public List<BimLineDTO> getLinesByProject(String projectId) {
        return bimDAO.getLinesByProject(projectId).stream()
                .map(row -> {
                    BimLineDTO dto = new BimLineDTO();
                    dto.setLineId((String) row.get("lineId"));
                    dto.setProjectId((String) row.get("projectId"));
                    dto.setStartX(toDouble(row.get("startX")));
                    dto.setStartY(toDouble(row.get("startY")));
                    dto.setStartZ(toDouble(row.get("startZ")));
                    dto.setEndX(toDouble(row.get("endX")));
                    dto.setEndY(toDouble(row.get("endY")));
                    dto.setEndZ(toDouble(row.get("endZ")));
                    dto.setColor((String) row.getOrDefault("color", "#60a5fa"));
                    dto.setLineWidth(toDouble(row.getOrDefault("lineWidth", 2.0)));
                    dto.setPointsJson((String) row.get("pointsJson"));
                    Object closed = row.get("closed");
                    dto.setClosed(closed != null && (closed.equals(true) || closed.equals(1) || "1".equals(closed.toString())));
                    dto.setShapeHeight(toDouble(row.getOrDefault("shapeHeight", 0.0)));
                    return dto;
                })
                .collect(Collectors.toList());
    }

    @Override
    public BimLineDTO createLine(BimLineDTO line) {
        if (line.getLineId() == null || line.getLineId().isBlank()) {
            line.setLineId("line-" + UUID.randomUUID().toString().substring(0, 12));
        }
        bimDAO.insertLine(buildLineParams(line));
        return line;
    }

    @Override
    public List<BimLineDTO> createLinesBatch(List<BimLineDTO> lines) {
        if (lines == null || lines.isEmpty()) return List.of();
        for (BimLineDTO line : lines) {
            if (line.getLineId() == null || line.getLineId().isBlank()) {
                line.setLineId("line-" + UUID.randomUUID().toString().substring(0, 12));
            }
        }
        List<Map<String, Object>> params = lines.stream()
                .map(this::buildLineParams)
                .collect(Collectors.toList());
        bimDAO.insertLinesBatch(params);
        return lines;
    }

    @Override
    public BimLineDTO updateLine(BimLineDTO line) {
        bimDAO.updateLine(buildLineParams(line));
        return line;
    }

    private Map<String, Object> buildLineParams(BimLineDTO line) {
        Map<String, Object> params = new HashMap<>();
        params.put("lineId",      line.getLineId());
        params.put("projectId",   line.getProjectId());
        params.put("startX",      line.getStartX());
        params.put("startY",      line.getStartY());
        params.put("startZ",      line.getStartZ());
        params.put("endX",        line.getEndX());
        params.put("endY",        line.getEndY());
        params.put("endZ",        line.getEndZ());
        params.put("color",       line.getColor() != null ? line.getColor() : "#60a5fa");
        params.put("lineWidth",   line.getLineWidth() > 0 ? line.getLineWidth() : 2.0);
        params.put("pointsJson",  line.getPointsJson());
        params.put("closed",      line.isClosed());
        params.put("shapeHeight", line.getShapeHeight());
        return params;
    }

    @Override
    public void deleteLine(String lineId) {
        bimDAO.deleteLine(lineId);
    }

    @Override
    public void deleteLinesByProject(String projectId) {
        bimDAO.deleteLinesByProject(projectId);
    }

    private double toDouble(Object val) {
        if (val == null) return 0.0;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (NumberFormatException e) { return 0.0; }
    }

    // ── 프로젝트 이름 수정 ─────────────────────────────────────────

    @Override
    public Mono<BimProjectDTO> renameProject(String projectId, String newName) {
        // 1) 로컬 MariaDB 업데이트
        Map<String, Object> params = new HashMap<>();
        params.put("projectId",   projectId);
        params.put("projectName", newName);
        try {
            bimDAO.updateProjectName(params);
            log.info("로컬 DB 프로젝트 이름 수정: projectId={}, newName={}", projectId, newName);
        } catch (Exception e) {
            log.warn("로컬 DB 이름 수정 실패 (무시): {}", e.getMessage());
        }

        // 2) C# 서버에도 이름 수정 요청 (best-effort)
        BimProjectDTO patchBody = new BimProjectDTO();
        patchBody.setProjectId(projectId);
        patchBody.setProjectName(newName);

        return webClient.put()
                .uri("/api/bim/project/{projectId}/name", projectId)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(patchBody)
                .retrieve()
                .bodyToMono(BimProjectDTO.class)
                .onErrorResume(e -> {
                    log.warn("C# 서버 이름 수정 실패 (무시): {}", e.getMessage());
                    // C# 실패 시 로컬 DB 결과를 반환
                    BimProjectDTO fallback = new BimProjectDTO();
                    fallback.setProjectId(projectId);
                    fallback.setProjectName(newName);
                    return Mono.just(fallback);
                });
    }

    // ── BIM 통계 / 내보내기 ────────────────────────────────────────

    @Override
    public List<BimProjectDTO> getBimProjectsFromDb() {
        return bimDAO.getAllProjects().stream()
                .map(row -> {
                    BimProjectDTO dto = new BimProjectDTO();
                    dto.setProjectId((String) row.get("projectId"));
                    dto.setProjectName((String) row.get("projectName"));
                    dto.setStructureType((String) row.get("structureType"));
                    dto.setSpanCount((String) row.get("spanCount"));
                    return dto;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getBimElementStats(String projectId) {
        return bimDAO.getElementStatsByProject(projectId);
    }

    @Override
    public String exportBimElementsCsv(String projectId) {
        List<Map<String, Object>> rows = bimDAO.getElementsByProject(projectId);
        StringBuilder sb = new StringBuilder();
        sb.append("elementId,elementType,material,positionX,positionY,positionZ,sizeX,sizeY,sizeZ,rotationX,rotationY,rotationZ\n");
        for (Map<String, Object> row : rows) {
            sb.append(row.getOrDefault("elementId", "")).append(",");
            sb.append(row.getOrDefault("elementType", "")).append(",");
            sb.append(row.getOrDefault("material", "")).append(",");
            sb.append(row.getOrDefault("positionX", "")).append(",");
            sb.append(row.getOrDefault("positionY", "")).append(",");
            sb.append(row.getOrDefault("positionZ", "")).append(",");
            sb.append(row.getOrDefault("sizeX", "")).append(",");
            sb.append(row.getOrDefault("sizeY", "")).append(",");
            sb.append(row.getOrDefault("sizeZ", "")).append(",");
            sb.append(row.getOrDefault("rotationX", "")).append(",");
            sb.append(row.getOrDefault("rotationY", "")).append(",");
            sb.append(row.getOrDefault("rotationZ", "")).append("\n");
        }
        return sb.toString();
    }
}