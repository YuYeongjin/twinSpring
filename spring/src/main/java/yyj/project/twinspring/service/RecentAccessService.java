package yyj.project.twinspring.service;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedDeque;

@Component
public class RecentAccessService {

    private static final int MAX_ENTRIES = 200;

    public record AccessEntry(String ip, String method, String uri, int status, long timestamp) {}

    private final ConcurrentLinkedDeque<AccessEntry> buffer = new ConcurrentLinkedDeque<>();

    public void record(String ip, String method, String uri, int status) {
        // /api/auth/ip-allowed, /api/system/* 는 폴링 노이즈이므로 제외
        if (uri.startsWith("/api/system/") || uri.equals("/api/auth/ip-allowed")) return;

        buffer.addFirst(new AccessEntry(ip, method, uri, status, Instant.now().toEpochMilli()));
        while (buffer.size() > MAX_ENTRIES) buffer.removeLast();
    }

    /** 최근 방문 IP 집계: IP별 마지막 접속시각, 요청 수, 마지막 URI */
    public List<Map<String, Object>> getRecentVisitors() {
        Map<String, Map<String, Object>> byIp = new LinkedHashMap<>();
        for (AccessEntry e : buffer) {
            byIp.computeIfAbsent(e.ip(), ip -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("ip",        ip);
                m.put("count",     0);
                m.put("lastTime",  0L);
                m.put("lastUri",   "");
                m.put("lastStatus",0);
                return m;
            });
            Map<String, Object> m = byIp.get(e.ip());
            m.put("count", (int) m.get("count") + 1);
            if (e.timestamp() > (long) m.get("lastTime")) {
                m.put("lastTime",   e.timestamp());
                m.put("lastUri",    e.uri());
                m.put("lastStatus", e.status());
            }
        }
        return new ArrayList<>(byIp.values());
    }

    /** 원시 로그 최근 N건 */
    public List<Map<String, Object>> getRecentLog(int limit) {
        List<Map<String, Object>> result = new ArrayList<>();
        int count = 0;
        for (AccessEntry e : buffer) {
            if (count++ >= limit) break;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("ip",        e.ip());
            m.put("method",    e.method());
            m.put("uri",       e.uri());
            m.put("status",    e.status());
            m.put("timestamp", e.timestamp());
            result.add(m);
        }
        return result;
    }
}
