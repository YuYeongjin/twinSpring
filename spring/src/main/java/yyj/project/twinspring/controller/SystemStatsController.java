package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import yyj.project.twinspring.service.GeoLookupService;
import yyj.project.twinspring.service.NginxLogService;
import yyj.project.twinspring.service.RecentAccessService;
import yyj.project.twinspring.service.SystemMetricsHistory;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 호스트 시스템 리소스 모니터링 API
 *
 * Kubernetes 환경에서 실제 노트북(호스트) 자원을 읽으려면
 * Deployment에 아래 hostPath 마운트가 필요합니다:
 *   /proc  → /host/proc  (readOnly: true)
 *   /      → /host-root  (readOnly: true)  ← 디스크 용량용
 *
 * 로컬 개발 환경(Linux)에서는 /proc 를 직접 읽습니다.
 * Windows에서는 모든 값이 -1 로 반환됩니다.
 */
@RestController
@RequestMapping("/api/system")
public class SystemStatsController {

    // K8s hostPath 마운트 경로 (없으면 /proc 직접 사용)
    private static final String PROC_ROOT   = resolveProc();
    private static final String DISK_ROOT   = resolveDisk();

    private final RecentAccessService  recentAccessService;
    private final GeoLookupService     geoLookupService;
    private final SystemMetricsHistory metricsHistory;
    private final NginxLogService      nginxLogService;

    public SystemStatsController(RecentAccessService recentAccessService,
                                 GeoLookupService geoLookupService,
                                 SystemMetricsHistory metricsHistory,
                                 NginxLogService nginxLogService) {
        this.recentAccessService = recentAccessService;
        this.geoLookupService    = geoLookupService;
        this.metricsHistory      = metricsHistory;
        this.nginxLogService     = nginxLogService;
    }

    // ── 경로 해석 ──────────────────────────────────────────────────────────────

    private static String resolveProc() {
        // K8s hostPath 마운트 우선, 없으면 로컬 /proc
        if (Files.isDirectory(Path.of("/host/proc"))) return "/host/proc";
        if (Files.isDirectory(Path.of("/proc")))      return "/proc";
        return null;
    }

    private static String resolveDisk() {
        // K8s hostPath 마운트 우선, 없으면 루트
        if (Files.isDirectory(Path.of("/host-root"))) return "/host-root";
        return "/";
    }

