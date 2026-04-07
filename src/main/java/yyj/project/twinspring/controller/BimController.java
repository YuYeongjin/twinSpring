package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimElementColorDTO;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimLayerDTO;
import yyj.project.twinspring.dto.BimLineDTO;
import yyj.project.twinspring.dto.BimProjectDTO;
import yyj.project.twinspring.service.BimService;

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

    @PostMapping("/project")
    public Mono<ResponseEntity<BimProjectDTO>> newProject(@RequestBody Map<String,String> project){
        System.out.println("PROJECT CREATE : " + project);
        BimProjectDTO projectDTO = new BimProjectDTO();
        projectDTO.setProjectName(project.get("projectName"));
        projectDTO.setSpanCount((project.get("spanCount")));
        projectDTO.setStructureType(project.get("structureType"));
        return bimService.createProject(projectDTO)
                // C# 서버가 반환한 DTO 객체를 201 Created 상태와 함께 반환
                .map(createdProject -> ResponseEntity.status(HttpStatus.CREATED).body(createdProject));
    }
}
