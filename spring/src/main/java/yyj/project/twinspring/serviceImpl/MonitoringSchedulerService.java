package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import yyj.project.twinspring.dao.MonitoringDAO;
import yyj.project.twinspring.dao.SafeDAO;

import jakarta.annotation.PostConstruct;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * 상시 모니터링 스케줄러
 *
 * 60초마다 실행 → enabled=true 스케줄의 모든 카메라를 순회하며 프레임 캡처.
 *
 * 캡처 우선순위:
 *   1. monitoring_camera 테이블에 등록된 카메라 (다중 카메라)
 *   2. 카메라 없으면 safe_project.camera_url 로 폴백 (하위 호환)
 *
 * URL 지원:
 *   rtsp://  → FFmpeg (-rtsp_transport tcp)
 *   http://  → FFmpeg 먼저 시도, 실패 시 RestTemplate 폴백
 *   https:// → FFmpeg 먼저 시도, 실패 시 RestTemplate 폴백
 *
 * SAFETY 모드: detect 서버 → 위험 감지 시만 저장 (프로젝트당 최대 10장 순환)
 * CRACK  모드: 모든 캡처 저장 → expires_at 지나면 자동 삭제
 */
@Service
public class MonitoringSchedulerService {

    private static final Logger log = LoggerFactory.getLogger(MonitoringSchedulerService.class);
    private static final int SAFETY_MAX_SNAPSHOTS = 10;
    private static final int FFMPEG_TIMEOUT_SEC   = 15;

    private final MonitoringDAO monitoringDAO;
    private final SafeDAO       safeDAO;
    private final RestTemplate  restTemplate;
    private boolean             ffmpegAvailable;

    @Value("${detect.server.url:http://localhost:5001}")
    private String detectServerUrl;

    public MonitoringSchedulerService(MonitoringDAO monitoringDAO, SafeDAO safeDAO) {
        this.monitoringDAO = monitoringDAO;
        this.safeDAO       = safeDAO;
        this.restTemplate  = new RestTemplate();
    }

    /** 서버 기동 시 FFmpeg 설치 여부를 한 번만 확인 */
    @PostConstruct
    public void checkFfmpeg() {
        try {
            Process p = new ProcessBuilder("ffmpeg", "-version")
                    .redirectErrorStream(true).start();
            ffmpegAvailable = p.waitFor(3, TimeUnit.SECONDS) && p.exitValue() == 0;
        } catch (Exception e) {
            ffmpegAvailable = false;
        }
        log.info("FFmpeg 사용 가능: {}", ffmpegAvailable);
    }

    // ── 메인 스케줄러 (60초마다) ─────────────────────────────────────

    // SAFETY 최소 5초, CRACK 최소 30분 → 5초마다 tick 하여 모든 구간 커버
    @Scheduled(fixedDelay = 5_000)
    public void tick() {
        try { monitoringDAO.deleteExpiredSnapshots(); }
        catch (Exception e) { log.warn("만료 스냅샷 삭제 실패: {}", e.getMessage()); }

        List<Map<String, Object>> schedules = monitoringDAO.getEnabledSchedules();
        for (Map<String, Object> schedule : schedules) {
            try { processSchedule(schedule); }
            catch (Exception e) {
                log.warn("스케줄 처리 오류 [{}]: {}", schedule.get("scheduleId"), e.getMessage());
            }
        }
    }

    // ── 스케줄 단위 처리 ─────────────────────────────────────────────

    private void processSchedule(Map<String, Object> schedule) {
        String scheduleId = (String) schedule.get("scheduleId");
        String projectId  = (String) schedule.get("projectId");
        int intervalSec   = toInt(schedule.get("captureIntervalSec"));
        int retentionSec  = toInt(schedule.get("retentionSec"));

        if (!isTimeToCapture(schedule.get("lastCapturedAt"), intervalSec)) return;

        // 프로젝트 정보
        Map<String, Object> project = safeDAO.getSafeProjectById(projectId);
        if (project == null) return;

        // INACTIVE / ARCHIVED 상태면 촬영 중단
        String status = (String) project.getOrDefault("status", "ACTIVE");
        if (!"ACTIVE".equalsIgnoreCase(status)) {
            log.debug("프로젝트 비활성 — 촬영 스킵 [projectId={}, status={}]", projectId, status);
            return;
        }

        String mode = (String) project.getOrDefault("mode", "SAFETY");

        // 등록된 카메라 목록 조회
        List<Map<String, Object>> cameras = monitoringDAO.getEnabledCamerasByProject(projectId);

        if (cameras.isEmpty()) {
            // 폴백: safe_project.camera_url 사용
            String fallbackUrl = (String) project.get("cameraUrl");
            if (fallbackUrl != null && !fallbackUrl.isBlank()) {
                captureAndSave(scheduleId, projectId, null, "기본 카메라",
                        fallbackUrl, mode, retentionSec);
            }
        } else {
            for (Map<String, Object> cam : cameras) {
                String cameraId   = (String) cam.get("cameraId");
                String cameraName = (String) cam.get("cameraName");
                String cameraUrl  = (String) cam.get("cameraUrl");
                captureAndSave(scheduleId, projectId, cameraId, cameraName,
                        cameraUrl, mode, retentionSec);
            }
        }

        monitoringDAO.updateLastCapturedAt(scheduleId);
    }

