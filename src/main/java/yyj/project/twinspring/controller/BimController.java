package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimElementDTO;
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
     * C# POST /api/bim/element/new 로 프록시, 생성된 부재(elementId 포함) 반환
     */
    @PostMapping("/element")
    public Mono<ResponseEntity<BimElementDTO>> createElement(@RequestBody BimElementDTO element) {
        return bimService.createElement(element)
                .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created));
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
