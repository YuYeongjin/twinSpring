package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
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
import yyj.project.twinspring.dto.BimStoreyDTO;
import yyj.project.twinspring.dto.BimWbsNodeDTO;
import yyj.project.twinspring.service.BimService;
import yyj.project.twinspring.storage.StorageException;
import yyj.project.twinspring.storage.StorageService;

import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class BimServiceImpl implements BimService {

    private static final Logger log = LoggerFactory.getLogger(BimServiceImpl.class);

    private final WebClient webClient;
    private final WebClient agentWebClient;
    private final WebClient ollamaWebClient;
    private final BimDAO bimDAO;
    private final StorageService storageService;

    @Autowired
    private ObjectMapper objectMapper;

    @Value("${ollama.model:qwen2.5:3b}")
    private String ollamaModel;

    public BimServiceImpl(WebClient webClient,
                          @org.springframework.beans.factory.annotation.Qualifier("agentWebClient") WebClient agentWebClient,
                          @org.springframework.beans.factory.annotation.Qualifier("ollamaWebClient") WebClient ollamaWebClient,
                          BimDAO bimDAO, StorageService storageService) {
        this.webClient = webClient;
        this.agentWebClient = agentWebClient;
        this.ollamaWebClient = ollamaWebClient;
        this.bimDAO = bimDAO;
        this.storageService = storageService;
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
        dto.setParentLayerId((String) row.get("parentLayerId"));
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
        // 로컬 PostgreSQL에서 조회 (glbStorageKey 등 로컬 전용 필드 포함)
        return Mono.fromCallable(this::getBimProjectsFromDb)
                .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic());
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
        // storage_key를 미리 조회해 두어야 C# 삭제 후에도 사용 가능
        String storageKey = getStorageKey(projectId);

        Mono<Void> deleteMono = webClient.delete()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(Void.class)
                .onErrorResume(e -> {
                    log.warn("[BIM] C# 서버 프로젝트 삭제 실패 — 로컬만 정리: projectId={}, {}", projectId, e.getMessage());
                    return Mono.empty();
                })
                .doOnSuccess(v -> {
                    // FK 순서: 매핑 → 부재 → Layer/Color/Line → bim_project
                    // (bim_storey/bim_wbs_node 는 bim_project ON DELETE CASCADE 로 자동 삭제)
                    try {
                        bimDAO.deleteElementWbsMappingsByProject(projectId);
                        bimDAO.deleteElementsByProject(projectId);
                        bimDAO.deleteLayersByProject(projectId);
                        bimDAO.deleteColorsByProject(projectId);
                        bimDAO.deleteLinesByProject(projectId);
                        bimDAO.deleteProjectById(projectId);
                    } catch (Exception e) {
                        log.warn("[BIM] 프로젝트 로컬 리소스 정리 실패: projectId={}, {}", projectId, e.getMessage());
                    }
                    // Object Storage 파일 삭제
                    if (storageKey != null) {
                        try {
                            storageService.delete(storageKey);
                            log.info("[BIM] IFC 원본 파일 삭제 완료: projectId={}, key={}", projectId, storageKey);
                        } catch (Exception e) {
                            log.warn("[BIM] IFC 원본 파일 삭제 실패(무시): projectId={}, key={}, {}", projectId, storageKey, e.getMessage());
                        }
                    }
                });

        return ResponseEntity.ok(deleteMono);
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
                .bodyToMono(BimProjectDTO.class)
                .doOnSuccess(created -> {
                    // C# 성공 후 PostgreSQL에도 동기화 (geoOrigin 포함)
                    try {
                        Map<String, Object> params = new HashMap<>();
                        params.put("projectId",     created != null && created.getProjectId() != null ? created.getProjectId() : projectId);
                        params.put("projectName",   project.getProjectName());
                        params.put("structureType", project.getStructureType());
                        params.put("geoLatitude",   project.getGeoLatitude());
                        params.put("geoLongitude",  project.getGeoLongitude());
                        params.put("geoElevation",  project.getGeoElevation());
                        params.put("ifcOffsetX",    project.getIfcOffsetX());
                        params.put("ifcOffsetY",    project.getIfcOffsetY());
                        params.put("ifcOffsetZ",    project.getIfcOffsetZ());
                        params.put("ifcScale",      project.getIfcScale());
                        bimDAO.insertProject(params);
                        log.info("PostgreSQL project 동기화 완료: projectId={}, lat={}, lng={}",
                                params.get("projectId"), params.get("geoLatitude"), params.get("geoLongitude"));
                    } catch (Exception e) {
                        log.warn("PostgreSQL project 동기화 실패 (무시): {}", e.getMessage());
                    }
                });
    }

    @Override
    public ResponseEntity<Mono<List<BimElementDTO>>> getProject(String projectId) {
        log.debug("프로젝트 요소 조회: projectId={}", projectId);
        ParameterizedTypeReference<List<BimElementDTO>> typeRef = new ParameterizedTypeReference<>() {};
        Mono<List<BimElementDTO>> responseBodyMono = webClient.get()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(typeRef)
                .onErrorResume(e -> {
                    log.warn("C# BIM 서버 연결 실패 — 로컬 DB 요소로 폴백: projectId={}, err={}", projectId, e.getMessage());
                    return Mono.fromCallable(() -> elementsFromDb(projectId));
                });
        return ResponseEntity.ok(responseBodyMono);
    }

    /** C# 서버 미구동 시 PostgreSQL 에서 요소 목록 조회 (로컬 개발 폴백용) */
    private List<BimElementDTO> elementsFromDb(String projectId) {
        return bimDAO.getElementsByProject(projectId).stream()
                .map(row -> {
                    BimElementDTO dto = new BimElementDTO();
                    dto.setElementId(row.get("elementId") == null ? null : row.get("elementId").toString());
                    dto.setProjectId(row.get("projectId") == null ? null : row.get("projectId").toString());
                    dto.setElementType(row.get("elementType") == null ? null : row.get("elementType").toString());
                    dto.setMaterial(row.get("material") == null ? null : row.get("material").toString());
                    dto.setPositionX(row.get("positionX") == null ? null : toDouble(row.get("positionX")));
                    dto.setPositionY(row.get("positionY") == null ? null : toDouble(row.get("positionY")));
                    dto.setPositionZ(row.get("positionZ") == null ? null : toDouble(row.get("positionZ")));
                    dto.setSizeX(row.get("sizeX") == null ? null : toDouble(row.get("sizeX")));
                    dto.setSizeY(row.get("sizeY") == null ? null : toDouble(row.get("sizeY")));
                    dto.setSizeZ(row.get("sizeZ") == null ? null : toDouble(row.get("sizeZ")));
                    dto.setRotationX(row.get("rotationX") == null ? null : toDouble(row.get("rotationX")));
                    dto.setRotationY(row.get("rotationY") == null ? null : toDouble(row.get("rotationY")));
                    dto.setRotationZ(row.get("rotationZ") == null ? null : toDouble(row.get("rotationZ")));
                    dto.setIfcWorldX(row.get("ifcWorldX") == null ? null : toDouble(row.get("ifcWorldX")));
                    dto.setIfcWorldY(row.get("ifcWorldY") == null ? null : toDouble(row.get("ifcWorldY")));
                    dto.setIfcWorldZ(row.get("ifcWorldZ") == null ? null : toDouble(row.get("ifcWorldZ")));
                    dto.setStorey(row.get("storey") == null ? null : row.get("storey").toString());
                    dto.setBuilding(row.get("building") == null ? null : row.get("building").toString());
                    return dto;
                })
                .collect(Collectors.toList());
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
        // C# 삭제 전에 WBS 매핑 조회 (삭제 후엔 row가 사라지므로)
        String wbsId = bimDAO.getWbsIdByElement(elementId);
        Mono<Void> deleteMono = webClient.delete()
                .uri("/api/bim/element/{elementId}", elementId)
                .retrieve()
                .onStatus(status -> status.isError(), response -> {
                    log.error("C# 부재 삭제 실패: elementId={}, status={}", elementId, response.statusCode());
                    return Mono.error(new RuntimeException("C# element delete failed"));
                })
                .bodyToMono(Void.class)
                .doOnSuccess(v -> {
                    bimDAO.deleteElementWbsMapping(elementId);
                    bimDAO.deleteElementById(elementId);
                    if (wbsId != null) {
                        bimDAO.decrementWbsElementCount(wbsId);
                        log.info("BIM WBS count 감소: wbsId={}, elementId={}", wbsId, elementId);
                    }
                });
        return ResponseEntity.ok(deleteMono);
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
        params.put("layerId",       layer.getLayerId());
        params.put("projectId",     layer.getProjectId());
        params.put("parentLayerId", layer.getParentLayerId());
        params.put("layerName",     layer.getLayerName());
        params.put("color",         layer.getColor());
        params.put("visible",       layer.getVisible());
        params.put("elementIds",    toJson(layer.getElementIds() != null ? layer.getElementIds() : new ArrayList<>()));
        params.put("sortOrder",     layer.getSortOrder());
        bimDAO.insertLayer(params);
        return layer;
    }

    @Override
    public void createLayersBatch(List<BimLayerDTO> layers) {
        if (layers == null || layers.isEmpty()) return;
        List<Map<String, Object>> params = layers.stream()
                .map(layer -> {
                    if (layer.getLayerId() == null || layer.getLayerId().isBlank()) {
                        layer.setLayerId("layer-" + UUID.randomUUID().toString().substring(0, 8));
                    }
                    if (layer.getVisible() == null) layer.setVisible(true);
                    if (layer.getSortOrder() == null) layer.setSortOrder(0);
                    Map<String, Object> p = new HashMap<>();
                    p.put("layerId",       layer.getLayerId());
                    p.put("projectId",     layer.getProjectId());
                    p.put("parentLayerId", layer.getParentLayerId());
                    p.put("layerName",     layer.getLayerName());
                    p.put("color",         layer.getColor());
                    p.put("visible",       layer.getVisible());
                    p.put("elementIds",    toJson(layer.getElementIds() != null ? layer.getElementIds() : new ArrayList<>()));
                    p.put("sortOrder",     layer.getSortOrder());
                    return p;
                })
                .collect(Collectors.toList());
        bimDAO.insertLayersBatch(params);
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
                    String lineType = (String) row.get("lineType");
                    dto.setLineType(lineType != null ? lineType : "line");
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
        params.put("lineType",    line.getLineType() != null ? line.getLineType() : "line");
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
                    dto.setGeoLatitude(row.get("geoLatitude") == null ? null : toDouble(row.get("geoLatitude")));
                    dto.setGeoLongitude(row.get("geoLongitude") == null ? null : toDouble(row.get("geoLongitude")));
                    dto.setGeoElevation(row.get("geoElevation") == null ? null : toDouble(row.get("geoElevation")));
                    dto.setIfcOffsetX(row.get("ifcOffsetX") == null ? null : toDouble(row.get("ifcOffsetX")));
                    dto.setIfcOffsetY(row.get("ifcOffsetY") == null ? null : toDouble(row.get("ifcOffsetY")));
                    dto.setIfcOffsetZ(row.get("ifcOffsetZ") == null ? null : toDouble(row.get("ifcOffsetZ")));
                    dto.setIfcScale(row.get("ifcScale") == null ? null : toDouble(row.get("ifcScale")));
                    dto.setGlbStorageKey((String) row.get("glbStorageKey"));
                    return dto;
                })
                .collect(Collectors.toList());
    }

    @Override
    public List<Map<String, Object>> getBimElementStats(String projectId) {
        return bimDAO.getElementStatsByProject(projectId);
    }

    // ── 구조 분석 (C# 서버 프록시) ────────────────────────────────

    @Override
    public Mono<Map<String, Object>> getStructuralAnalysis(String projectId) {
        log.debug("C# 구조 분석 요청: projectId={}", projectId);
        return webClient.get()
                .uri("/api/bim/structural/{projectId}", projectId)
                .retrieve()
                .onStatus(status -> status.isError(), response -> {
                    log.error("C# 구조 분석 요청 실패: projectId={}, status={}", projectId, response.statusCode());
                    return Mono.error(new RuntimeException("C# structural analysis failed: " + response.statusCode()));
                })
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @Override
    public String exportBimElementsCsv(String projectId) {
        List<Map<String, Object>> rows = bimDAO.getElementsByProject(projectId);
        StringBuilder sb = new StringBuilder();
        sb.append("elementId,elementType,material,positionX,positionY,positionZ,sizeX,sizeY,sizeZ,rotationX,rotationY,rotationZ,globalId,ifcName,storey,building\n");
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
            sb.append(row.getOrDefault("rotationZ", "")).append(",");
            sb.append(row.getOrDefault("globalId", "")).append(",");
            sb.append(row.getOrDefault("ifcName",  "")).append(",");
            sb.append(row.getOrDefault("storey",   "")).append(",");
            sb.append(row.getOrDefault("building", "")).append("\n");
        }
        return sb.toString();
    }

    // ── 층(BuildingStorey) ──────────────────────────────────────────

    @Override
    public List<BimStoreyDTO> getStoreysByProject(String projectId) {
        return bimDAO.getStoreysByProject(projectId);
    }

    @Override
    public void saveStoreys(List<BimStoreyDTO> storeys) {
        if (storeys == null || storeys.isEmpty()) return;
        bimDAO.insertStoreysBatch(storeys);
    }

    @Override
    public void deleteStoreysByProject(String projectId) {
        bimDAO.deleteStoreysByProject(projectId);
    }

    // ── WBS 노드 ────────────────────────────────────────────────────

    @Override
    public List<BimWbsNodeDTO> getWbsByProject(String projectId) {
        return bimDAO.getWbsByProject(projectId);
    }

    @Override
    public void saveWbsNodes(List<BimWbsNodeDTO> nodes) {
        if (nodes == null || nodes.isEmpty()) return;
        bimDAO.insertWbsNodesBatch(nodes);
    }

    @Override
    public void updateWbsProgress(String wbsId, int progress) {
        bimDAO.updateWbsProgress(wbsId, Math.max(0, Math.min(100, progress)));
    }

    @Override
    public void deleteWbsByProject(String projectId) {
        bimDAO.deleteElementWbsMappingsByProject(projectId);
        bimDAO.deleteWbsByProject(projectId);
    }

    // ── WBS 진척도 요약 (통합관제 시각화용) ────────────────────────

    @Override
    public Map<String, Object> getWbsProgressSummary(String projectId) {
        List<BimWbsNodeDTO> nodes = bimDAO.getWbsByProject(projectId);
        List<Map<String, Object>> mappings = bimDAO.getElementWbsMappings(projectId);

        Map<String, BimWbsNodeDTO>         nodeMap     = new HashMap<>();
        Map<String, List<BimWbsNodeDTO>>   childrenMap = new HashMap<>();
        for (BimWbsNodeDTO n : nodes) {
            nodeMap.put(n.getWbsId(), n);
            if (n.getParentWbsId() != null)
                childrenMap.computeIfAbsent(n.getParentWbsId(), k -> new ArrayList<>()).add(n);
        }

        final List<String> PHASE_ORDER = List.of("TEMP", "EARTH", "FOUND", "UNDER", "ABOVE");

        // PHASE 노드 수집 → 각 phase 의 TASK 후손 평균 진행률
        List<BimWbsNodeDTO> phaseNodes = nodes.stream()
            .filter(n -> "PHASE".equals(n.getNodeType()))
            .sorted(Comparator.comparingInt(n -> (n.getSortOrder() == null ? 999 : n.getSortOrder())))
            .collect(Collectors.toList());

        List<Map<String, Object>> phaseList = new ArrayList<>();
        for (BimWbsNodeDTO ph : phaseNodes) {
            String phaseKey      = extractPhaseKey(ph.getWbsId());
            double phaseProgress = computePhaseProgress(ph.getWbsId(), childrenMap);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("phaseKey",  phaseKey);
            m.put("phaseName", ph.getWbsName());
            m.put("progress",  Math.round(phaseProgress * 10.0) / 10.0);
            m.put("sortOrder", ph.getSortOrder() != null ? ph.getSortOrder() : 999);
            phaseList.add(m);
        }

        // 활성 phase 인덱스 = 진행률 < 100인 첫 번째 phase
        int activePhaseIdx = PHASE_ORDER.size();
        for (int i = 0; i < PHASE_ORDER.size(); i++) {
            final String pk = PHASE_ORDER.get(i);
            java.util.Optional<Map<String, Object>> found = phaseList.stream()
                .filter(p -> pk.equals(p.get("phaseKey"))).findFirst();
            if (found.isEmpty()) continue;
            double prog = ((Number) found.get().get("progress")).doubleValue();
            if (prog < 100) { activePhaseIdx = i; break; }
        }

        // 부재별 진행률 계산 (cascade 적용)
        Map<String, Map<String, Object>> elementMap = new LinkedHashMap<>();
        for (Map<String, Object> mapping : mappings) {
            String elementId = (String) mapping.get("elementId");
            String wbsId     = (String) mapping.get("wbsId");

            List<BimWbsNodeDTO> taskChildren = childrenMap.getOrDefault(wbsId, Collections.emptyList())
                .stream().filter(n -> "TASK".equals(n.getNodeType())).collect(Collectors.toList());

            double rawProgress;
            if (taskChildren.isEmpty()) {
                BimWbsNodeDTO el = nodeMap.get(wbsId);
                rawProgress = (el != null && el.getProgress() != null) ? el.getProgress() : 0;
            } else {
                rawProgress = taskChildren.stream()
                    .mapToInt(t -> t.getProgress() != null ? t.getProgress() : 0)
                    .average().orElse(0);
            }

            String phaseKey = findPhaseKey(wbsId, nodeMap);
            int phaseIdx    = PHASE_ORDER.indexOf(phaseKey);
            double cascaded = (phaseIdx >= 0 && phaseIdx > activePhaseIdx) ? 0 : rawProgress;

            Map<String, Object> el = new LinkedHashMap<>();
            el.put("progress", Math.round(cascaded * 10.0) / 10.0);
            el.put("phaseKey", phaseKey);
            elementMap.put(elementId, el);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("phases",   phaseList);
        result.put("elements", elementMap);
        return result;
    }

    private double computePhaseProgress(String phaseWbsId,
                                        Map<String, List<BimWbsNodeDTO>> childrenMap) {
        List<Integer> taskProgress = new ArrayList<>();
        collectTaskProgress(phaseWbsId, childrenMap, taskProgress, 0);
        if (taskProgress.isEmpty()) return 0;
        return taskProgress.stream().mapToInt(Integer::intValue).average().orElse(0);
    }

    private void collectTaskProgress(String wbsId,
                                     Map<String, List<BimWbsNodeDTO>> childrenMap,
                                     List<Integer> result, int depth) {
        if (depth > 8) return;
        for (BimWbsNodeDTO child : childrenMap.getOrDefault(wbsId, Collections.emptyList())) {
            if ("TASK".equals(child.getNodeType())) {
                result.add(child.getProgress() != null ? child.getProgress() : 0);
            } else {
                collectTaskProgress(child.getWbsId(), childrenMap, result, depth + 1);
            }
        }
    }

    private String extractPhaseKey(String wbsId) {
        if (wbsId == null) return null;
        List<String> keys = List.of("TEMP", "EARTH", "FOUND", "UNDER", "ABOVE");
        String[] parts = wbsId.split("-");
        String last = parts[parts.length - 1];
        if (keys.contains(last)) return last;
        for (String k : keys) { if (wbsId.endsWith("-" + k)) return k; }
        return null;
    }

    private String findPhaseKey(String elementWbsId, Map<String, BimWbsNodeDTO> nodeMap) {
        BimWbsNodeDTO node = nodeMap.get(elementWbsId);
        for (int i = 0; i < 5; i++) {
            if (node == null) break;
            if ("PHASE".equals(node.getNodeType())) return extractPhaseKey(node.getWbsId());
            if (node.getParentWbsId() == null) break;
            node = nodeMap.get(node.getParentWbsId());
        }
        return "ABOVE";
    }

    // ── 부재 ↔ WBS 매핑 ────────────────────────────────────────────

    @Override
    public List<Map<String, Object>> getElementWbsMappings(String projectId) {
        return bimDAO.getElementWbsMappings(projectId);
    }

    @Override
    public void saveElementWbsMappings(List<Map<String, Object>> mappings) {
        if (mappings == null || mappings.isEmpty()) return;
        bimDAO.insertElementWbsMappingsBatch(mappings);
    }

    @Override
    public List<String> getElementIdsByWbs(String wbsId) {
        return bimDAO.getElementIdsByWbs(wbsId);
    }

    @Override
    public String getWbsIdByElement(String elementId) {
        return bimDAO.getWbsIdByElement(elementId);
    }

    // ── IFC 원본 파일 Object Storage 연동 ──────────────────────────

    @Override
    public String uploadIfcFile(String projectId, MultipartFile file) {
        try {
            String key = "projects/" + projectId + "/original.ifc";
            long size = file.getSize();
            storageService.upload(key, file.getInputStream(), size, "application/octet-stream");

            Map<String, Object> params = new HashMap<>();
            params.put("projectId", projectId);
            params.put("storageKey", key);
            params.put("originalFilename", file.getOriginalFilename());
            bimDAO.updateProjectStorage(params);

            log.info("[BIM] IFC 원본 파일 업로드 완료: projectId={}, key={}, size={}bytes", projectId, key, size);
            return key;
        } catch (StorageException e) {
            throw e;
        } catch (Exception e) {
            throw new StorageException("IFC 파일 업로드 처리 실패: projectId=" + projectId, e);
        }
    }

    @Override
    public InputStream downloadIfcFile(String projectId) {
        String storageKey = getStorageKey(projectId);
        if (storageKey == null) {
            throw new StorageException("IFC 원본 파일이 없습니다: projectId=" + projectId);
        }
        return storageService.download(storageKey);
    }

    @Override
    public String getStorageKey(String projectId) {
        Map<String, Object> project = bimDAO.getProjectById(projectId);
        if (project == null) return null;
        return (String) project.get("storageKey");
    }

    @Override
    public Mono<Map<String, Object>> convertAndStoreIfc(String projectId, MultipartFile file, double userScale) {
        return Mono.fromCallable(() -> {
            byte[] ifcBytes;
            try {
                ifcBytes = file.getBytes();
            } catch (Exception e) {
                throw new RuntimeException("IFC 파일 읽기 실패", e);
            }

            // 1. 원본 IFC Minio 저장
            try {
                String ifcKey = "projects/" + projectId + "/original.ifc";
                storageService.upload(ifcKey, new java.io.ByteArrayInputStream(ifcBytes),
                        ifcBytes.length, "application/octet-stream");
                Map<String, Object> storageParams = new HashMap<>();
                storageParams.put("projectId", projectId);
                storageParams.put("storageKey", ifcKey);
                storageParams.put("originalFilename", file.getOriginalFilename());
                bimDAO.updateProjectStorage(storageParams);
            } catch (Exception e) {
                log.warn("[BIM] IFC 원본 저장 실패(계속 진행): {}", e.getMessage());
            }

            // 2. Python 변환 서비스 호출 (agentWebClient: baseUrl=localhost:7070, timeout=10min)
            org.springframework.core.io.ByteArrayResource resource =
                    new org.springframework.core.io.ByteArrayResource(ifcBytes) {
                        @Override public String getFilename() { return file.getOriginalFilename() != null ? file.getOriginalFilename() : "model.ifc"; }
                    };

            org.springframework.util.MultiValueMap<String, Object> formData = new org.springframework.util.LinkedMultiValueMap<>();
            formData.add("file", resource);
            formData.add("project_id", projectId);
            if (userScale != 1.0) {
                formData.add("scale", String.valueOf(userScale));
            }

            Map<String, Object> convertResult = agentWebClient.post()
                    .uri("/api/ifc/convert")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(org.springframework.web.reactive.function.BodyInserters.fromMultipartData(formData))
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                    .block(java.time.Duration.ofMinutes(10));

            if (convertResult == null || convertResult.containsKey("error")) {
                throw new RuntimeException("Python 변환 실패: " +
                        (convertResult != null ? convertResult.get("error") : "응답 없음"));
            }

            // 3. GLB Minio 저장
            String glbBase64 = (String) convertResult.get("glbBase64");
            byte[] glbBytes = java.util.Base64.getDecoder().decode(glbBase64);
            uploadGlbFile(projectId, glbBytes);

            // 3b. Lite GLB Minio 저장 (convex hull 단순화 버전)
            String glbLiteBase64 = (String) convertResult.get("glbLiteBase64");
            if (glbLiteBase64 != null) {
                byte[] liteBytes = java.util.Base64.getDecoder().decode(glbLiteBase64);
                String liteKey = "projects/" + projectId + "/model_lite.glb";
                storageService.upload(liteKey, new java.io.ByteArrayInputStream(liteBytes),
                        liteBytes.length, "model/gltf-binary");
                log.info("[BIM] Lite GLB 저장 완료: key={}, size={}bytes", liteKey, liteBytes.length);
            }

            // 4. elements DB 저장
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rawElements = (List<Map<String, Object>>) convertResult.get("elements");
            if (rawElements != null && !rawElements.isEmpty()) {
                List<BimElementDTO> dtos = rawElements.stream().map(e -> {
                    BimElementDTO dto = new BimElementDTO();
                    dto.setProjectId(projectId);
                    dto.setElementId((String) e.get("elementId")); // Python이 이미 project_id suffix 포함
                    dto.setElementType((String) e.get("elementType"));
                    dto.setPositionX(toDoubleOrNull(e.get("positionX")));
                    dto.setPositionY(toDoubleOrNull(e.get("positionY")));
                    dto.setPositionZ(toDoubleOrNull(e.get("positionZ")));
                    dto.setSizeX(toDoubleOrNull(e.get("sizeX")));
                    dto.setSizeY(toDoubleOrNull(e.get("sizeY")));
                    dto.setSizeZ(toDoubleOrNull(e.get("sizeZ")));
                    dto.setMaterial((String) e.get("material"));
                    dto.setStorey((String) e.get("storey"));
                    dto.setBuilding((String) e.get("building"));
                    dto.setGlobalId((String) e.get("globalId"));
                    return dto;
                }).collect(Collectors.toList());
                // C# 서버 경유 저장; 실패 시 로컬 DB에 폴백 저장
                boolean savedToCs = false;
                try {
                    createElements(dtos).block(java.time.Duration.ofMinutes(5));
                    savedToCs = true;
                } catch (Exception ex) {
                    log.warn("[BIM] C# elements 저장 실패 — 로컬 DB로 폴백: {}", ex.getMessage());
                }
                if (!savedToCs) {
                    try {
                        bimDAO.insertElementsBatch(dtos);
                    } catch (Exception ex) {
                        log.warn("[BIM] 로컬 DB elements 저장 실패: {}", ex.getMessage());
                    }
                }
            }

            // 5. storeys DB 저장
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rawStoreys = (List<Map<String, Object>>) convertResult.get("storeys");
            if (rawStoreys != null && !rawStoreys.isEmpty()) {
                List<BimStoreyDTO> storeyDtos = new ArrayList<>();
                for (int i = 0; i < rawStoreys.size(); i++) {
                    Map<String, Object> s = rawStoreys.get(i);
                    BimStoreyDTO dto = new BimStoreyDTO();
                    dto.setStoreyId(projectId + "-STOREY-" + i);
                    dto.setProjectId(projectId);
                    dto.setStoreyName((String) s.get("name"));
                    dto.setElevation(toDoubleOrNull(s.get("elevation")));
                    dto.setBuilding((String) s.get("building"));
                    dto.setSortOrder(i);
                    storeyDtos.add(dto);
                }
                saveStoreys(storeyDtos);
            }

            return Map.<String, Object>of(
                    "projectId", projectId,
                    "elementCount", rawElements != null ? rawElements.size() : 0,
                    "storeyCount", rawStoreys != null ? rawStoreys.size() : 0,
                    "glbSize", glbBytes.length
            );
        }).subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic());
    }

    private Double toDoubleOrNull(Object val) {
        if (val == null) return null;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (Exception e) { return null; }
    }

    @Override
    public String uploadGlbFile(String projectId, byte[] glbBytes) {
        try {
            String key = "projects/" + projectId + "/model.glb";
            java.io.InputStream is = new java.io.ByteArrayInputStream(glbBytes);
            storageService.upload(key, is, glbBytes.length, "model/gltf-binary");
            Map<String, Object> params = new HashMap<>();
            params.put("projectId", projectId);
            params.put("glbStorageKey", key);
            bimDAO.updateProjectGlbStorage(params);
            log.info("[BIM] GLB 파일 업로드 완료: projectId={}, key={}, size={}bytes", projectId, key, glbBytes.length);
            return key;
        } catch (Exception e) {
            throw new StorageException("GLB 파일 업로드 실패: projectId=" + projectId, e);
        }
    }

    @Override
    public InputStream downloadGlbFile(String projectId) {
        String key = getGlbStorageKey(projectId);
        if (key == null) throw new StorageException("GLB 파일이 없습니다: projectId=" + projectId);
        return storageService.download(key);
    }

    @Override
    public InputStream downloadGlbLiteFile(String projectId) {
        String key = "projects/" + projectId + "/model_lite.glb";
        return storageService.download(key);
    }

    @Override
    public String getGlbStorageKey(String projectId) {
        Map<String, Object> project = bimDAO.getProjectById(projectId);
        if (project == null) return null;
        return (String) project.get("glbStorageKey");
    }

    // ── 부재 일괄 변환 (이동 / 회전 / 크기) ────────────────────────────────

    @Override
    public Mono<Map<String, Object>> translateProjectElements(
            String projectId, double deltaX, double deltaY, double deltaZ) {
        log.info("[BIM] 전체 부재 이동 요청: projectId={}, ΔX={}, ΔY={}, ΔZ={}", projectId, deltaX, deltaY, deltaZ);
        ParameterizedTypeReference<List<BimElementDTO>> typeRef = new ParameterizedTypeReference<>() {};
        return webClient.get()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(typeRef)
                .flatMap(elements -> {
                    if (elements == null || elements.isEmpty()) {
                        Map<String, Object> empty = new LinkedHashMap<>();
                        empty.put("success",   true);
                        empty.put("updated",   0);
                        empty.put("projectId", projectId);
                        return Mono.just(empty);
                    }
                    // 각 부재 좌표 오프셋 적용 후 C# PUT 요청 병렬 전송
                    List<Mono<Void>> updates = elements.stream().map(el -> {
                        if (deltaX != 0) el.setPositionX((el.getPositionX() != null ? el.getPositionX() : 0.0) + deltaX);
                        if (deltaY != 0) el.setPositionY((el.getPositionY() != null ? el.getPositionY() : 0.0) + deltaY);
                        if (deltaZ != 0) el.setPositionZ((el.getPositionZ() != null ? el.getPositionZ() : 0.0) + deltaZ);
                        return webClient.put()
                                .uri("/api/bim/element")
                                .bodyValue(el)
                                .retrieve()
                                .bodyToMono(Void.class)
                                .onErrorResume(e -> {
                                    log.warn("[BIM] 부재 이동 실패 (무시): elementId={}, err={}", el.getElementId(), e.getMessage());
                                    return Mono.empty();
                                });
                    }).collect(Collectors.toList());

                    int total = elements.size();
                    return Flux.merge(updates).then(Mono.fromSupplier(() -> {
                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("success",   true);
                        result.put("updated",   total);
                        result.put("projectId", projectId);
                        result.put("deltaX",    deltaX);
                        result.put("deltaY",    deltaY);
                        result.put("deltaZ",    deltaZ);
                        return result;
                    }));
                })
                .onErrorResume(e -> {
                    log.error("[BIM] translateProjectElements 실패: {}", e.getMessage(), e);
                    Map<String, Object> err = new LinkedHashMap<>();
                    err.put("success", false);
                    err.put("error",   e.getMessage());
                    return Mono.just(err);
                });
    }

    @Override
    public Mono<Map<String, Object>> translateSelectedElements(
            String projectId, List<String> elementIds,
            double deltaX, double deltaY, double deltaZ) {
        log.info("[BIM] 선택 부재 이동: projectId={}, ids={}, ΔX={}, ΔY={}, ΔZ={}",
                projectId, elementIds, deltaX, deltaY, deltaZ);

        if (elementIds == null || elementIds.isEmpty()) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("success", false);
            empty.put("error",   "선택된 부재가 없습니다.");
            return Mono.just(empty);
        }

        Set<String> idSet = new java.util.HashSet<>(elementIds);
        ParameterizedTypeReference<List<BimElementDTO>> typeRef = new ParameterizedTypeReference<>() {};

        return webClient.get()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(typeRef)
                .flatMap(elements -> {
                    List<BimElementDTO> targets = (elements == null ? List.<BimElementDTO>of() : elements)
                            .stream()
                            .filter(el -> el.getElementId() != null && idSet.contains(el.getElementId()))
                            .collect(Collectors.toList());

                    int skipped = (elements == null ? 0 : elements.size()) - targets.size();

                    if (targets.isEmpty()) {
                        Map<String, Object> none = new LinkedHashMap<>();
                        none.put("success", false);
                        none.put("error",   "일치하는 부재를 찾을 수 없습니다.");
                        none.put("requested", elementIds.size());
                        return Mono.just(none);
                    }

                    List<Mono<Void>> updates = targets.stream().map(el -> {
                        if (deltaX != 0) el.setPositionX((el.getPositionX() != null ? el.getPositionX() : 0.0) + deltaX);
                        if (deltaY != 0) el.setPositionY((el.getPositionY() != null ? el.getPositionY() : 0.0) + deltaY);
                        if (deltaZ != 0) el.setPositionZ((el.getPositionZ() != null ? el.getPositionZ() : 0.0) + deltaZ);
                        return webClient.put()
                                .uri("/api/bim/element")
                                .bodyValue(el)
                                .retrieve()
                                .bodyToMono(Void.class)
                                .onErrorResume(e -> {
                                    log.warn("[BIM] 선택 부재 이동 실패 (무시): elementId={}", el.getElementId());
                                    return Mono.empty();
                                });
                    }).collect(Collectors.toList());

                    int total   = targets.size();
                    int skipped2 = skipped;
                    return Flux.merge(updates).then(Mono.fromSupplier(() -> {
                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("success",   true);
                        result.put("updated",   total);
                        result.put("skipped",   skipped2);
                        result.put("projectId", projectId);
                        result.put("deltaX",    deltaX);
                        result.put("deltaY",    deltaY);
                        result.put("deltaZ",    deltaZ);
                        return result;
                    }));
                })
                .onErrorResume(e -> {
                    log.error("[BIM] translateSelectedElements 실패: {}", e.getMessage(), e);
                    Map<String, Object> err = new LinkedHashMap<>();
                    err.put("success", false);
                    err.put("error",   e.getMessage());
                    return Mono.just(err);
                });
    }

    @Override
    public Mono<Map<String, Object>> transformElements(
            String projectId, List<String> elementIds,
            double dPosX, double dPosY, double dPosZ,
            double dRotX, double dRotY, double dRotZ,
            double sclX,  double sclY,  double sclZ) {

        log.info("[BIM] transform: projectId={} ids={} pos=({},{},{}) rot=({},{},{}) scl=({},{},{})",
                projectId, elementIds == null ? "ALL" : elementIds.size(),
                dPosX, dPosY, dPosZ, dRotX, dRotY, dRotZ, sclX, sclY, sclZ);

        Set<String> idFilter = (elementIds != null && !elementIds.isEmpty())
                ? new java.util.HashSet<>(elementIds) : null;

        ParameterizedTypeReference<List<BimElementDTO>> typeRef = new ParameterizedTypeReference<>() {};
        return webClient.get()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(typeRef)
                .flatMap(all -> {
                    List<BimElementDTO> targets = (all == null ? List.<BimElementDTO>of() : all).stream()
                            .filter(el -> idFilter == null || (el.getElementId() != null && idFilter.contains(el.getElementId())))
                            .collect(Collectors.toList());

                    if (targets.isEmpty()) {
                        Map<String, Object> none = new LinkedHashMap<>();
                        none.put("success", false);
                        none.put("error",   idFilter != null ? "일치하는 부재를 찾을 수 없습니다." : "부재가 없습니다.");
                        return Mono.just(none);
                    }

                    List<Mono<Void>> updates = targets.stream().map(el -> {
                        // 위치 오프셋
                        if (dPosX != 0) el.setPositionX((el.getPositionX() != null ? el.getPositionX() : 0.0) + dPosX);
                        if (dPosY != 0) el.setPositionY((el.getPositionY() != null ? el.getPositionY() : 0.0) + dPosY);
                        if (dPosZ != 0) el.setPositionZ((el.getPositionZ() != null ? el.getPositionZ() : 0.0) + dPosZ);
                        // 회전 오프셋 (도 단위)
                        if (dRotX != 0) el.setRotationX((el.getRotationX() != null ? el.getRotationX() : 0.0) + dRotX);
                        if (dRotY != 0) el.setRotationY((el.getRotationY() != null ? el.getRotationY() : 0.0) + dRotY);
                        if (dRotZ != 0) el.setRotationZ((el.getRotationZ() != null ? el.getRotationZ() : 0.0) + dRotZ);
                        // 크기 배율 (1.0 = 변화 없음)
                        if (sclX != 1.0 && sclX > 0) el.setSizeX((el.getSizeX() != null ? el.getSizeX() : 1.0) * sclX);
                        if (sclY != 1.0 && sclY > 0) el.setSizeY((el.getSizeY() != null ? el.getSizeY() : 1.0) * sclY);
                        if (sclZ != 1.0 && sclZ > 0) el.setSizeZ((el.getSizeZ() != null ? el.getSizeZ() : 1.0) * sclZ);
                        return webClient.put()
                                .uri("/api/bim/element")
                                .bodyValue(el)
                                .retrieve()
                                .bodyToMono(Void.class)
                                .onErrorResume(e -> {
                                    log.warn("[BIM] transform 실패 (무시): elementId={}", el.getElementId());
                                    return Mono.empty();
                                });
                    }).collect(Collectors.toList());

                    int total = targets.size();
                    return Flux.merge(updates).then(Mono.fromSupplier(() -> {
                        Map<String, Object> result = new LinkedHashMap<>();
                        result.put("success",   true);
                        result.put("updated",   total);
                        result.put("projectId", projectId);
                        result.put("position",  Map.of("dx", dPosX, "dy", dPosY, "dz", dPosZ));
                        result.put("rotation",  Map.of("dx", dRotX, "dy", dRotY, "dz", dRotZ));
                        result.put("scale",     Map.of("x", sclX, "y", sclY, "z", sclZ));
                        return result;
                    }));
                })
                .onErrorResume(e -> {
                    log.error("[BIM] transformElements 실패: {}", e.getMessage(), e);
                    Map<String, Object> err = new LinkedHashMap<>();
                    err.put("success", false);
                    err.put("error",   e.getMessage());
                    return Mono.just(err);
                });
    }

    // ── 단일 SQL 일괄 변환 (Spring DB 직접) ─────────────────────────────
    @Override
    public Mono<Map<String, Object>> bulkTransformDirect(
            String projectId, List<String> elementIds,
            double dPosX, double dPosY, double dPosZ,
            double dRotX, double dRotY, double dRotZ,
            double sclX,  double sclY,  double sclZ) {

        return Mono.fromCallable(() -> {
            // ① Spring DB 단일 UPDATE — 부재 수와 무관하게 쿼리 1번
            bimDAO.bulkTransformElements(projectId, elementIds,
                    dPosX, dPosY, dPosZ, dRotX, dRotY, dRotZ, sclX, sclY, sclZ);

            int count = bimDAO.getElementsByProject(projectId).size();
            if (elementIds != null && !elementIds.isEmpty()) {
                count = elementIds.size();
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success",   true);
            result.put("updated",   count);
            result.put("projectId", projectId);
            result.put("position",  Map.of("dx", dPosX, "dy", dPosY, "dz", dPosZ));
            result.put("rotation",  Map.of("dx", dRotX, "dy", dRotY, "dz", dRotZ));
            result.put("scale",     Map.of("x",  sclX,  "y",  sclY,  "z",  sclZ));
            return result;
        })
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .doOnSuccess(r -> syncToCSharpAsync(projectId, elementIds))
        .onErrorResume(e -> {
            log.error("[BIM] bulkTransformDirect 실패: {}", e.getMessage(), e);
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("success", false);
            err.put("error",   e.getMessage());
            return Mono.just(err);
        });
    }

    // ── 다건 부재 절대값 일괄 업데이트 ─────────────────────────────────────
    @Override
    public Mono<Map<String, Object>> batchAbsoluteUpdate(String projectId, List<BimElementDTO> elements) {
        if (elements == null || elements.isEmpty()) {
            return Mono.just(Map.of("success", false, "error", "elements is empty"));
        }
        return Mono.fromCallable(() -> {
            for (BimElementDTO el : elements) el.setProjectId(projectId);
            bimDAO.batchUpsertElements(elements);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", true);
            result.put("updated", elements.size());
            result.put("projectId", projectId);
            return result;
        })
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .doOnSuccess(r -> {
            List<String> ids = elements.stream()
                    .map(BimElementDTO::getElementId)
                    .collect(java.util.stream.Collectors.toList());
            syncToCSharpAsync(projectId, ids);
        })
        .onErrorResume(e -> {
            log.error("[BIM] batchAbsoluteUpdate 실패: {}", e.getMessage(), e);
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("success", false);
            err.put("error",   e.getMessage());
            return Mono.just(err);
        });
    }

    /** Spring DB 업데이트 후 C# 서버를 비동기로 동기화 (응답 차단 없음). */
    private void syncToCSharpAsync(String projectId, List<String> elementIds) {
        final Set<String> idSet = (elementIds != null && !elementIds.isEmpty())
                ? new HashSet<>(elementIds) : null;

        Mono.fromCallable(() -> bimDAO.getElementsByProject(projectId))
            .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
            .flatMapMany(rows -> Flux.fromIterable(rows)
                    .filter(m -> idSet == null || idSet.contains(m.get("elementId")))
                    .map(m -> {
                        BimElementDTO el = new BimElementDTO();
                        el.setElementId((String)  m.get("elementId"));
                        el.setProjectId(projectId);
                        el.setElementType((String) m.get("elementType"));
                        el.setMaterial((String)    m.get("material"));
                        el.setPositionX(toDoubleOrNull(m.get("positionX")));
                        el.setPositionY(toDoubleOrNull(m.get("positionY")));
                        el.setPositionZ(toDoubleOrNull(m.get("positionZ")));
                        el.setSizeX(toDoubleOrNull(m.get("sizeX")));
                        el.setSizeY(toDoubleOrNull(m.get("sizeY")));
                        el.setSizeZ(toDoubleOrNull(m.get("sizeZ")));
                        el.setRotationX(toDoubleOrNull(m.get("rotationX")));
                        el.setRotationY(toDoubleOrNull(m.get("rotationY")));
                        el.setRotationZ(toDoubleOrNull(m.get("rotationZ")));
                        el.setGlobalId((String)    m.get("globalId"));
                        el.setIfcName((String)     m.get("ifcName"));
                        el.setStorey((String)      m.get("storey"));
                        el.setBuilding((String)    m.get("building"));
                        return el;
                    })
            )
            .flatMap(el -> webClient.put()
                    .uri("/api/bim/element")
                    .bodyValue(el)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .onErrorResume(e -> {
                        log.warn("[BIM] C# sync 실패 (무시): elementId={}", el.getElementId());
                        return Mono.empty();
                    }), 20) // 동시 최대 20개 제한
            .subscribe(
                null,
                e  -> log.warn("[BIM] C# 비동기 동기화 오류: projectId={}, {}", projectId, e.getMessage()),
                () -> log.info("[BIM] C# 동기화 완료: projectId={}", projectId)
            );
    }

    // ── GLB 노드 translation 패치 ────────────────────────────────────────

    @Override
    public Mono<Map<String, Object>> applyGlbDelta(
            String projectId, List<String> elementIds,
            double dx, double dy, double dz) {
        return Mono.fromCallable(() -> {
            String key = getGlbStorageKey(projectId);
            if (key == null) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("success", false);
                r.put("reason",  "no_glb");
                return r;
            }
            byte[] glbBytes;
            try (InputStream is = storageService.download(key)) {
                glbBytes = is.readAllBytes();
            }
            byte[] patched = patchGlbNodeTranslations(glbBytes, elementIds, dx, dy, dz);
            try (java.io.ByteArrayInputStream newIs = new java.io.ByteArrayInputStream(patched)) {
                storageService.upload(key, newIs, patched.length, "model/gltf-binary");
            }
            log.info("[BIM] GLB translation 패치 완료: projectId={}, elements={}, dx={},dy={},dz={}",
                    projectId, elementIds == null ? "all" : elementIds.size(), dx, dy, dz);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("success",   true);
            r.put("action",    "glb_reload");
            r.put("projectId", projectId);
            return r;
        })
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .onErrorResume(e -> {
            log.error("[BIM] applyGlbDelta 실패: {}", e.getMessage(), e);
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("success", false);
            err.put("error",   e.getMessage());
            return Mono.just(err);
        });
    }

    private byte[] patchGlbNodeTranslations(byte[] glb, List<String> elementIds,
                                             double dx, double dy, double dz) throws Exception {
        ByteBuffer buf = ByteBuffer.wrap(glb).order(ByteOrder.LITTLE_ENDIAN);

        int magic = buf.getInt();
        if (magic != 0x46546C67) throw new IllegalArgumentException("Not a GLB file (bad magic)");
        buf.getInt(); // version
        buf.getInt(); // totalLength

        int jsonChunkLen  = buf.getInt();
        int jsonChunkType = buf.getInt(); // 0x4E4F534A = "JSON"
        if (jsonChunkType != 0x4E4F534A) throw new IllegalArgumentException("First GLB chunk is not JSON");

        byte[] jsonBytes = new byte[jsonChunkLen];
        buf.get(jsonBytes);

        // parse GLTF JSON
        ObjectNode gltf  = (ObjectNode) objectMapper.readTree(jsonBytes);
        ArrayNode  nodes = (ArrayNode)  gltf.get("nodes");

        Set<String> targetSet = (elementIds != null && !elementIds.isEmpty())
                ? new HashSet<>(elementIds) : null;

        if (nodes != null) {
            for (int i = 0; i < nodes.size(); i++) {
                ObjectNode node = (ObjectNode) nodes.get(i);
                String     name = node.path("name").asText(null);
                if (name == null) continue;
                if (targetSet != null && !targetSet.contains(name)) continue;

                if (node.has("translation")) {
                    ArrayNode t = (ArrayNode) node.get("translation");
                    t.set(0, t.get(0).asDouble() + dx);
                    t.set(1, t.get(1).asDouble() + dy);
                    t.set(2, t.get(2).asDouble() + dz);
                } else {
                    ArrayNode t = objectMapper.createArrayNode();
                    t.add(dx); t.add(dy); t.add(dz);
                    node.set("translation", t);
                }
            }
        }

        // re-serialize with 4-byte space-padding (GLTF spec)
        byte[] newJson    = objectMapper.writeValueAsBytes(gltf);
        int    paddedLen  = (newJson.length + 3) & ~3;
        byte[] paddedJson = Arrays.copyOf(newJson, paddedLen);
        for (int i = newJson.length; i < paddedLen; i++) paddedJson[i] = 0x20;

        // original BIN chunk (everything after the JSON chunk)
        int    binStart  = 12 + 8 + jsonChunkLen;
        int    binLength = glb.length - binStart;

        int newTotal = 12 + 8 + paddedLen + binLength;
        ByteBuffer out = ByteBuffer.allocate(newTotal).order(ByteOrder.LITTLE_ENDIAN);
        out.putInt(0x46546C67);  // magic "glTF"
        out.putInt(2);           // version
        out.putInt(newTotal);
        out.putInt(paddedLen);
        out.putInt(0x4E4F534A);  // "JSON"
        out.put(paddedJson);
        if (binLength > 0) out.put(glb, binStart, binLength);
        return out.array();
    }

    // ── Ollama 층 이름 정규화 ────────────────────────────────────────────

    @Override
    public Map<String, String> normalizeStoreyNames(List<String> names) {
        if (names == null || names.isEmpty()) return Map.of();

        String namesJson;
        try {
            namesJson = objectMapper.writeValueAsString(names);
        } catch (Exception e) {
            log.warn("[StoreyNormalize] 이름 직렬화 실패: {}", e.getMessage());
            return Map.of();
        }

        // few-shot 예시 포함 — 3B 모델은 예시 없이 패턴을 일관되게 따르지 못함
        // EG = Erdgeschoss(독일) = 지상 1층, UG = Untergeschoss = 지하, 1.OG = 지상 2층
        String prompt = "Normalize IFC storey names to standard WBS format.\n" +
                "Rules:\n" +
                "- B1, B2, B3: underground (지하N층, UG, Untergeschoss, basement N)\n" +
                "- 1F, 2F, 3F: above ground (EG=1F, Story N=NF, N.OG=(N+1)F, N층=NF, Level N=NF)\n" +
                "- RF: roof (Roof, Dachgeschoss, 옥상, 지붕, Penthouse)\n" +
                "- MF: machine room (기계실, Maschinenraum)\n" +
                "- Keep original if unknown.\n\n" +
                "Example:\n" +
                "Input: [\"Story 1\",\"Story 2\",\"EG\",\"1.OG\",\"2.OG\",\"UG\",\"기계실\",\"Dachgeschoss\",\"1층\",\"지하1층\"]\n" +
                "Output: {\"Story 1\":\"1F\",\"Story 2\":\"2F\",\"EG\":\"1F\",\"1.OG\":\"2F\",\"2.OG\":\"3F\",\"UG\":\"B1\",\"기계실\":\"MF\",\"Dachgeschoss\":\"RF\",\"1층\":\"1F\",\"지하1층\":\"B1\"}\n\n" +
                "Now normalize (return ONLY a flat JSON object, no explanation):\n" +
                "Input: " + namesJson + "\n" +
                "Output:";

        try {
            // GTX 1050 4GB 최적화
            // - num_ctx 512: 입력이 짧으므로 KV 캐시 VRAM 절약
            // - num_predict 256: 층 이름 목록 출력에 충분, 불필요한 토큰 생성 방지
            // - temperature 0: 결정적 출력, JSON 포맷 일관성 확보
            Map<String, Object> options = new LinkedHashMap<>();
            options.put("temperature", 0);
            options.put("num_predict", 256);
            options.put("num_ctx", 512);

            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("model", ollamaModel);
            requestBody.put("prompt", prompt);
            requestBody.put("stream", false);
            requestBody.put("format", "json");
            requestBody.put("options", options);

            String raw = ollamaWebClient.post()
                    .uri("/api/generate")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(requestBody)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(java.time.Duration.ofSeconds(60))  // 1050 기준 여유 있는 60초
                    .block();

            com.fasterxml.jackson.databind.JsonNode root = objectMapper.readTree(raw);
            String responseText = root.path("response").asText("").trim();

            // JSON 블록 추출
            int start = responseText.indexOf('{');
            int end   = responseText.lastIndexOf('}') + 1;
            if (start < 0 || end <= start) {
                log.warn("[StoreyNormalize] JSON 없음, 폴백: {}", responseText);
                return Map.of();
            }

            // 값이 String인 항목만 수집 — 모델이 중첩 객체를 뱉는 경우 방어
            com.fasterxml.jackson.databind.JsonNode parsed =
                    objectMapper.readTree(responseText.substring(start, end));
            Map<String, String> result = new LinkedHashMap<>();
            parsed.fields().forEachRemaining(entry -> {
                if (entry.getValue().isTextual()) {
                    result.put(entry.getKey(), entry.getValue().asText());
                }
            });
            if (result.isEmpty()) {
                log.warn("[StoreyNormalize] 유효한 매핑 없음, 폴백");
                return Map.of();
            }
            log.info("[StoreyNormalize] 정규화 완료: {}", result);
            return result;

        } catch (Exception e) {
            log.warn("[StoreyNormalize] Ollama 호출 실패, 폴백 적용: {}", e.getMessage());
            return Map.of();
        }
    }
}