    // ── 개별 카메라 캡처 → 저장 ──────────────────────────────────────

    private void captureAndSave(String scheduleId, String projectId,
                                String cameraId, String cameraName,
                                String cameraUrl, String mode, int retentionSec) {
        byte[] imageBytes = fetchImage(cameraUrl);
        if (imageBytes == null) {
            log.warn("캡처 실패 [{}] {}", cameraName, cameraUrl);
            return;
        }

        if ("CRACK".equalsIgnoreCase(mode)) {
            Timestamp expiresAt = Timestamp.from(Instant.now().plusSeconds(retentionSec));
            save(scheduleId, projectId, cameraId, cameraName, "CRACK",
                    imageBytes, false, null, expiresAt);
            log.info("CRACK 저장 [{}]", cameraName);
        } else {
            String detectionJson = callDetectServer(imageBytes);
            boolean isProblem    = isDangerous(detectionJson);
            if (!isProblem) return;

            // 10장 순환 버퍼
            if (monitoringDAO.countProblemSnapshots(projectId) >= SAFETY_MAX_SNAPSHOTS) {
                monitoringDAO.deleteOldestProblemSnapshot(projectId);
            }
            save(scheduleId, projectId, cameraId, cameraName, "SAFETY",
                    imageBytes, true, detectionJson, null);
            log.info("SAFETY 위험 저장 [{}]", cameraName);
        }
    }

    private void save(String scheduleId, String projectId,
                      String cameraId, String cameraName, String mode,
                      byte[] imageBytes, boolean isProblem,
                      String detectionJson, Timestamp expiresAt) {
        Map<String, Object> p = new HashMap<>();
        p.put("snapshotId",    UUID.randomUUID().toString());
        p.put("projectId",     projectId);
        p.put("scheduleId",    scheduleId);
        p.put("cameraId",      cameraId);
        p.put("cameraName",    cameraName);
        p.put("mode",          mode);
        p.put("imageData",     imageBytes);
        p.put("isProblem",     isProblem);
        p.put("detectionJson", detectionJson);
        p.put("expiresAt",     expiresAt);
        monitoringDAO.insertSnapshot(p);
    }

    // ── 이미지 캡처: FFmpeg 우선, HTTP 폴백 ──────────────────────────

    /**
     * RTSP  → FFmpeg 필수 (RestTemplate 불가)
     * HTTP  → FFmpeg 우선, 실패 시 RestTemplate
     * HTTPS → FFmpeg 우선, 실패 시 RestTemplate
     */
    private byte[] fetchImage(String url) {
        boolean isRtsp = url.toLowerCase().startsWith("rtsp://");
        boolean isHttp = url.toLowerCase().startsWith("http://")
                      || url.toLowerCase().startsWith("https://");

        if (ffmpegAvailable) {
            byte[] result = captureViaFfmpeg(url, isRtsp);
            if (result != null) return result;
            // FFmpeg 실패 시 HTTP라면 RestTemplate 시도
            if (isHttp) return captureViaHttp(url);
            return null;
        }

        // FFmpeg 없음
        if (isRtsp) {
            log.warn("RTSP 캡처에는 FFmpeg이 필요합니다. URL: {}", url);
            return null;
        }
        return captureViaHttp(url);
    }

