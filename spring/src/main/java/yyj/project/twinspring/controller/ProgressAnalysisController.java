package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dao.ProgressAnalysisDAO;
import yyj.project.twinspring.dao.ProjectLinkDAO;
import yyj.project.twinspring.serviceImpl.MonitoringSchedulerService;

import java.util.List;
import java.util.Map;

/**
 * 공정 진도 분석 API
 *
 * GET  /api/progress-analysis?safeProjectId={id}   — Safe 프로젝트 분석 기록 목록
 * GET  /api/progress-analysis/task/{taskId}         — WBS 태스크별 분석 기록
 * POST /api/progress-analysis/trigger               — 수동 분석 트리거
 */
@RestController
@RequestMapping("/api/progress-analysis")
public class ProgressAnalysisController {

    private final ProgressAnalysisDAO progressAnalysisDAO;
    private final ProjectLinkDAO      projectLinkDAO;

    public ProgressAnalysisController(ProgressAnalysisDAO progressAnalysisDAO,
                                      ProjectLinkDAO projectLinkDAO) {
        this.progressAnalysisDAO = progressAnalysisDAO;
        this.projectLinkDAO      = projectLinkDAO;
    }

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getAnalysesBySafeProject(
            @RequestParam String safeProjectId) {
        // Safe 프로젝트 → WBS 프로젝트 역방향 조회
        List<Map<String, Object>> links = projectLinkDAO.getWbsByLinkedProject("SAFE", safeProjectId);
        if (links == null || links.isEmpty()) return ResponseEntity.ok(List.of());

        String wbsProjectId = (String) links.get(0).get("wbsProjectId");
        return ResponseEntity.ok(progressAnalysisDAO.getAnalysisByProject(wbsProjectId));
    }

    @GetMapping("/task/{taskId}")
    public ResponseEntity<List<Map<String, Object>>> getAnalysesByTask(@PathVariable String taskId) {
        return ResponseEntity.ok(progressAnalysisDAO.getAnalysisByTask(taskId));
    }

    /** 수동 분석 트리거 — 프론트에서 "지금 분석" 버튼 클릭 시 호출 */
    @PostMapping("/trigger")
    public ResponseEntity<Map<String, Object>> triggerAnalysis(@RequestBody Map<String, String> body) {
        // 현재는 202 Accepted 응답 후 다음 스케줄 tick에서 처리됨
        // TODO: 즉시 실행이 필요한 경우 MonitoringSchedulerService.tick() 직접 호출 가능
        return ResponseEntity.accepted().body(Map.of(
            "status",  "queued",
            "message", "다음 스케줄 틱(~5초)에 분석이 실행됩니다."
        ));
    }
}
