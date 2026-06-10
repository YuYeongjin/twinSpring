package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dao.DailyReportDAO;

import java.util.List;
import java.util.Map;

/**
 * 통합관제 일일 작업 일보 API
 *
 *  POST /api/integration/project/{projectId}/daily-report         — 현재 상태 저장(upsert)
 *  GET  /api/integration/project/{projectId}/daily-report/dates   — 저장된 날짜 목록
 *  GET  /api/integration/project/{projectId}/daily-report/{date}  — 날짜별 일보 조회
 */
@RestController
@RequestMapping("/api/integration/project/{projectId}/daily-report")
public class DailyReportController {

    private final DailyReportDAO dailyReportDAO;

    public DailyReportController(DailyReportDAO dailyReportDAO) {
        this.dailyReportDAO = dailyReportDAO;
    }

    /** 저장된 날짜 목록 (최근 90일) — /dates 가 /{date} 보다 먼저 선언되어야 충돌 없음 */
    @GetMapping("/dates")
    public ResponseEntity<List<String>> getAvailableDates(@PathVariable String projectId) {
        return ResponseEntity.ok(dailyReportDAO.getAvailableDates(projectId));
    }

    /** 특정 날짜 일보 조회 + 전날 데이터 포함 (date: YYYY-MM-DD) */
    @GetMapping("/{date}")
    public ResponseEntity<Map<String, Object>> getReport(
            @PathVariable String projectId,
            @PathVariable String date) {
        Map<String, Object> report = dailyReportDAO.getDailyReport(projectId, date);
        if (report == null) {
            return ResponseEntity.notFound().build();
        }
        // 전날 진척도를 함께 반환 — 프론트에서 일단위 증감 계산에 사용
        Map<String, Object> prev = dailyReportDAO.getPrevDayProgress(projectId, date);
        if (prev != null) {
            report.put("prevOverallProgress", prev.get("overallProgress"));
            report.put("prevTaskSnapshot",    prev.get("taskSnapshot"));
            report.put("prevDate",            prev.get("reportDate"));
        }
        return ResponseEntity.ok(report);
    }

    /** 현재 통합관제 상태를 오늘(또는 지정 날짜) 일보로 저장 */
    @PostMapping
    public ResponseEntity<Void> saveReport(
            @PathVariable String projectId,
            @RequestBody Map<String, Object> body) {
        body.put("projectId", projectId);
        // reportDate 없으면 오늘 날짜 사용
        if (!body.containsKey("reportDate") || body.get("reportDate") == null) {
            body.put("reportDate", java.time.LocalDate.now().toString());
        }
        dailyReportDAO.upsertDailyReport(body);
        return ResponseEntity.ok().build();
    }
}
