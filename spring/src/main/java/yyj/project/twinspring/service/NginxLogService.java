package yyj.project.twinspring.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Ubuntu 호스트의 nginx access.log 를 파싱하여 시간별 접속 통계를 반환한다.
 *
 * K8s 환경에서는 Deployment에 hostPath 볼륨을 마운트해야 한다:
 *   volumes:
 *     - name: nginx-logs
 *       hostPath:
 *         path: /var/log/nginx
 *   volumeMounts:
 *     - name: nginx-logs
 *       mountPath: /host/nginx-logs
 *       readOnly: true
 *
 * 그 후 NGINX_ACCESS_LOG=/host/nginx-logs/access.log 환경변수로 경로를 지정한다.
 */
@Slf4j
@Service
public class NginxLogService {

    // nginx combined log format
    // 203.0.113.1 - - [16/Jun/2026:10:30:00 +0900] "GET /api/... HTTP/1.1" 200 1234 "-" "UA"
    private static final Pattern LOG_PATTERN = Pattern.compile(
            "^(\\S+)\\s+\\S+\\s+\\S+\\s+\\[([^\\]]+)\\]\\s+\"(\\S+)\\s+(\\S+)\\s+\\S+\"\\s+(\\d+)\\s+(\\d+)"
    );
    private static final DateTimeFormatter NGINX_DATE =
            DateTimeFormatter.ofPattern("dd/MMM/yyyy:HH:mm:ss Z", Locale.ENGLISH);
    private static final DateTimeFormatter HOUR_KEY =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:00");

    @Value("${nginx.access.log:}")
    private String configuredPath;

    /** 로그 파일 경로 우선순위: 환경변수 → K8s hostPath → 호스트 직접 */
    private String resolvePath() {
        if (configuredPath != null && !configuredPath.isBlank()) return configuredPath;
        if (Files.exists(Path.of("/host/nginx-logs/access.log"))) return "/host/nginx-logs/access.log";
        if (Files.exists(Path.of("/var/log/nginx/access.log")))   return "/var/log/nginx/access.log";
        return null;
    }

    /**
     * nginx access.log 를 파싱하여 시간별 요청 수 + 상위 IP 반환.
     * @param maxLines 최근 N줄만 처리 (기본 200,000 = 하루치 정도)
     */
    public Map<String, Object> getStats(int maxLines) {
        Map<String, Object> result = new LinkedHashMap<>();
        String path = resolvePath();

        if (path == null || !Files.exists(Path.of(path))) {
            result.put("available", false);
            result.put("reason", "nginx access.log 를 찾을 수 없습니다. " +
                    "K8s 환경이라면 hostPath 볼륨을 마운트하거나 " +
                    "NGINX_ACCESS_LOG 환경변수를 설정하세요.");
            return result;
        }

        try {
            List<String> lines = readLastLines(path, maxLines);

            // 시간별 요청 수 · 유니크 IP
            Map<String, Long>      hourlyReq = new TreeMap<>();
            Map<String, Set<String>> hourlyIp = new TreeMap<>();
            Map<String, Long>       ipCount   = new LinkedHashMap<>();
            Map<String, Long>       ipLast    = new LinkedHashMap<>();

            long parsed = 0;
            for (String line : lines) {
                Matcher m = LOG_PATTERN.matcher(line);
                if (!m.find()) continue;
                parsed++;

                String ip      = m.group(1);
                String dateStr = m.group(2);

                OffsetDateTime dt;
                try { dt = OffsetDateTime.parse(dateStr, NGINX_DATE); }
                catch (Exception e) { continue; }

                String hk      = dt.format(HOUR_KEY);
                long   epochMs = dt.toInstant().toEpochMilli();

                hourlyReq.merge(hk, 1L, Long::sum);
                hourlyIp.computeIfAbsent(hk, k -> new HashSet<>()).add(ip);
                ipCount.merge(ip, 1L, Long::sum);
                ipLast.merge(ip, epochMs, Math::max);
            }

            // 시간별 리스트
            List<Map<String, Object>> hourly = new ArrayList<>();
            for (var e : hourlyReq.entrySet()) {
                Map<String, Object> h = new LinkedHashMap<>();
                h.put("hour",      e.getKey());
                h.put("timestamp", hourToEpoch(e.getKey()));
                h.put("requests",  e.getValue());
                h.put("uniqueIps", hourlyIp.getOrDefault(e.getKey(), Set.of()).size());
                hourly.add(h);
            }

            // 상위 IP (요청 수 내림차순)
            List<Map<String, Object>> topIps = ipCount.entrySet().stream()
                    .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                    .limit(30)
                    .map(e -> {
                        Map<String, Object> ip = new LinkedHashMap<>();
                        ip.put("ip",       e.getKey());
                        ip.put("count",    e.getValue());
                        ip.put("lastTime", ipLast.get(e.getKey()));
                        return ip;
                    })
                    .collect(Collectors.toList());

            result.put("available",   true);
            result.put("logPath",     path);
            result.put("parsedLines", parsed);
            result.put("hourly",      hourly);
            result.put("topIps",      topIps);

        } catch (Exception e) {
            log.warn("[NginxLog] 파싱 실패: {}", e.getMessage());
            result.put("available", false);
            result.put("reason",    e.getMessage());
        }
        return result;
    }

    /** 파일 끝에서 maxLines 줄을 역순으로 읽는다 (대용량 파일 대응). */
    private List<String> readLastLines(String filePath, int maxLines) throws Exception {
        Deque<String> deque = new ArrayDeque<>(Math.min(maxLines, 10_000));
        try (RandomAccessFile raf = new RandomAccessFile(filePath, "r")) {
            long len = raf.length();
            if (len == 0) return List.of();

            // 파일이 크면 마지막 20MB 만 읽음
            long startPos = Math.max(0, len - 20_000_000L);
            raf.seek(startPos);
            if (startPos > 0) raf.readLine(); // 첫 줄 불완전할 수 있으므로 스킵

            String line;
            while ((line = raf.readLine()) != null) {
                if (!line.isBlank()) deque.addLast(line);
                if (deque.size() > maxLines) deque.removeFirst();
            }
        }
        return new ArrayList<>(deque);
    }

    private long hourToEpoch(String hourKey) { // "yyyy-MM-dd HH:00"
        try {
            return java.time.LocalDateTime
                    .parse(hourKey, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))
                    .atZone(ZoneId.systemDefault())
                    .toInstant().toEpochMilli();
        } catch (Exception e) { return 0L; }
    }
}
