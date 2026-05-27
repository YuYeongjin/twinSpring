package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.SafeProjectDTO;
import yyj.project.twinspring.service.SafeProjectService;

import java.util.List;

/**
 * 안전 모니터링 프로젝트(현장 단위) REST API
 *
 * /api/safe/projects       — 목록
 * /api/safe/project        — 생성
 * /api/safe/project/{id}   — 단건 조회 / 수정 / 삭제
 */
@RestController
@RequestMapping("/api/safe")
public class SafeProjectController {

    private final SafeProjectService safeService;

    public SafeProjectController(SafeProjectService safeService) {
        this.safeService = safeService;
    }

    @GetMapping("/projects")
    public ResponseEntity<List<SafeProjectDTO>> getAllProjects() {
        return ResponseEntity.ok(safeService.getAllProjects());
    }

    @GetMapping("/project/{projectId}")
    public ResponseEntity<SafeProjectDTO> getProject(@PathVariable String projectId) {
        SafeProjectDTO dto = safeService.getProjectById(projectId);
        return dto != null ? ResponseEntity.ok(dto) : ResponseEntity.notFound().build();
    }

    @PostMapping("/project")
    public ResponseEntity<SafeProjectDTO> createProject(@RequestBody SafeProjectDTO dto) {
        if (dto.getProjectName() == null || dto.getProjectName().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(safeService.createProject(dto));
    }

    @PutMapping("/project/{projectId}")
    public ResponseEntity<Void> updateProject(
            @PathVariable String projectId,
            @RequestBody SafeProjectDTO dto) {
        safeService.updateProject(projectId, dto);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/project/{projectId}")
    public ResponseEntity<Void> deleteProject(@PathVariable String projectId) {
        safeService.deleteProject(projectId);
        return ResponseEntity.noContent().build();
    }
}
