package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.WbsProjectDTO;
import yyj.project.twinspring.dto.WbsTaskDTO;
import yyj.project.twinspring.service.WbsService;

import java.util.List;
import java.util.Map;

/**
 * WBS (Work Breakdown Structure) REST API
 *
 * /api/wbs/projects          — 프로젝트 목록
 * /api/wbs/project           — 프로젝트 생성
 * /api/wbs/project/{id}      — 단건 조회 / 수정 / 삭제
 * /api/wbs/tasks             — 전체 태스크 (통합 간트용)
 * /api/wbs/project/{id}/tasks— 프로젝트 태스크 CRUD
 * /api/wbs/project/{id}/agent-tasks — Agent 자동 태스크 추가
 */
@RestController
@RequestMapping("/api/wbs")
public class WbsController {

    private final WbsService wbsService;

    public WbsController(WbsService wbsService) {
        this.wbsService = wbsService;
    }

    // ══════════════════════════════ PROJECT ═══════════════════════════════════

    @GetMapping("/projects")
    public ResponseEntity<List<WbsProjectDTO>> getAllProjects() {
        return ResponseEntity.ok(wbsService.getAllProjects());
    }

    @GetMapping("/project/{projectId}")
    public ResponseEntity<WbsProjectDTO> getProject(@PathVariable String projectId) {
        WbsProjectDTO dto = wbsService.getProjectById(projectId);
        return dto != null ? ResponseEntity.ok(dto) : ResponseEntity.notFound().build();
    }

    @PostMapping("/project")
    public ResponseEntity<WbsProjectDTO> createProject(@RequestBody WbsProjectDTO dto) {
        if (dto.getProjectName() == null || dto.getProjectName().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(wbsService.createProject(dto));
    }

    @PutMapping("/project/{projectId}")
    public ResponseEntity<Void> updateProject(
            @PathVariable String projectId,
            @RequestBody WbsProjectDTO dto) {
        wbsService.updateProject(projectId, dto);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/project/{projectId}")
    public ResponseEntity<Void> deleteProject(@PathVariable String projectId) {
        wbsService.deleteProject(projectId);
        return ResponseEntity.noContent().build();
    }

    // ══════════════════════════════ TASK ══════════════════════════════════════

    /** 전체 프로젝트 태스크 (통합 간트 차트용) */
    @GetMapping("/tasks")
    public ResponseEntity<List<WbsTaskDTO>> getAllTasks() {
        return ResponseEntity.ok(wbsService.getAllTasks());
    }

    @GetMapping("/project/{projectId}/tasks")
    public ResponseEntity<List<WbsTaskDTO>> getTasksByProject(@PathVariable String projectId) {
        return ResponseEntity.ok(wbsService.getTasksByProject(projectId));
    }

    @PostMapping("/project/{projectId}/task")
    public ResponseEntity<WbsTaskDTO> createTask(
            @PathVariable String projectId,
            @RequestBody WbsTaskDTO dto) {
        dto.setWbsProjectId(projectId);
        return ResponseEntity.status(HttpStatus.CREATED).body(wbsService.createTask(dto));
    }

    @PutMapping("/task/{taskId}")
    public ResponseEntity<Void> updateTask(
            @PathVariable String taskId,
            @RequestBody WbsTaskDTO dto) {
        wbsService.updateTask(taskId, dto);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/task/{taskId}")
    public ResponseEntity<Void> deleteTask(@PathVariable String taskId) {
        wbsService.deleteTask(taskId);
        return ResponseEntity.noContent().build();
    }

    /**
     * Agent 자동 태스크 추가 엔드포인트
     *
     * Request body:
     * {
     *   "source": "AGENT_CPM" | "AGENT_CRACK" | "AGENT_AUTO",
     *   "tasks": [ { "taskName": "...", "startDate": "...", ... }, ... ]
     * }
     */
    @PostMapping("/project/{projectId}/agent-tasks")
    public ResponseEntity<List<WbsTaskDTO>> addAgentTasks(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        String source = (String) body.getOrDefault("source", "AGENT_AUTO");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) body.get("tasks");
        if (tasks == null || tasks.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        List<WbsTaskDTO> created = wbsService.addAgentTasks(projectId, tasks, source);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }
}
