package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.ProjectLinkDTO;
import yyj.project.twinspring.service.ProjectLinkService;

import java.util.List;
import java.util.Map;

/**
 * WBS ↔ BIM / Safe / Simulation 프로젝트 연결 API
 *
 * GET  /api/project-link/wbs/{wbsProjectId}              — WBS에 연결된 모든 링크
 * GET  /api/project-link/linked?type=BIM&id={linkedId}   — 역방향 조회
 * POST /api/project-link                                 — 링크 생성
 * DELETE /api/project-link/{linkId}                      — 링크 삭제
 */
@RestController
@RequestMapping("/api/project-link")
public class ProjectLinkController {

    private final ProjectLinkService linkService;

    public ProjectLinkController(ProjectLinkService linkService) {
        this.linkService = linkService;
    }

    @GetMapping("/wbs/{wbsProjectId}")
    public ResponseEntity<List<ProjectLinkDTO>> getByWbs(@PathVariable String wbsProjectId) {
        return ResponseEntity.ok(linkService.getLinksByWbsProject(wbsProjectId));
    }

    @GetMapping("/linked")
    public ResponseEntity<List<ProjectLinkDTO>> getByLinked(
            @RequestParam String type,
            @RequestParam String id) {
        return ResponseEntity.ok(linkService.getWbsByLinkedProject(type, id));
    }

    @PostMapping
    public ResponseEntity<ProjectLinkDTO> createLink(@RequestBody ProjectLinkDTO dto) {
        if (dto.getWbsProjectId() == null || dto.getLinkedType() == null || dto.getLinkedProjectId() == null) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(linkService.createLink(dto));
    }

    /**
     * 단건 삭제
     */
    @DeleteMapping("/{linkId}")
    public ResponseEntity<Void> deleteLink(@PathVariable String linkId) {
        linkService.deleteLink(linkId);
        return ResponseEntity.noContent().build();
    }

    /**
     * 배치 생성: 여러 프로젝트를 한 번에 연결
     * Body: { "wbsProjectId": "...", "links": [{ "linkedType": "BIM", "linkedProjectId": "..." }, ...] }
     */
    @PostMapping("/batch")
    public ResponseEntity<List<ProjectLinkDTO>> createLinksBatch(@RequestBody Map<String, Object> body) {
        String wbsProjectId = (String) body.get("wbsProjectId");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> links = (List<Map<String, Object>>) body.get("links");
        if (wbsProjectId == null || links == null || links.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        List<ProjectLinkDTO> created = links.stream().map(l -> {
            ProjectLinkDTO dto = new ProjectLinkDTO();
            dto.setWbsProjectId(wbsProjectId);
            dto.setLinkedType((String) l.get("linkedType"));
            dto.setLinkedProjectId((String) l.get("linkedProjectId"));
            dto.setNote((String) l.getOrDefault("note", ""));
            return linkService.createLink(dto);
        }).toList();
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }
}
