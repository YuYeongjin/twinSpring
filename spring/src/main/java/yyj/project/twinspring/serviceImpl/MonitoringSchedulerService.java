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
import com.fasterxml.jackson.databind.ObjectMapper;
import yyj.project.twinspring.dao.MonitoringDAO;
import yyj.project.twinspring.dao.ProgressAnalysisDAO;
import yyj.project.twinspring.dao.ProjectLinkDAO;
import yyj.project.twinspring.dao.SafeDAO;
import yyj.project.twinspring.dao.WbsDAO;

import jakarta.annotation.PostConstruct;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
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

    private final MonitoringDAO       monitoringDAO;
    private final SafeDAO             safeDAO;
    private final ProgressAnalysisDAO progressAnalysisDAO;
    private final ProjectLinkDAO      projectLinkDAO;
    private final WbsDAO              wbsDAO;
    private final RestTemplate        restTemplate;
    private final ObjectMapper        objectMapper = new ObjectMapper();
    private boolean                   ffmpegAvailable;

    @Value("${detect.server.url:http://localhost:5001}")
    private String detectServerUrl;

    @Value("${agent.url:http://localhost:7070}")
    private String agentUrl;

    public MonitoringSchedulerService(MonitoringDAO monitoringDAO, SafeDAO safeDAO,
                                      ProgressAnalysisDAO progressAnalysisDAO,
                                      ProjectLinkDAO projectLinkDAO, WbsDAO wbsDAO) {
        this.monitoringDAO       = monitoringDAO;
        this.safeDAO             = safeDAO;
        this.progressAnalysisDAO = progressAnalysisDAO;
        this.projectLinkDAO      = projectLinkDAO;
        this.wbsDAO              = wbsDAO;
        this.restTemplate        = new RestTemplate();
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

        } else if ("PROGRESS".equalsIgnoreCase(mode)) {
            // PROGRESS 모드: 모든 프레임 저장 후 AI 진도 분석 → WBS 자동 업데이트
            Timestamp expiresAt = Timestamp.from(Instant.now().plusSeconds(
                    retentionSec > 0 ? retentionSec : 7 * 24 * 3600));
            String snapshotId = UUID.randomUUID().toString();
            Map<String, Object> snap = new HashMap<>();
            snap.put("snapshotId",    snapshotId);
            snap.put("projectId",     projectId);
            snap.put("scheduleId",    scheduleId);
            snap.put("cameraId",      cameraId);
            snap.put("cameraName",    cameraName);
            snap.put("mode",          "PROGRESS");
            snap.put("imageData",     imageBytes);
            snap.put("isProblem",     false);
            snap.put("detectionJson", null);
            snap.put("expiresAt",     expiresAt);
            monitoringDAO.insertSnapshot(snap);
            log.info("PROGRESS 스냅샷 저장 [{}] snapshotId={}", cameraName, snapshotId);

            // 비동기적으로 AI 진도 분석 실행 (별도 스레드)
            final String finalSnapshotId = snapshotId;
            final String finalProjectId  = projectId;
            Thread analyzeThread = new Thread(() -> {
                try {
                    runProgressAnalysis(finalSnapshotId, finalProjectId, imageBytes);
                } catch (Exception e) {
                    log.warn("PROGRESS 분석 오류 [snapshotId={}]: {}", finalSnapshotId, e.getMessage());
                }
            });
            analyzeThread.setDaemon(true);
            analyzeThread.start();

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

            // stdout 읽기를 별도 데몬 스레드로 분리.
            // readAllBytes()를 waitFor() 앞에 두면 FFmpeg이 hang 시
            // 파이프 버퍼가 꽉 차 데드락이 발생하고 타임아웃이 동작하지 않는다.
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            Thread reader = new Thread(() -> {
                try { proc.getInputStream().transferTo(baos); }
                catch (IOException ignored) {}
            });
            reader.setDaemon(true);
            reader.start();

            boolean done = proc.waitFor(FFMPEG_TIMEOUT_SEC, TimeUnit.SECONDS);
            if (!done) proc.destroyForcibly(); // 타임아웃 → 강제 종료 → reader가 EOF 받아 종료

            reader.join(2000); // 잔여 데이터 최대 2초 대기

            byte[] bytes = baos.toByteArray();
            // JPEG SOI 마커(0xFFD8) 로 시작하는지 확인
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

    // ── PROGRESS 모드: AI 진도 분석 → WBS 자동 업데이트 ────────────────

    @SuppressWarnings("unchecked")
    private void runProgressAnalysis(String snapshotId, String safeProjectId, byte[] imageBytes) {
        // 1) 이 Safe 프로젝트와 연결된 WBS 프로젝트 찾기
        List<Map<String, Object>> links = projectLinkDAO.getWbsByLinkedProject("SAFE", safeProjectId);
        if (links == null || links.isEmpty()) {
            log.info("PROGRESS 분석 스킵 — WBS 연결 없음 [safeProjectId={}]", safeProjectId);
            return;
        }
        String wbsProjectId = (String) links.get(0).get("wbsProjectId");

        // 2) WBS 프로젝트의 IN_PROGRESS 또는 첫 번째 태스크 조회
        List<Map<String, Object>> tasks = wbsDAO.getTasksByProject(wbsProjectId);
        if (tasks == null || tasks.isEmpty()) {
            log.info("PROGRESS 분석 스킵 — WBS 태스크 없음 [wbsProjectId={}]", wbsProjectId);
            return;
        }

        Map<String, Object> targetTask = tasks.stream()
                .filter(t -> "IN_PROGRESS".equalsIgnoreCase((String) t.getOrDefault("status", "")))
                .findFirst()
                .orElse(tasks.stream()
                        .filter(t -> "NOT_STARTED".equalsIgnoreCase((String) t.getOrDefault("status", "")))
                        .findFirst()
                        .orElse(tasks.get(0)));

        String taskId       = (String) targetTask.get("taskId");
        String taskName     = (String) targetTask.getOrDefault("taskName", "작업");
        int currentProgress = targetTask.get("progress") instanceof Number
                ? ((Number) targetTask.get("progress")).intValue() : 0;

        // 3) Python /analyze-progress 호출
        String imageB64 = Base64.getEncoder().encodeToString(imageBytes);
        Map<String, Object> reqBody = new HashMap<>();
        reqBody.put("image_base64",      imageB64);
        reqBody.put("wbs_task_id",       taskId);
        reqBody.put("wbs_task_name",     taskName);
        reqBody.put("wbs_project_id",    wbsProjectId);
        reqBody.put("current_progress",  currentProgress);
        reqBody.put("project_context",   "건설 현장 진도 모니터링");

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<Map> resp = restTemplate.postForEntity(
                agentUrl + "/analyze-progress",
                new HttpEntity<>(reqBody, headers), Map.class);

        if (!resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
            log.warn("PROGRESS 분석 API 실패 [taskId={}]", taskId);
            return;
        }
        Map<String, Object> result = resp.getBody();
        int estimatedProgress = result.get("estimated_progress") instanceof Number
                ? ((Number) result.get("estimated_progress")).intValue() : currentProgress;
        double confidence = result.get("confidence") instanceof Number
                ? ((Number) result.get("confidence")).doubleValue() : 0.5;
        String notes      = (String) result.getOrDefault("analysis_notes", "");
        String ragQuery   = (String) result.getOrDefault("rag_query", "");

        // RAG 증빙 JSON 직렬화
        String ragJson = "[]";
        try {
            Object evidence = result.get("rag_evidence");
            ragJson = objectMapper.writeValueAsString(evidence != null ? evidence : List.of());
        } catch (Exception ignored) {}

        // 4) WBS 태스크 progress 업데이트 (진도 상승만 허용 — 역행 방지)
        if (estimatedProgress > currentProgress) {
            Map<String, Object> taskUpdate = new HashMap<>(targetTask);
            taskUpdate.put("taskId",   taskId);
            taskUpdate.put("progress", estimatedProgress);
            if (estimatedProgress >= 100) taskUpdate.put("status", "COMPLETED");
            else if (currentProgress == 0) taskUpdate.put("status", "IN_PROGRESS");
            wbsDAO.updateTask(taskUpdate);
            log.info("PROGRESS WBS 업데이트 [taskId={}, {} → {}%]",
                    taskId, currentProgress, estimatedProgress);
        }

        // 5) 분석 로그 저장
        String analysisId = UUID.randomUUID().toString();
        Map<String, Object> logEntry = new HashMap<>();
        logEntry.put("analysisId",      analysisId);
        logEntry.put("snapshotId",      snapshotId);
        logEntry.put("wbsTaskId",       taskId);
        logEntry.put("wbsProjectId",    wbsProjectId);
        logEntry.put("beforeProgress",  currentProgress);
        logEntry.put("afterProgress",   estimatedProgress);
        logEntry.put("confidence",      confidence);
        logEntry.put("analysisNotes",   notes);
        logEntry.put("ragEvidence",     ragJson);
        progressAnalysisDAO.insertAnalysis(logEntry);

        // 6) 스냅샷에 분석 ID 연결
        try {
            Map<String, Object> snapUpdate = new HashMap<>();
            snapUpdate.put("snapshotId",    snapshotId);
            snapUpdate.put("detectionJson", "{\"analysisId\":\"" + analysisId
                    + "\",\"estimatedProgress\":" + estimatedProgress
                    + ",\"ragQuery\":\"" + ragQuery + "\"}");
            snapUpdate.put("isProblem",     estimatedProgress > currentProgress);
            monitoringDAO.updateSnapshotDetection(snapUpdate);
        } catch (Exception e) {
            log.warn("스냅샷 메타 업데이트 실패: {}", e.getMessage());
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
