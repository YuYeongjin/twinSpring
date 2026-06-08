package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.IntegrationProjectDTO;
import yyj.project.twinspring.service.IntegrationService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/integration")
public class IntegrationController {

    private final IntegrationService integrationService;

    public IntegrationController(IntegrationService integrationService) {
        this.integrationService = integrationService;
    }

    @GetMapping("/projects")
    public ResponseEntity<List<IntegrationProjectDTO>> getProjects(
            @RequestParam(required = false) String wbsProjectId) {
        List<IntegrationProjectDTO> result = (wbsProjectId != null && !wbsProjectId.isBlank())
                ? integrationService.getIntegrationProjectsByWbs(wbsProjectId)
                : integrationService.getIntegrationProjects();
        return ResponseEntity.ok(result);
    }

    @GetMapping("/project/{projectId}")
    public ResponseEntity<IntegrationProjectDTO> getProject(@PathVariable String projectId) {
        IntegrationProjectDTO dto = integrationService.getIntegrationProject(projectId);
        if (dto == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(dto);
    }

    @PostMapping("/project")
    public ResponseEntity<IntegrationProjectDTO> createProject(@RequestBody Map<String, String> body) {
        String projectName = body.get("projectName");
        if (projectName == null || projectName.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        IntegrationProjectDTO created = integrationService.createIntegrationProject(body);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/project/{projectId}")
    public ResponseEntity<IntegrationProjectDTO> updateProject(
            @PathVariable String projectId,
            @RequestBody Map<String, String> body) {
        IntegrationProjectDTO updated = integrationService.updateIntegrationProject(projectId, body);
        if (updated == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(updated);
    }

    @PutMapping("/project/{projectId}/sim-config")
    public ResponseEntity<Void> updateSimConfig(
            @PathVariable String projectId,
            @RequestBody Map<String, String> body) {
        String simConfig = body.get("simConfig");
        if (simConfig == null) return ResponseEntity.badRequest().build();
        integrationService.updateSimConfig(projectId, simConfig);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/project/{projectId}")
    public ResponseEntity<Void> deleteProject(@PathVariable String projectId) {
        integrationService.deleteIntegrationProject(projectId);
        return ResponseEntity.noContent().build();
    }
}
