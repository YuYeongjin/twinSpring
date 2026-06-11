package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import yyj.project.twinspring.dao.WbsDAO;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * WBS 태스크 진척도 자동 갱신 스케줄러 (매 시간 정각 실행).
 *
 * 동작 원칙:
 *  - 세부 공정: 선행 공정이 100% 완료된 후 날짜 비례로 진척
 *  - 부모 태스크: 세부 공정 평균값으로 갱신
 *  - 진척도는 감소하지 않음 (수동 입력 또는 시뮬레이션으로 올라간 값 보존)
 *  - 날짜가 없는 태스크는 건너뜀
 */
@Component
public class WbsProgressScheduler {

    private static final Logger log = LoggerFactory.getLogger(WbsProgressScheduler.class);

    private final WbsDAO wbsDAO;

    public WbsProgressScheduler(WbsDAO wbsDAO) {
        this.wbsDAO = wbsDAO;
    }

    @Scheduled(cron = "0 0 * * * *")
    public void advanceWbsProgress() {
        List<Map<String, Object>> allTasks = wbsDAO.getAllTasks();
        if (allTasks.isEmpty()) return;

        LocalDate today = LocalDate.now();

        // sortOrder 기준 정렬 → 선행 공정이 먼저 처리됨
        List<Map<String, Object>> sorted = allTasks.stream()
            .sorted(Comparator.comparingInt(t -> toInt(t.get("sortOrder"), 0)))
            .collect(Collectors.toList());

        // 진척도 작업 맵 (선행 체크 및 부모 계산에 사용)
        Map<String, Integer> progMap = new HashMap<>();
        allTasks.forEach(t -> progMap.put((String) t.get("taskId"), toInt(t.get("progress"), 0)));

        // ── 1단계: 세부 공정 진척도 계산 ─────────────────────────────
        for (Map<String, Object> task : sorted) {
            String taskId       = (String) task.get("taskId");
            String parentTaskId = (String) task.get("parentTaskId");
            if (parentTaskId == null) continue;

            String status    = (String) task.get("status");
            String startDate = (String) task.get("startDate");
            String endDate   = (String) task.get("endDate");
            String predIds   = (String) task.get("predecessorIds");
            int    oldProg   = toInt(task.get("progress"), 0);

            if ("COMPLETED".equals(status)) {
                progMap.put(taskId, 100);
                continue;
            }
            if (startDate == null || endDate == null) continue;

            // 선행 공정 완료 여부 확인 (progMap 기준 — 이미 갱신된 값 반영)
            boolean predsOk = true;
            if (predIds != null && !predIds.isBlank()) {
                for (String pid : predIds.split(",")) {
                    String trimmed = pid.trim();
                    if (!trimmed.isEmpty() && progMap.getOrDefault(trimmed, 0) < 100) {
                        predsOk = false;
                        break;
                    }
                }
            }

            int newProg = predsOk ? calcDateProgress(startDate, endDate, today) : 0;
            progMap.put(taskId, Math.max(oldProg, newProg)); // 진척도 감소 금지
        }

        // ── 2단계: 부모 태스크 진척도 = 세부 공정 평균 ───────────────
        for (Map<String, Object> task : sorted) {
            String taskId       = (String) task.get("taskId");
            String parentTaskId = (String) task.get("parentTaskId");
            if (parentTaskId != null) continue;

            String finalTaskId = taskId;
            List<Integer> childProgs = sorted.stream()
                .filter(t -> finalTaskId.equals(t.get("parentTaskId")))
                .map(t -> progMap.getOrDefault((String) t.get("taskId"), 0))
                .collect(Collectors.toList());

            if (!childProgs.isEmpty()) {
                int avg = (int) Math.round(
                    childProgs.stream().mapToInt(Integer::intValue).average().orElse(0)
                );
                int oldProg = toInt(task.get("progress"), 0);
                progMap.put(taskId, Math.max(oldProg, avg));
            } else {
                // 세부 공정 없는 일반 태스크: 날짜 기반
                String startDate = (String) task.get("startDate");
                String endDate   = (String) task.get("endDate");
                String status    = (String) task.get("status");
                if ("COMPLETED".equals(status)) { progMap.put(taskId, 100); continue; }
                if (startDate != null && endDate != null) {
                    int newProg = calcDateProgress(startDate, endDate, today);
                    int oldProg = toInt(task.get("progress"), 0);
                    progMap.put(taskId, Math.max(oldProg, newProg));
                }
            }
        }

        // ── 3단계: 변경된 태스크만 DB 업데이트 ───────────────────────
        int updatedCount = 0;
        for (Map<String, Object> task : allTasks) {
            String taskId    = (String) task.get("taskId");
            int    oldProg   = toInt(task.get("progress"), 0);
            String oldStatus = (String) task.get("status");

            Integer newProg = progMap.get(taskId);
            if (newProg == null) continue;

            String newStatus = deriveStatus(oldStatus, newProg,
                (String) task.get("startDate"), (String) task.get("endDate"), today);

            if (newProg == oldProg && newStatus.equals(oldStatus)) continue;

            Map<String, Object> row = new HashMap<>(task);
            row.put("progress", newProg);
            row.put("status",   newStatus);
            wbsDAO.updateTask(row);
            updatedCount++;
        }

        if (updatedCount > 0) {
            log.info("[WbsScheduler] {} task(s) updated (date={})", updatedCount, today);
        }
    }

    /**
     * startDate ~ endDate 기간 중 today의 위치를 0~100% 로 계산.
     */
    private int calcDateProgress(String startStr, String endStr, LocalDate today) {
        try {
            LocalDate start = LocalDate.parse(startStr);
            LocalDate end   = LocalDate.parse(endStr);
            if (today.isBefore(start)) return 0;
            if (!today.isBefore(end))  return 100;
            long total   = ChronoUnit.DAYS.between(start, end);
            long elapsed = ChronoUnit.DAYS.between(start, today);
            if (total <= 0) return 100;
            return (int) Math.min(100, Math.round((double) elapsed / total * 100));
        } catch (Exception e) {
            return 0;
        }
    }

    /**
     * 진척도 → 상태 변환.
     * 수동으로 COMPLETED 처리된 태스크는 변경하지 않음.
     */
    private String deriveStatus(String current, int progress,
                                String startDate, String endDate, LocalDate today) {
        if (progress >= 100)             return "COMPLETED";
        if (progress > 0)                return "IN_PROGRESS";
        // progress == 0
        if (endDate != null) {
            try {
                if (today.isAfter(LocalDate.parse(endDate))) return "DELAYED";
            } catch (Exception ignored) {}
        }
        return "NOT_STARTED";
    }

    private int toInt(Object v, int def) {
        if (v == null) return def;
        if (v instanceof Number) return ((Number) v).intValue();
        try { return Integer.parseInt(v.toString()); } catch (Exception e) { return def; }
    }
}
