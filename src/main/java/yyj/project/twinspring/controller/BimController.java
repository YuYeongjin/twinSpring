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
@CrossOrigin(origins = "*")
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
    @DeleteMapping("/project/{projectId}")
    public ResponseEntity<Mono<Void>> deleteProject(@PathVariable String projectId) {
        return bimService.deleteProject(projectId);
    }
    @PutMapping("/model/element")
    public ResponseEntity<Mono<Void>> updateElement(@RequestBody BimElementDTO element){
        return bimService.updateElement(element);
    }
    @PostMapping("/project")
    public Mono<ResponseEntity<BimProjectDTO>> newProject(@RequestBody Map<String,String> project){
        System.out.println("PROJECT CREATE : " + project);
        BimProjectDTO projectDTO = new BimProjectDTO();
        projectDTO.setProjectId(project.get("projectId"));
        projectDTO.setProjectName(project.get("projectName"));
        projectDTO.setSpanCount((project.get("spanCount")));
        projectDTO.setStructureType(project.get("structureType"));
        return bimService.createProject(projectDTO)
                // C# 서버가 반환한 DTO 객체를 201 Created 상태와 함께 반환
                .map(createdProject -> ResponseEntity.status(HttpStatus.CREATED).body(createdProject));
    }
}
