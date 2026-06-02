package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import org.springframework.beans.factory.annotation.Value;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 센서 데이터 API (TimescaleDB 시계열 쿼리 지원)
 *
 * GET /api/sensor/latest                  — 최신 1건
 * GET /api/sensor/logs?limit=&location=&hours= — 원시 로그
 * GET /api/sensor/trend?location=&hours=24&bucket=30+minutes — time_bucket 집계
 * GET /api/sensor/hourly?location=&hours=48 — 시간별 평균 (Continuous Aggregate)
 * GET /api/sensor/daily?location=&days=30  — 일별 평균 (Continuous Aggregate)
 * GET /api/sensor/locations                — 위치 목록
 */
@RestController
@RequestMapping("/api/sensor")
public class SensorController {

    private final MqttService mqttService;
    private final SimpMessagingTemplate template;

    @Value("${alert.temp.max:35.0}") private double tempMax;
    @Value("${alert.temp.min:0.0}")  private double tempMin;
    @Value("${alert.hum.max:80.0}")  private double humMax;
    @Value("${alert.hum.min:20.0}")  private double humMin;

    public SensorController(MqttService mqttService, SimpMessagingTemplate template) {
        this.mqttService = mqttService;
        this.template = template;
    }

    @GetMapping("/latest")
    public ResponseEntity<SensorDTO> getLatest() {
        return ResponseEntity.ok(mqttService.getLatest());
    }

    /** 원시 로그 (하위호환 + 필터 지원) */
    @GetMapping("/logs")
    public ResponseEntity<?> logs(
            @RequestParam(required = false)           String  location,
            @RequestParam(required = false)           Integer hours,
            @RequestParam(defaultValue = "100")       int     limit) {
        return ResponseEntity.ok(mqttService.getRecentLogs(location, hours, limit));
    }

    /**
     * TimescaleDB time_bucket 트렌드
     *
     * 예: /api/sensor/trend?hours=24&bucket=30+minutes
     *     /api/sensor/trend?location=room1&hours=168&bucket=1+hour
     */
    @GetMapping("/trend")
    public ResponseEntity<List<Map<String, Object>>> trend(
            @RequestParam(required = false)      String location,
            @RequestParam(defaultValue = "24")   int    hours,
            @RequestParam(defaultValue = "1 hour") String bucket) {
        return ResponseEntity.ok(mqttService.getTrend(location, hours, bucket));
    }

    /** 시간별 Continuous Aggregate (빠른 집계 뷰) */
    @GetMapping("/hourly")
    public ResponseEntity<List<Map<String, Object>>> hourly(
            @RequestParam(required = false)    String location,
            @RequestParam(defaultValue = "48") int    hours) {
        return ResponseEntity.ok(mqttService.getHourlyAvg(location, hours));
    }

    /** 일별 Continuous Aggregate */
    @GetMapping("/daily")
    public ResponseEntity<List<Map<String, Object>>> daily(
            @RequestParam(required = false)   String location,
            @RequestParam(defaultValue = "30") int   days) {
        return ResponseEntity.ok(mqttService.getDailyAvg(location, days));
    }

    /** 등록된 위치 목록 */
    @GetMapping("/locations")
    public ResponseEntity<List<String>> locations() {
        return ResponseEntity.ok(mqttService.getLocations());
    }

    /** 임계값 설정 조회 (프론트 SensorPanel에서 기준선 표시에 사용) */
    @GetMapping("/thresholds")
    public ResponseEntity<Map<String, Object>> getThresholds() {
        return ResponseEntity.ok(Map.of(
            "tempMax", tempMax, "tempMin", tempMin,
            "humMax",  humMax,  "humMin",  humMin
        ));
    }

    @GetMapping("/test")
    public ResponseEntity<?> test() {
        return ResponseEntity.ok(mqttService.test());
    }

    /** WebSocket 연결 디버깅용 */
    @GetMapping("/ws-test")
    public ResponseEntity<?> wsTest() {
        String payload = String.format(
            "{\"location\":\"ws-test\",\"temperature\":%.1f,\"humidity\":%.1f,\"timestamp\":\"%s\"}",
            20.0 + Math.random() * 10,
            50.0 + Math.random() * 20,
            LocalDateTime.now()
        );
        template.convertAndSend("/topic/sensor", payload);
        return ResponseEntity.ok(Map.of(
            "sent", true, "topic", "/topic/sensor", "payload", payload,
            "guide", "브라우저 콘솔에 [WS] 메시지 수신 로그가 보이면 WebSocket 정상"
        ));
    }
}