    /**
     * FFmpeg으로 첫 프레임 1장을 JPEG bytes로 추출.
     *
     * ffmpeg -y [-rtsp_transport tcp] -i {url}
     *        -frames:v 1 -vf scale=1280:-1 -vcodec mjpeg -f image2 pipe:1
     *
     * - RTSP: -rtsp_transport tcp 옵션으로 패킷 유실 방지
     * - scale=1280:-1: 가로 1280px 고정, 세로 비율 유지 (네트워크 절약)
     * - stderr을 DISCARD 하여 로그 오염 방지
     */
    private byte[] captureViaFfmpeg(String url, boolean isRtsp) {
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add("ffmpeg");
            cmd.add("-y");                     // 출력 파일 덮어쓰기 허용
            if (isRtsp) {
                cmd.add("-rtsp_transport"); cmd.add("tcp");
            }
            cmd.add("-i");       cmd.add(url);
            cmd.add("-frames:v"); cmd.add("1");
            cmd.add("-vf");      cmd.add("scale=1280:-1");
            cmd.add("-vcodec");  cmd.add("mjpeg");
            cmd.add("-q:v");     cmd.add("3");  // JPEG 품질 (1=최고, 31=최저)
            cmd.add("-f");       cmd.add("image2");
            cmd.add("pipe:1");

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectError(ProcessBuilder.Redirect.DISCARD); // stderr 버림
            Process proc = pb.start();

            byte[] bytes = proc.getInputStream().readAllBytes();
            boolean done = proc.waitFor(FFMPEG_TIMEOUT_SEC, TimeUnit.SECONDS);
            if (!done) proc.destroyForcibly();

            // JPEG 최소 크기 확인 (SOI 마커 0xFFD8 으로 시작하는지)
            if (bytes.length > 2 && bytes[0] == (byte)0xFF && bytes[1] == (byte)0xD8) {
                return bytes;
            }
            return null;
        } catch (Exception e) {
            log.debug("FFmpeg 캡처 실패 [{}]: {}", url, e.getMessage());
            return null;
        }
    }

    /** HTTP(S) GET으로 이미지를 직접 가져옴 (MJPEG 제외 정적 스냅샷용) */
    private byte[] captureViaHttp(String url) {
        try {
            ResponseEntity<byte[]> resp = restTemplate.getForEntity(url, byte[].class);
            byte[] body = resp.getBody();
            return (resp.getStatusCode().is2xxSuccessful() && body != null && body.length > 100)
                    ? body : null;
        } catch (Exception e) {
            log.warn("HTTP 캡처 실패 [{}]: {}", url, e.getMessage());
            return null;
        }
    }

    // ── detect 서버 호출 ─────────────────────────────────────────────

    private String callDetectServer(byte[] imageBytes) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            ByteArrayResource res = new ByteArrayResource(imageBytes) {
                @Override public String getFilename() { return "snapshot.jpg"; }
            };
            body.add("file", res);

            ResponseEntity<String> resp = restTemplate.postForEntity(
                    detectServerUrl + "/api/detection/detect",
                    new HttpEntity<>(body, headers), String.class);

            return resp.getStatusCode().is2xxSuccessful() ? resp.getBody() : null;
        } catch (Exception e) {
            log.warn("detect 서버 호출 실패: {}", e.getMessage());
            return null;
        }
    }

    /** detect 서버 응답 JSON에서 위험 여부 판단 */
    private boolean isDangerous(String json) {
        if (json == null) return false;
        String lower = json.toLowerCase();
        if (lower.contains("\"count\":0") || lower.contains("\"count\": 0")) return false;
        if (lower.contains("\"count\":")  && !lower.contains("\"count\":0"))  return true;
        return lower.contains("\"dangerous\":true") || lower.contains("\"no_helmet\":true");
    }

    // ── 유틸 ────────────────────────────────────────────────────────

    private boolean isTimeToCapture(Object lastCapturedAt, int intervalSec) {
        if (lastCapturedAt == null) return true;
        long lastEpoch = toTimestamp(lastCapturedAt).toInstant().getEpochSecond();
        return Instant.now().getEpochSecond() - lastEpoch >= intervalSec;
    }

    private int toInt(Object v) {
        if (v == null) return 0;
        if (v instanceof Number) return ((Number) v).intValue();
        return Integer.parseInt(v.toString());
    }

    private Timestamp toTimestamp(Object v) {
        if (v instanceof Timestamp) return (Timestamp) v;
        if (v instanceof java.time.OffsetDateTime)
            return Timestamp.from(((java.time.OffsetDateTime) v).toInstant());
        if (v instanceof java.time.LocalDateTime)
            return Timestamp.valueOf((java.time.LocalDateTime) v);
        String s = v.toString().replace("T", " ").replaceAll("\\+.*|Z$", "");
        return Timestamp.valueOf(s);
    }
}
