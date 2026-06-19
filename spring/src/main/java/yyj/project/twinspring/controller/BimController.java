package yyj.project.twinspring.controller;

import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import yyj.project.twinspring.storage.StorageException;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimElementColorDTO;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimLayerDTO;
import yyj.project.twinspring.dto.BimLineDTO;
import yyj.project.twinspring.dto.BimProjectDTO;
import yyj.project.twinspring.dto.BimStoreyDTO;
import yyj.project.twinspring.dto.BimWbsNodeDTO;
import yyj.project.twinspring.service.BimService;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/bim")
public class BimController {
    private final BimService bimService;

    public BimController(BimService bimService) {
        this.bimService = bimService;
    }

    @GetMapping(value = "/model",produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<ResponseEntity<String>> getModel(@RequestParam String projectId) {

        return bimService.getModelData(projectId)
                .map(data -> ResponseEntity.ok(data))
                .defaultIfEmpty(ResponseEntity.notFound().build());
    }

    @GetMapping("/projects")
    public Mono<ResponseEntity<List<BimProjectDTO>>> getProjects() {
        return bimService.getProjectList()
                .map(projects -> ResponseEntity.ok(projects));
    }
    @GetMapping("/model/elements")
    public ResponseEntity<Mono<List<BimElementDTO>>> getModelElements(@RequestParam String projectId) {
        return bimService.getModelElements(projectId);
    }
    @GetMapping("project/{projectId}")
    public ResponseEntity<Mono<List<BimElementDTO>>> getProject(@PathVariable String projectId) {
        return bimService.getProject(projectId);
    }
    @DeleteMapping("/project/{projectId}")
    public ResponseEntity<Mono<Void>> deleteProject(@PathVariable String projectId) {
        return bimService.deleteProject(projectId);
    }
    @PutMapping("/model/element")
    public ResponseEntity<Mono<Void>> updateElement(@RequestBody BimElementDTO element){
        System.out.println("수정 :: " + element);
        return bimService.updateElement(element);
    }
    /**
     * 단일 부재 신규 생성 API
     * ControlPanel의 "기둥 생성", "보 생성" 버튼 클릭 시 호출
     * C# POST /api/bim/element 로 프록시, 생성된 부재(elementId 포함) 반환
     */
    @PostMapping("/element")
    public Mono<ResponseEntity<BimElementDTO>> createElement(@RequestBody BimElementDTO element) {
        return bimService.createElement(element)
                .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created))
                .onErrorResume(e -> {
                    System.err.println("부재 생성 오류: " + e.getMessage());
                    return reactor.core.publisher.Mono.just(
                            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).<BimElementDTO>build());
                });
    }

    /**
     * 복합 구조물 배치 생성 API
     * AI Agent에서 교각·골조 등 복합 구조 생성 시 호출
     * 요청 바디: BimElementDTO 배열
     */
    @PostMapping("/elements/batch")
    public Mono<ResponseEntity<List<BimElementDTO>>> createElements(@RequestBody List<BimElementDTO> elements) {
        return bimService.createElements(elements)
                .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created))
                .onErrorResume(e -> {
                    System.err.println("배치 부재 생성 오류: " + e.getMessage());
                    return reactor.core.publisher.Mono.just(
                            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).<List<BimElementDTO>>build());
                });
    }

    /**
     * 특정 좌표에 부재 생성 API
     * AI Agent 또는 프론트엔드에서 좌표를 명시적으로 지정해 부재를 생성할 때 호출
     * 요청 바디: { projectId, elementType, material(optional), x, y, z }
     */
    @PostMapping("/element/at")
    public Mono<ResponseEntity<BimElementDTO>> createElementAt(@RequestBody Map<String, Object> body) {
        String projectId   = (String) body.get("projectId");
        String elementType = (String) body.getOrDefault("elementType", "IfcColumn");
        String material    = (String) body.getOrDefault("material", "Concrete");
        double x = toDouble(body.get("x"));
        double y = toDouble(body.get("y"));
        double z = toDouble(body.get("z"));

        return bimService.createElementAt(projectId, elementType, material, x, y, z)
                .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created));
    }

    private double toDouble(Object val) {
        if (val == null) return 0.0;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (NumberFormatException e) { return 0.0; }
    }

    /**
     * 단일 부재 삭제 API
     * PropertyPanel의 삭제 버튼 또는 Del 키 단축키 사용 시 호출
     * C# DELETE /api/bim/element/{elementId} 로 프록시
     */
    @DeleteMapping("/element/{elementId}")
    public ResponseEntity<Mono<Void>> deleteElement(@PathVariable String elementId) {
        System.out.println("부재 삭제 :: " + elementId);
        return bimService.deleteElement(elementId);
    }

    // ================================================================
    // 레이어 CRUD (MariaDB 직접 저장)
    // ================================================================

    @GetMapping("/layers")
    public ResponseEntity<List<BimLayerDTO>> getLayers(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getLayersByProject(projectId));
    }

    @PostMapping("/layer")
    public ResponseEntity<BimLayerDTO> createLayer(@RequestBody BimLayerDTO layer) {
        return ResponseEntity.status(HttpStatus.CREATED).body(bimService.createLayer(layer));
    }

    @PostMapping("/layers/batch")
    public ResponseEntity<Void> createLayersBatch(@RequestBody List<BimLayerDTO> layers) {
        if (layers == null || layers.isEmpty()) return ResponseEntity.ok().build();
        bimService.createLayersBatch(layers);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PutMapping("/layer")
    public ResponseEntity<BimLayerDTO> updateLayer(@RequestBody BimLayerDTO layer) {
        return ResponseEntity.ok(bimService.updateLayer(layer));
    }

    @DeleteMapping("/layer/{layerId}")
    public ResponseEntity<Void> deleteLayer(@PathVariable String layerId) {
        bimService.deleteLayer(layerId);
        return ResponseEntity.noContent().build();
    }

    // ================================================================
    // 부재 커스텀 색상 CRUD (MariaDB 직접 저장)
    // ================================================================

    @GetMapping("/colors")
    public ResponseEntity<List<BimElementColorDTO>> getColors(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getColorsByProject(projectId));
    }

    @PostMapping("/color")
    public ResponseEntity<Void> upsertColor(@RequestBody BimElementColorDTO color) {
        bimService.upsertColor(color);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/color/{elementId}")
    public ResponseEntity<Void> deleteColor(@PathVariable String elementId) {
        bimService.deleteColor(elementId);
        return ResponseEntity.noContent().build();
    }

    // ================================================================
    // 선 CRUD (MariaDB 직접 저장)
    // ================================================================

    @GetMapping("/lines")
    public ResponseEntity<List<BimLineDTO>> getLines(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getLinesByProject(projectId));
    }

    @PostMapping("/line")
    public ResponseEntity<BimLineDTO> createLine(@RequestBody BimLineDTO line) {
        return ResponseEntity.status(HttpStatus.CREATED).body(bimService.createLine(line));
    }

    /** 다수 선 일괄 삽입 — 도면 변환 등 대량 삽입에 사용 */
    @PostMapping("/line/batch")
    public ResponseEntity<List<BimLineDTO>> createLinesBatch(@RequestBody List<BimLineDTO> lines) {
        if (lines == null || lines.isEmpty()) return ResponseEntity.ok(List.of());
        return ResponseEntity.status(HttpStatus.CREATED).body(bimService.createLinesBatch(lines));
    }

    @PutMapping("/line")
    public ResponseEntity<BimLineDTO> updateLine(@RequestBody BimLineDTO line) {
        return ResponseEntity.ok(bimService.updateLine(line));
    }

    @DeleteMapping("/line/{lineId}")
    public ResponseEntity<Void> deleteLine(@PathVariable String lineId) {
        bimService.deleteLine(lineId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/lines")
    public ResponseEntity<Void> deleteLinesByProject(@RequestParam String projectId) {
        bimService.deleteLinesByProject(projectId);
        return ResponseEntity.noContent().build();
    }

    // ================================================================
    // BIM 통계 / 내보내기 (MariaDB 직접 조회)
    // ================================================================

    /** 로컬 DB에서 전체 프로젝트 목록 조회 (C# 서버 우회) */
    @GetMapping("/db-projects")
    public ResponseEntity<List<BimProjectDTO>> getBimProjectsFromDb() {
        return ResponseEntity.ok(bimService.getBimProjectsFromDb());
    }

    /** 프로젝트의 부재 타입별 통계 */
    @GetMapping("/stats/{projectId}")
    public ResponseEntity<List<Map<String, Object>>> getBimStats(@PathVariable String projectId) {
        return ResponseEntity.ok(bimService.getBimElementStats(projectId));
    }

    /** 프로젝트 부재 데이터 CSV 내보내기 */
    @GetMapping("/export/{projectId}")
    public ResponseEntity<byte[]> exportBimElements(@PathVariable String projectId) {
        String csv = bimService.exportBimElementsCsv(projectId);
        byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header("Content-Type", "text/csv; charset=UTF-8")
                .header("Content-Disposition", "attachment; filename=\"bim-elements-" + projectId + ".csv\"")
                .body(bytes);
    }

    /**
     * 프로젝트 이름 수정 API
     * 요청 바디: { "projectName": "새 이름" }
     */
    @PutMapping("/project/{projectId}/name")
    public Mono<ResponseEntity<BimProjectDTO>> renameProject(
            @PathVariable String projectId,
            @RequestBody Map<String, String> body) {
        String newName = body.get("projectName");
        if (newName == null || newName.isBlank()) {
            return Mono.just(ResponseEntity.badRequest().<BimProjectDTO>build());
        }
        return bimService.renameProject(projectId, newName.trim())
                .map(updated -> ResponseEntity.ok(updated));
    }

    /**
     * 구조 분석 API — C# structural 엔드포인트 프록시
     * 프로젝트 부재를 타입/재료별로 집계한 통계 반환
     * GET /api/bim/structural/{projectId}
     */
    @GetMapping("/structural/{projectId}")
    public Mono<ResponseEntity<Map<String, Object>>> getStructuralAnalysis(@PathVariable String projectId) {
        return bimService.getStructuralAnalysis(projectId)
                .map(result -> ResponseEntity.ok(result))
                .onErrorResume(e -> {
                    System.err.println("구조 분석 오류: " + e.getMessage());
                    return reactor.core.publisher.Mono.just(
                            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                                    .<Map<String, Object>>build());
                });
    }

    @PostMapping("/project")
    public Mono<ResponseEntity<BimProjectDTO>> newProject(@RequestBody Map<String, Object> project) {
        System.out.println("PROJECT CREATE : " + project);
        BimProjectDTO projectDTO = new BimProjectDTO();
        projectDTO.setProjectName(asString(project.get("projectName")));
        projectDTO.setSpanCount(asString(project.get("spanCount")));
        projectDTO.setStructureType(asString(project.get("structureType")));
        // geoOrigin 필드 (IFC 임포트 시 전달됨, 없으면 null)
        projectDTO.setGeoLatitude(asDouble(project.get("geoLatitude")));
        projectDTO.setGeoLongitude(asDouble(project.get("geoLongitude")));
        projectDTO.setGeoElevation(asDouble(project.get("geoElevation")));
        projectDTO.setIfcOffsetX(asDouble(project.get("ifcOffsetX")));
        projectDTO.setIfcOffsetY(asDouble(project.get("ifcOffsetY")));
        projectDTO.setIfcOffsetZ(asDouble(project.get("ifcOffsetZ")));
        projectDTO.setIfcScale(asDouble(project.get("ifcScale")));
        return bimService.createProject(projectDTO)
                .map(createdProject -> ResponseEntity.status(HttpStatus.CREATED).body(createdProject));
    }

    private String asString(Object val) {
        return val == null ? null : val.toString();
    }

    private Double asDouble(Object val) {
        if (val == null) return null;
        if (val instanceof Number) return ((Number) val).doubleValue();
        try { return Double.parseDouble(val.toString()); } catch (NumberFormatException e) { return null; }
    }

    // ================================================================
    // 층(BuildingStorey) API
    // ================================================================

    @GetMapping("/storeys")
    public ResponseEntity<List<BimStoreyDTO>> getStoreys(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getStoreysByProject(projectId));
    }

    @PostMapping("/storeys/batch")
    public ResponseEntity<Void> saveStoreys(@RequestBody List<BimStoreyDTO> storeys) {
        bimService.saveStoreys(storeys);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/storeys")
    public ResponseEntity<Void> deleteStoreys(@RequestParam String projectId) {
        bimService.deleteStoreysByProject(projectId);
        return ResponseEntity.ok().build();
    }

    // ================================================================
    // WBS 노드 API
    // ================================================================

    @GetMapping("/wbs")
    public ResponseEntity<List<BimWbsNodeDTO>> getWbs(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getWbsByProject(projectId));
    }

    @PostMapping("/wbs/batch")
    public ResponseEntity<Void> saveWbsNodes(@RequestBody List<BimWbsNodeDTO> nodes) {
        bimService.saveWbsNodes(nodes);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/wbs/{wbsId}/progress")
    public ResponseEntity<Void> updateWbsProgress(
            @PathVariable String wbsId,
            @RequestBody Map<String, Integer> body) {
        Integer progress = body.get("progress");
        if (progress == null) return ResponseEntity.badRequest().build();
        bimService.updateWbsProgress(wbsId, progress);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/wbs")
    public ResponseEntity<Void> deleteWbs(@RequestParam String projectId) {
        bimService.deleteWbsByProject(projectId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/wbs/progress-summary")
    public ResponseEntity<Map<String, Object>> getWbsProgressSummary(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getWbsProgressSummary(projectId));
    }

    // ================================================================
    // 부재 ↔ WBS 매핑 API
    // ================================================================

    @GetMapping("/element-wbs")
    public ResponseEntity<List<Map<String, Object>>> getElementWbsMappings(@RequestParam String projectId) {
        return ResponseEntity.ok(bimService.getElementWbsMappings(projectId));
    }

    @PostMapping("/element-wbs/batch")
    public ResponseEntity<Void> saveElementWbsMappings(@RequestBody List<Map<String, Object>> mappings) {
        bimService.saveElementWbsMappings(mappings);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/wbs/{wbsId}/elements")
    public ResponseEntity<List<String>> getElementsByWbs(@PathVariable String wbsId) {
        return ResponseEntity.ok(bimService.getElementIdsByWbs(wbsId));
    }

    @GetMapping("/element/{elementId}/wbs")
    public ResponseEntity<String> getWbsByElement(@PathVariable String elementId) {
        String wbsId = bimService.getWbsIdByElement(elementId);
        if (wbsId == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(wbsId);
    }

    // ================================================================
    // IFC 원본 파일 Object Storage 연동
    // ================================================================

    /**
     * IFC 원본 파일 업로드
     * POST /api/bim/project/{projectId}/ifc
     *
     * IFC 파싱 성공 후 프론트에서 비동기로 호출한다.
     * 업로드 실패가 프로젝트 생성 흐름을 막지 않도록 에러를 소프트하게 처리한다.
     */
    @PostMapping(value = "/project/{projectId}/ifc", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, String>> uploadIfcFile(
            @PathVariable String projectId,
            @RequestParam("file") MultipartFile file) {

        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "파일이 비어 있습니다."));
        }
        try {
            String storageKey = bimService.uploadIfcFile(projectId, file);
            return ResponseEntity.ok(Map.of(
                    "storageKey", storageKey,
                    "originalFilename", file.getOriginalFilename() != null ? file.getOriginalFilename() : "",
                    "size", String.valueOf(file.getSize())
            ));
        } catch (StorageException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * IFC 원본 파일 다운로드
     * GET /api/bim/project/{projectId}/ifc/download
     *
     * 향후 재분석, WBS 재생성, IFC Export 등에서 원본 파일 재사용 시 호출한다.
     */
    @GetMapping("/project/{projectId}/ifc/download")
    public ResponseEntity<InputStreamResource> downloadIfcFile(@PathVariable String projectId) {
        try {
            String storageKey = bimService.getStorageKey(projectId);
            if (storageKey == null) {
                return ResponseEntity.notFound().build();
            }
            // originalFilename 조회 (없으면 기본값)
            String filename = storageKey.substring(storageKey.lastIndexOf('/') + 1);

            InputStreamResource resource = new InputStreamResource(bimService.downloadIfcFile(projectId));
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"" + filename + "\"")
                    .contentType(MediaType.APPLICATION_OCTET_STREAM)
                    .body(resource);
        } catch (StorageException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * 부재 일괄 변환 (고속) — Spring DB 단일 UPDATE + C# 비동기 동기화
     * PUT /api/bim/project/{projectId}/bulk-transform
     *
     * 기존 /transform 과 동일한 바디 형식.
     * 부재 수와 무관하게 DB 쿼리 1번으로 즉시 처리됩니다.
     */
    @PutMapping("/project/{projectId}/bulk-transform")
    public Mono<ResponseEntity<Map<String, Object>>> bulkTransformElements(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> elementIds = body.containsKey("elementIds")
                ? (List<String>) body.get("elementIds") : null;

        Map<?, ?> pos = body.containsKey("position") ? (Map<?, ?>) body.get("position") : Map.of();
        Map<?, ?> rot = body.containsKey("rotation") ? (Map<?, ?>) body.get("rotation") : Map.of();
        Map<?, ?> scl = body.containsKey("scale")    ? (Map<?, ?>) body.get("scale")    : Map.of();

        double dPosX = toDouble(pos.get("deltaX")), dPosY = toDouble(pos.get("deltaY")), dPosZ = toDouble(pos.get("deltaZ"));
        double dRotX = toDouble(rot.get("deltaX")), dRotY = toDouble(rot.get("deltaY")), dRotZ = toDouble(rot.get("deltaZ"));
        // factorX/Y/Z (Agent/기존) 또는 x/y/z (confirmGroupMove) 모두 지원
        double sclX  = scl.containsKey("factorX") ? toDouble(scl.get("factorX")) : scl.containsKey("x") ? toDouble(scl.get("x")) : 1.0;
        double sclY  = scl.containsKey("factorY") ? toDouble(scl.get("factorY")) : scl.containsKey("y") ? toDouble(scl.get("y")) : 1.0;
        double sclZ  = scl.containsKey("factorZ") ? toDouble(scl.get("factorZ")) : scl.containsKey("z") ? toDouble(scl.get("z")) : 1.0;

        return bimService.bulkTransformDirect(projectId, elementIds,
                dPosX, dPosY, dPosZ, dRotX, dRotY, dRotZ, sclX, sclY, sclZ)
                .map(result -> ResponseEntity.ok(result));
    }

    /**
     * 다건 부재 절대값 일괄 업데이트 — Transform Gizmo 저장용
     * PUT /api/bim/project/{projectId}/batch-update
     *
     * 요청 바디: BimElementDTO 배열 (positionX/Y/Z, sizeX/Y/Z, rotationX/Y/Z 절대값)
     */
    @PutMapping("/project/{projectId}/batch-update")
    public Mono<ResponseEntity<Map<String, Object>>> batchUpdateElements(
            @PathVariable String projectId,
            @RequestBody List<BimElementDTO> elements) {
        return bimService.batchAbsoluteUpdate(projectId, elements)
                .map(result -> ResponseEntity.ok(result));
    }

    /**
     * 부재 통합 변환 API (이동·회전·크기 동시 적용)
     * PUT /api/bim/project/{projectId}/transform
     *
     * 요청 바디:
     * {
     *   "elementIds": ["ELEM-1", "ELEM-2"],   // 생략 시 전체 부재
     *   "position": { "deltaX": 0, "deltaY": 0, "deltaZ": -20 },
     *   "rotation": { "deltaX": 0, "deltaY": 0, "deltaZ": 45  },
     *   "scale":    { "factorX": 1, "factorY": 1, "factorZ": 2 }
     * }
     */
    @PutMapping("/project/{projectId}/transform")
    public Mono<ResponseEntity<Map<String, Object>>> transformElements(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> elementIds = body.containsKey("elementIds")
                ? (List<String>) body.get("elementIds") : null;

        Map<?, ?> pos = body.containsKey("position") ? (Map<?, ?>) body.get("position") : Map.of();
        Map<?, ?> rot = body.containsKey("rotation") ? (Map<?, ?>) body.get("rotation") : Map.of();
        Map<?, ?> scl = body.containsKey("scale")    ? (Map<?, ?>) body.get("scale")    : Map.of();

        double dPosX = toDouble(pos.get("deltaX")), dPosY = toDouble(pos.get("deltaY")), dPosZ = toDouble(pos.get("deltaZ"));
        double dRotX = toDouble(rot.get("deltaX")), dRotY = toDouble(rot.get("deltaY")), dRotZ = toDouble(rot.get("deltaZ"));
        double sclX  = scl.containsKey("factorX") ? toDouble(scl.get("factorX")) : 1.0;
        double sclY  = scl.containsKey("factorY") ? toDouble(scl.get("factorY")) : 1.0;
        double sclZ  = scl.containsKey("factorZ") ? toDouble(scl.get("factorZ")) : 1.0;

        return bimService.transformElements(projectId, elementIds,
                dPosX, dPosY, dPosZ, dRotX, dRotY, dRotZ, sclX, sclY, sclZ)
                .map(result -> ResponseEntity.ok(result));
    }

    /**
     * 선택된 부재만 이동 API
     * PUT /api/bim/project/{projectId}/translate-selected
     * 요청 바디: { "elementIds": ["ELEM-1", "ELEM-2"], "deltaX": 0, "deltaY": 0, "deltaZ": -20 }
     */
    @PutMapping("/project/{projectId}/translate-selected")
    public Mono<ResponseEntity<Map<String, Object>>> translateSelectedElements(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> elementIds = (List<String>) body.getOrDefault("elementIds", List.of());
        double dx = toDouble(body.get("deltaX"));
        double dy = toDouble(body.get("deltaY"));
        double dz = toDouble(body.get("deltaZ"));
        return bimService.translateSelectedElements(projectId, elementIds, dx, dy, dz)
                .map(result -> ResponseEntity.ok(result));
    }

    /**
     * 프로젝트 전체 부재 일괄 이동 API
     * PUT /api/bim/project/{projectId}/translate
     * 요청 바디: { "deltaX": 0, "deltaY": 0, "deltaZ": -20 }
     *
     * 프로젝트 내 모든 부재의 positionX/Y/Z에 오프셋을 더한 후
     * C# 서버로 각 부재를 병렬 업데이트합니다.
     */
    @PutMapping("/project/{projectId}/translate")
    public Mono<ResponseEntity<Map<String, Object>>> translateElements(
            @PathVariable String projectId,
            @RequestBody Map<String, Double> body) {
        double dx = body.getOrDefault("deltaX", 0.0);
        double dy = body.getOrDefault("deltaY", 0.0);
        double dz = body.getOrDefault("deltaZ", 0.0);
        return bimService.translateProjectElements(projectId, dx, dy, dz)
                .map(result -> ResponseEntity.ok(result));
    }

    /**
     * IFC 원본 파일 보유 여부 확인
     * GET /api/bim/project/{projectId}/ifc/status
     *
     * 프론트에서 재업로드 버튼 노출 여부 결정 등에 사용
     */
    @GetMapping("/project/{projectId}/ifc/status")
    public ResponseEntity<Map<String, Object>> getIfcStatus(@PathVariable String projectId) {
        String storageKey = bimService.getStorageKey(projectId);
        return ResponseEntity.ok(Map.of(
                "hasIfcFile", storageKey != null,
                "storageKey", storageKey != null ? storageKey : ""
        ));
    }

    // ================================================================
    // 서버 사이드 IFC → GLB 변환 (B안: 렌더링 성능 개선)
    // ================================================================

    /**
     * IFC 파일을 Python 변환 서비스로 보내 GLB로 변환하고 Minio에 저장.
     * POST /api/bim/project/{projectId}/convert-ifc
     *
     * 1. IFC 원본 → Minio 저장
     * 2. Python /api/ifc/convert 호출 → GLB 바이너리 + 메타데이터 수신
     * 3. GLB → Minio 저장 (projects/{projectId}/model.glb)
     * 4. elements / storeys 를 DB에 저장
     * 5. 프로젝트 생성 및 완료 정보 반환
     */
    @PostMapping(value = "/project/{projectId}/convert-ifc", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Mono<ResponseEntity<Map<String, Object>>> convertIfcFile(
            @PathVariable String projectId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "scale", defaultValue = "1.0") double scale) {

        if (file == null || file.isEmpty()) {
            return Mono.just(ResponseEntity.badRequest()
                    .<Map<String, Object>>body(Map.of("error", "파일이 비어 있습니다.")));
        }

        return bimService.convertAndStoreIfc(projectId, file, scale)
                .map(result -> ResponseEntity.ok(result))
                .onErrorResume(e -> {
                    System.err.println("[BIM] IFC 변환 실패: " + e.getMessage());
                    return Mono.just(ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                            .<Map<String, Object>>body(Map.of("error", e.getMessage())));
                });
    }

    /**
     * 변환된 GLB 파일 서빙
     * GET /api/bim/project/{projectId}/glb
     *
     * 프론트의 GLTFLoader가 직접 이 URL로 fetch해서 렌더링.
     */
    @GetMapping("/project/{projectId}/glb")
    public ResponseEntity<InputStreamResource> downloadGlbFile(@PathVariable String projectId) {
        try {
            String key = bimService.getGlbStorageKey(projectId);
            if (key == null) {
                return ResponseEntity.notFound().build();
            }
            InputStreamResource resource = new InputStreamResource(bimService.downloadGlbFile(projectId));
            return ResponseEntity.ok()
                    .header("Content-Disposition", "inline; filename=\"model.glb\"")
                    .contentType(MediaType.valueOf("model/gltf-binary"))
                    .body(resource);
        } catch (StorageException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * 변환된 Lite GLB 파일 서빙 (convex hull 단순화 버전)
     * GET /api/bim/project/{projectId}/glb/lite
     */
    @GetMapping("/project/{projectId}/glb/lite")
    public ResponseEntity<InputStreamResource> downloadGlbLiteFile(@PathVariable String projectId) {
        try {
            java.io.InputStream is = bimService.downloadGlbLiteFile(projectId);
            return ResponseEntity.ok()
                    .header("Content-Disposition", "inline; filename=\"model_lite.glb\"")
                    .contentType(MediaType.valueOf("model/gltf-binary"))
                    .body(new InputStreamResource(is));
        } catch (Exception e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GLB 보유 여부 확인
     * GET /api/bim/project/{projectId}/glb/status
     */
    @GetMapping("/project/{projectId}/glb/status")
    public ResponseEntity<Map<String, Object>> getGlbStatus(@PathVariable String projectId) {
        String key = bimService.getGlbStorageKey(projectId);
        return ResponseEntity.ok(Map.of("hasGlb", key != null));
    }

    // ================================================================
    // Ollama 층 이름 정규화
    // ================================================================

    /**
     * IFC 층 이름 목록을 로컬 Ollama 3B 모델로 정규화합니다.
     * POST /api/bim/normalize-storeys
     * 요청: { "names": ["Story 1", "EG", "Dachgeschoss", ...] }
     * 응답: { "Story 1": "1F", "EG": "1F", "Dachgeschoss": "RF", ... }
     */
    @PostMapping("/normalize-storeys")
    public ResponseEntity<Map<String, String>> normalizeStoreys(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> names = (List<String>) body.getOrDefault("names", List.of());
        return ResponseEntity.ok(bimService.normalizeStoreyNames(names));
    }

    /**
     * GLB 노드 translation 누적 패치 — 에이전트 부재 이동 후 뷰어 시각 반영
     * PUT /api/bim/project/{projectId}/apply-glb-delta
     * 요청: { "elementIds": [...] or null, "deltaX": 0, "deltaY": 0, "deltaZ": -10 }
     */
    @PutMapping("/project/{projectId}/apply-glb-delta")
    public Mono<ResponseEntity<Map<String, Object>>> applyGlbDelta(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<String> elementIds = body.containsKey("elementIds")
                ? (List<String>) body.get("elementIds") : null;
        double dx = toDouble(body.get("deltaX"));
        double dy = toDouble(body.get("deltaY"));
        double dz = toDouble(body.get("deltaZ"));
        return bimService.applyGlbDelta(projectId, elementIds, dx, dy, dz)
                .map(ResponseEntity::ok);
    }
}
