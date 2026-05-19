package yyj.project.twinspring.controller;

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

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/detection")
public class DetectionController {

    private static final List<String> NO_HELMET_CLASSES =
            List.of("no-hard-hat", "no-helmet", "no_hard_hat", "no_helmet", "Person");
    private static final List<String> RESTRICTED_CLASSES =
            List.of("restricted", "prohibited", "danger-zone", "danger_zone", "restricted-area");

    private final SimpMessagingTemplate ws;
    private final WebClient detectWebClient;

    public DetectionController(SimpMessagingTemplate ws,
                               @Qualifier("detectWebClient") WebClient detectWebClient) {
        this.ws = ws;
        this.detectWebClient = detectWebClient;
    }

    // ── Python 탐지 서버 프록시 ────────────────────────────────────

    @GetMapping("/status")
    public Mono<ResponseEntity<String>> status() {
        return detectWebClient.get()
                .uri("/status")
                .retrieve()
                .toEntity(String.class)
                .onErrorResume(e -> Mono.just(ResponseEntity.status(503).body("offline")));
    }

    @PostMapping("/detect")
    public Mono<ResponseEntity<String>> detect(@RequestParam("file") MultipartFile file) throws IOException {
        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        byte[] bytes = file.getBytes();
        String contentType = file.getContentType() != null ? file.getContentType() : "application/octet-stream";
        builder.part("file", new ByteArrayResource(bytes) {
            @Override
            public String getFilename() { return file.getOriginalFilename(); }
        }).contentType(MediaType.parseMediaType(contentType));

        return detectWebClient.post()
                .uri("/detect")
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(BodyInserters.fromMultipartData(builder.build()))
                .retrieve()
                .toEntity(String.class)
                .onErrorResume(e -> Mono.just(ResponseEntity.status(503).build()));
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
                "filename", filename,
                "detections", detections,
                "noHelmet", noHelmet,
                "restricted", restricted,
                "dangerous", dangerous,
                "message", buildMessage(noHelmet, restricted)
        );

        ws.convertAndSend("/topic/safe", event);

        return Map.of("received", detections.size(), "dangerous", dangerous);
    }

    private String buildMessage(boolean noHelmet, boolean restricted) {
        if (noHelmet && restricted) return "안전헬멧 미착용 + 출입금지구역 접근 감지";
        if (noHelmet) return "안전헬멧 미착용 감지";
        if (restricted) return "출입금지구역 접근 감지";
        return "이상 없음";
    }
}
