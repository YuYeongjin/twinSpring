package yyj.project.twinspring.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dao.SettingsDAO;

import java.util.*;

/**
 * 사용자 설정 및 대화 히스토리 API
 *
 * GET    /api/settings               — 전체 설정 조회
 * GET    /api/settings/{key}         — 단건 조회
 * PUT    /api/settings/{key}         — 값 수정
 * GET    /api/chat-history/{sessionId}     — 세션 대화 조회
 * POST   /api/chat-history/{sessionId}     — 대화 저장
 * DELETE /api/chat-history/{sessionId}     — 세션 기록 삭제
 */
@RestController
public class SettingsController {

    private final SettingsDAO settingsDAO;
    private final Set<String> allowedIps;

    public SettingsController(SettingsDAO settingsDAO,
                              @Value("${settings.allowed-ips}") List<String> allowedIpList) {
        this.settingsDAO = settingsDAO;
        this.allowedIps = new HashSet<>(allowedIpList);
    }

    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("CF-Connecting-IP");
        if (ip == null) ip = request.getHeader("X-Forwarded-For");
        if (ip == null) ip = request.getRemoteAddr();
        return ip != null ? ip.split(",")[0].trim() : "unknown";
    }

    @GetMapping("/api/auth/ip-allowed")
    public ResponseEntity<Map<String, Boolean>> isIpAllowed(HttpServletRequest request) {
        String ip = getClientIp(request);
        return ResponseEntity.ok(Map.of("allowed", allowedIps.contains(ip)));
    }

    // ══════════════════════════════ SETTINGS ══════════════════════════════════

    @GetMapping("/api/settings")
    public ResponseEntity<List<Map<String, Object>>> getAllSettings() {
        return ResponseEntity.ok(settingsDAO.getAllSettings());
    }

    @GetMapping("/api/settings/{key}")
    public ResponseEntity<Map<String, Object>> getSetting(@PathVariable String key) {
        Map<String, Object> s = settingsDAO.getSetting(key);
        return s != null ? ResponseEntity.ok(s) : ResponseEntity.notFound().build();
    }

    @PutMapping("/api/settings/{key}")
    public ResponseEntity<Void> updateSetting(
            @PathVariable String key,
            @RequestBody Map<String, String> body) {
        String value = body.getOrDefault("value", "");
        Map<String, Object> p = new HashMap<>();
        p.put("settingKey",   key);
        p.put("settingValue", value);
        settingsDAO.upsertSetting(p);
        return ResponseEntity.ok().build();
    }

    // ══════════════════════════════ CHAT HISTORY ══════════════════════════════

    @GetMapping("/api/chat-history/{sessionId}")
    public ResponseEntity<List<Map<String, Object>>> getChatHistory(
            @PathVariable String sessionId,
            @RequestParam(defaultValue = "100") int limit) {
        Map<String, Object> p = new HashMap<>();
        p.put("sessionId", sessionId);
        p.put("limit",     limit);
        List<Map<String, Object>> rows = settingsDAO.getChatHistory(p);
        Collections.reverse(rows);
        return ResponseEntity.ok(rows);
    }

    @PostMapping("/api/chat-history/{sessionId}")
    public ResponseEntity<Void> saveChatHistory(
            @PathVariable String sessionId,
            @RequestBody List<Map<String, Object>> messages) {
        if (messages == null || messages.isEmpty()) return ResponseEntity.ok().build();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> m : messages) {
            Map<String, Object> row = new HashMap<>();
            row.put("sessionId", sessionId);
            row.put("role",      m.getOrDefault("role",    "user").toString());
            row.put("content",   m.getOrDefault("content", "").toString());
            rows.add(row);
        }
        settingsDAO.insertChatMessages(rows);
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/api/chat-history/{sessionId}")
    public ResponseEntity<Void> deleteChatHistory(@PathVariable String sessionId) {
        settingsDAO.deleteChatHistoryBySession(sessionId);
        return ResponseEntity.noContent().build();
    }

    /** 매일 새벽 3시 만료된 대화 기록 정리 */
    @Scheduled(cron = "0 0 3 * * *")
    public void cleanupExpiredHistory() {
        Map<String, Object> retSetting = settingsDAO.getSetting("chat_history_retention_days");
        int days = 30;
        if (retSetting != null) {
            try { days = Integer.parseInt(retSetting.get("settingValue").toString()); }
            catch (Exception ignored) {}
        }
        if (days <= 0) return; // 0 = 무제한 보존
        Map<String, Object> p = new HashMap<>();
        p.put("retentionDays", days);
        settingsDAO.deleteExpiredChatHistory(p);
    }
}
