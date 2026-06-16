package yyj.project.twinspring.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;

/**
 * 5분마다 디스크·네트워크·접속자 스냅샷을 수집해 24시간 링 버퍼로 유지.
 * 프론트엔드 시계열 차트에서 /api/system/history 로 조회한다.
 */
@Slf4j
@Component
public class SystemMetricsHistory {

    private static final int    MAX_SAMPLES     = 288;   // 24h × 12 (5분 간격)
    private static final String PROC_ROOT;
    private static final String DISK_ROOT;

    static {
        PROC_ROOT = Files.isDirectory(Path.of("/host/proc")) ? "/host/proc"
                  : Files.isDirectory(Path.of("/proc"))      ? "/proc"
                  : null;
        DISK_ROOT = Files.isDirectory(Path.of("/host-root")) ? "/host-root" : "/";
    }

    private final ConcurrentLinkedDeque<Map<String, Object>> samples = new ConcurrentLinkedDeque<>();
    private final RecentAccessService recentAccessService;

    private long prevRxBytes = -1;
    private long prevTxBytes = -1;

    public SystemMetricsHistory(RecentAccessService recentAccessService) {
        this.recentAccessService = recentAccessService;
    }

    @Scheduled(fixedRate = 300_000, initialDelay = 5_000) // 5초 후 첫 실행, 이후 5분 간격
    public void collect() {
        try {
            long now        = System.currentTimeMillis();
            long since      = now - 300_000L; // 지난 5분

            // 접속 요청 수
            long requests   = recentAccessService.countRequestsSince(since);

            // 네트워크 델타 (5분간 누적 바이트)
            long[] netNow   = readNetTotals();
            long rxDelta    = (prevRxBytes >= 0 && netNow[0] >= prevRxBytes) ? netNow[0] - prevRxBytes : 0;
            long txDelta    = (prevTxBytes >= 0 && netNow[1] >= prevTxBytes) ? netNow[1] - prevTxBytes : 0;
            prevRxBytes     = netNow[0];
            prevTxBytes     = netNow[1];

            // 디스크
            File   root       = new File(DISK_ROOT);
            long   diskTotal  = root.getTotalSpace();
            long   diskFree   = root.getFreeSpace();
            long   diskUsed   = diskTotal - diskFree;
            int    diskPct    = diskTotal > 0 ? (int) (diskUsed * 100L / diskTotal) : 0;

            Map<String, Object> sample = new LinkedHashMap<>();
            sample.put("timestamp",   now);
            sample.put("requests",    requests);
            sample.put("rxBytes",     rxDelta);
            sample.put("txBytes",     txDelta);
            sample.put("diskUsedPct", diskPct);
            sample.put("diskUsed",    diskUsed);
            sample.put("diskTotal",   diskTotal);

            samples.addLast(sample);
            while (samples.size() > MAX_SAMPLES) samples.removeFirst();

        } catch (Exception e) {
            log.warn("[MetricsHistory] 수집 실패: {}", e.getMessage());
        }
    }

    public List<Map<String, Object>> getHistory() {
        return new ArrayList<>(samples);
    }

    private long[] readNetTotals() {
        long totalRx = 0, totalTx = 0;
        if (PROC_ROOT == null) return new long[]{0, 0};
        try {
            List<String> lines = Files.readAllLines(Path.of(PROC_ROOT, "net/dev"));
            for (int i = 2; i < lines.size(); i++) {
                String line  = lines.get(i).trim();
                int    colon = line.indexOf(':');
                if (colon < 0) continue;
                String iface = line.substring(0, colon).trim();
                if (iface.equals("lo")) continue;
                String[] nums = line.substring(colon + 1).trim().split("\\s+");
                if (nums.length >= 9) {
                    totalRx += parseLong(nums[0]);
                    totalTx += parseLong(nums[8]);
                }
            }
        } catch (Exception ignored) {}
        return new long[]{totalRx, totalTx};
    }

    private long parseLong(String s) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0L; }
    }
}
