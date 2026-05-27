package yyj.project.twinspring.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.service.CrackDetectionService;
import yyj.project.twinspring.service.FallbackDetectionService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/detection")
public class DetectionController {

    private static final List<String> NO_HELMET_CLASSES =
            List.of("no-hard-hat", "no-helmet", "no_hard_hat", "no_helmet", "Person");
    private static final List<String> RESTRICTED_CLASSES =
            List.of("restricted", "prohibited", "danger-zone", "danger_zone", "restricted-area");

    private static final Logger log = LoggerFactory.getLogger(DetectionController.class);

    private final SimpMessagingTemplate ws;
    private final WebClient detectWebClient;
    private final FallbackDetectionService fallbackService;
    private final CrackDetectionService crackService;
    private final ObjectMapper objectMapper;

    public DetectionController(SimpMessagingTemplate ws,
                               @Qualifier("detectWebClient") WebClient detectWebClient,
                               FallbackDetectionService fallbackService,
                               CrackDetectionService crackService,
                               ObjectMapper objectMapper) {
        this.ws = ws;
        this.detectWebClient = detectWebClient;
        this.fallbackService = fallbackService;
        this.crackService = crackService;
        this.objectMapper = objectMapper;
    }

    // ── Python 탐지 서버 프록시 ────────────────────────────────────

    @GetMapping("/status")
    public Mono<ResponseEntity<String>> status() {
        return detectWebClient.get()
                .uri("/status")
                .retrieve()
                .toBodilessEntity()
                .map(r -> ResponseEntity.ok("online"))
                .onErrorResume(e -> {
                    log.warn("Detect 서버 상태 확인 실패: {}", e.getMessage());
                    return Mono.just(ResponseEntity.status(503).body("offline"));
                });
    }

    @PostMapping("/detect")
    public ResponseEntity<String> detect(@RequestParam("file") MultipartFile file) {
        byte[] fileBytes;
        try {
            fileBytes = file.getBytes();
        } catch (IOException e) {
            return ResponseEntity.badRequest().body("{\"error\":\"파일 읽기 실패\"}");
        }

        // ── Python 서버 시도 (8초 타임아웃) ──────────────────────────
        try {
            MultipartBodyBuilder builder = new MultipartBodyBuilder();
            String contentType = file.getContentType() != null ? file.getContentType() : "application/octet-stream";
            builder.part("file", new ByteArrayResource(fileBytes) {
                @Override public String getFilename() { return file.getOriginalFilename(); }
            }).contentType(MediaType.parseMediaType(contentType));

            byte[] respBytes = detectWebClient.post()
                    .uri("/detect")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(BodyInserters.fromMultipartData(builder.build()))
                    .retrieve()
                    .bodyToMono(byte[].class)
                    .block(Duration.ofSeconds(8));

            if (respBytes != null) {
                return ResponseEntity.ok(new String(respBytes, StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            log.warn("Detect 서버 오프라인 — Spring 폴백 탐지 실행: {}", e.getMessage());
        }

        // ── Spring 폴백 탐지 ──────────────────────────────────────────
        try {
            List<Map<String, Object>> dets = fallbackService.analyze(fileBytes);
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("count",        dets.size());
            resp.put("detections",   dets);
            resp.put("serverOffline", true);
            resp.put("fallback",      true);
            return ResponseEntity.ok(objectMapper.writeValueAsString(resp));
        } catch (Exception ex) {
            log.error("폴백 탐지 실패: {}", ex.getMessage());
            return ResponseEntity.ok("{\"count\":0,\"detections\":[],\"serverOffline\":true,\"fallback\":true}");
        }
    }

    // ── 균열 탐지 ─────────────────────────────────────────────────

    @PostMapping("/crack")
    public ResponseEntity<String> detectCrack(@RequestParam("file") MultipartFile file) {
        byte[] fileBytes;
        try {
            fileBytes = file.getBytes();
        } catch (IOException e) {
            return ResponseEntity.badRequest().body("{\"error\":\"파일 읽기 실패\"}");
        }

        // ── Python 서버 시도 (8초 타임아웃) ──────────────────────────
        try {
            MultipartBodyBuilder builder = new MultipartBodyBuilder();
            String contentType = file.getContentType() != null ? file.getContentType() : "application/octet-stream";
            builder.part("file", new ByteArrayResource(fileBytes) {
                @Override public String getFilename() { return file.getOriginalFilename(); }
            }).contentType(MediaType.parseMediaType(contentType));

            byte[] respBytes = detectWebClient.post()
                    .uri("/crack")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(BodyInserters.fromMultipartData(builder.build()))
                    .retrieve()
                    .bodyToMono(byte[].class)
                    .block(Duration.ofSeconds(8));

            if (respBytes != null) {
                String json = new String(respBytes, StandardCharsets.UTF_8);
                log.info("Python 균열 탐지 결과: {}", json);
                return ResponseEntity.ok(json);
            }
        } catch (Exception e) {
            log.warn("Python 균열 탐지 서버 오프라인 — Spring 폴백 실행: {}", e.getMessage());
        }

        // ── Spring 폴백 균열 탐지 ─────────────────────────────────────
        try {
            Map<String, Object> result = crackService.analyze(fileBytes);
            log.info("Spring 폴백 균열 탐지 결과: hasCrack={}, confidence={}",
                    result.get("hasCrack"), result.get("confidence"));
            return ResponseEntity.ok(objectMapper.writeValueAsString(result));
        } catch (Exception ex) {
            log.error("균열 탐지 폴백 실패: {}", ex.getMessage());
            return ResponseEntity.ok("{\"hasCrack\":false,\"confidence\":0.0,\"method\":\"error\",\"detail\":\"" + ex.getMessage() + "\"}");
        }
    }

    @PostMapping
    public Map<String, Object> receive(@RequestBody Map<String, Object> body) {
        String filename = (String) body.getOrDefault("filename", "");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> detections =
                (List<Map<String, Object>>) body.getOrDefault("detections", List.of());

        boolean noHelmet = false;
        boolean restricted = false;

        for (Map<String, Object> det : detections) {
            String cls = String.valueOf(det.getOrDefault("class", "")).toLowerCase();
            if (NO_HELMET_CLASSES.stream().anyMatch(c -> c.equalsIgnoreCase(cls))) noHelmet = true;
            if (RESTRICTED_CLASSES.stream().anyMatch(c -> c.equalsIgnoreCase(cls))) restricted = true;
        }

        boolean dangerous = noHelmet || restricted;

        Map<String, Object> event = Map.of(
                "filename",    filename,
                "detections",  detections,
                "noHelmet",    noHelmet,
                "restricted",  restricted,
                "dangerous",   dangerous,
                // 언어 중립 코드 — 프론트엔드가 언어에 맞게 번역
                "messageCode", buildMessageCode(noHelmet, restricted)
        );

        ws.convertAndSend("/topic/safe", event);

        return Map.of("received", detections.size(), "dangerous", dangerous);
    }

    /**
     * 언어 중립 메시지 코드 반환 — 프론트엔드가 i18n 키로 번역합니다.
     * NO_HELMET_RESTRICTED | NO_HELMET | RESTRICTED | SAFE
     */
    private String buildMessageCode(boolean noHelmet, boolean restricted) {
        if (noHelmet && restricted) return "NO_HELMET_RESTRICTED";
        if (noHelmet)               return "NO_HELMET";
        if (restricted)             return "RESTRICTED";
        return "SAFE";
    }
}