    // ── /api/system/stats ──────────────────────────────────────────────────────

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> stats() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("memory", readMemory());
        result.put("disk",   readDisk());
        result.put("net",    readNet());
        result.put("uptime", readUptime());
        return ResponseEntity.ok(result);
    }

    // ── /api/system/visitors ───────────────────────────────────────────────────

    @GetMapping("/visitors")
    public ResponseEntity<List<Map<String, Object>>> visitors() {
        return ResponseEntity.ok(recentAccessService.getRecentVisitors());
    }

    @GetMapping("/log")
    public ResponseEntity<List<Map<String, Object>>> log() {
        return ResponseEntity.ok(recentAccessService.getRecentLog(50));
    }

    /** 시계열 메트릭 히스토리 (5분 간격, 최대 24h) */
    @GetMapping("/history")
    public ResponseEntity<List<Map<String, Object>>> history() {
        return ResponseEntity.ok(metricsHistory.getHistory());
    }

    /**
     * Ubuntu 호스트 nginx access.log 파싱 결과.
     * available=false 이면 이유(reason)와 마운트 방법이 포함됨.
     */
    @GetMapping("/nginx-log")
    public ResponseEntity<Map<String, Object>> nginxLog() {
        return ResponseEntity.ok(nginxLogService.getStats(200_000));
    }

    /** IP 지오코딩 포함 접속자 목록 — ip-api.com 결과를 인메모리 캐시 */
    @GetMapping("/geo-visitors")
    public ResponseEntity<List<Map<String, Object>>> geoVisitors() {
        List<Map<String, Object>> result = recentAccessService.getRecentVisitors().stream()
                .map(v -> {
                    Map<String, Object> merged = new LinkedHashMap<>(v);
                    merged.putAll(geoLookupService.lookup((String) v.get("ip")));
                    return merged;
                })
                .collect(Collectors.toList());
        return ResponseEntity.ok(result);
    }

    // ── 메모리 (/proc/meminfo) ─────────────────────────────────────────────────

    private Map<String, Object> readMemory() {
        Map<String, Object> m = new LinkedHashMap<>();
        if (PROC_ROOT == null) { m.put("error", "unavailable"); return m; }

        try {
            Map<String, Long> info = new HashMap<>();
            for (String line : Files.readAllLines(Path.of(PROC_ROOT, "meminfo"))) {
                String[] parts = line.split(":\\s+");
                if (parts.length == 2) {
                    String val = parts[1].replace(" kB", "").trim();
                    try { info.put(parts[0].trim(), Long.parseLong(val) * 1024); }
                    catch (NumberFormatException ignored) {}
                }
            }
            long total     = info.getOrDefault("MemTotal",     -1L);
            long free      = info.getOrDefault("MemFree",      -1L);
            long available = info.getOrDefault("MemAvailable", -1L);
            long buffers   = info.getOrDefault("Buffers",      0L);
            long cached    = info.getOrDefault("Cached",       0L);
            long used      = total - free - buffers - cached;

            m.put("totalBytes",     total);
            m.put("usedBytes",      used);
            m.put("availableBytes", available);
            m.put("usedPercent",    total > 0 ? Math.round(used * 100.0 / total) : -1);
        } catch (IOException e) {
            m.put("error", e.getMessage());
        }
        return m;
    }

    // ── 디스크 (java.io.File on host root) ────────────────────────────────────

    private Map<String, Object> readDisk() {
        Map<String, Object> m = new LinkedHashMap<>();
        try {
            File root = new File(DISK_ROOT);
            long total = root.getTotalSpace();
            long free  = root.getFreeSpace();
            long used  = total - free;
            m.put("path",        DISK_ROOT);
            m.put("totalBytes",  total);
            m.put("usedBytes",   used);
            m.put("freeBytes",   free);
            m.put("usedPercent", total > 0 ? Math.round(used * 100.0 / total) : -1);
        } catch (Exception e) {
            m.put("error", e.getMessage());
        }
        return m;
    }

    // ── 네트워크 (/proc/net/dev) ───────────────────────────────────────────────

    private List<Map<String, Object>> readNet() {
        List<Map<String, Object>> list = new ArrayList<>();
        if (PROC_ROOT == null) return list;

        try {
            List<String> lines = Files.readAllLines(Path.of(PROC_ROOT, "net/dev"));
            // 헤더 2줄 스킵
            for (int i = 2; i < lines.size(); i++) {
                String line = lines.get(i).trim();
                if (line.isEmpty()) continue;

                // "eth0: 12345 ..." 형식 파싱
                int colon = line.indexOf(':');
                if (colon < 0) continue;
                String iface = line.substring(0, colon).trim();
                if (iface.equals("lo")) continue; // 루프백 제외

                String[] nums = line.substring(colon + 1).trim().split("\\s+");
                if (nums.length < 9) continue;

                Map<String, Object> ifaceMap = new LinkedHashMap<>();
                ifaceMap.put("interface", iface);
                ifaceMap.put("rxBytes",   parseLong(nums[0]));
                ifaceMap.put("rxPackets", parseLong(nums[1]));
                ifaceMap.put("txBytes",   parseLong(nums[8]));
                ifaceMap.put("txPackets", parseLong(nums[9 < nums.length ? 9 : 8]));
                list.add(ifaceMap);
            }
        } catch (IOException ignored) {}
        return list;
    }

    // ── 업타임 (/proc/uptime) ──────────────────────────────────────────────────

    private Map<String, Object> readUptime() {
        Map<String, Object> m = new LinkedHashMap<>();
        if (PROC_ROOT == null) return m;
        try {
            String content = Files.readString(Path.of(PROC_ROOT, "uptime")).trim();
            double seconds = Double.parseDouble(content.split("\\s+")[0]);
            long s   = (long) seconds;
            m.put("totalSeconds", s);
            m.put("days",    s / 86400);
            m.put("hours",  (s % 86400) / 3600);
            m.put("minutes",(s % 3600)  / 60);
        } catch (Exception ignored) {}
        return m;
    }

    private long parseLong(String s) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0L; }
    }
}
