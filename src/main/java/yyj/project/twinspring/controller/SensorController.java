package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;
import java.util.Map;

@RestController
@RequestMapping("/api/sensor")
public class SensorController {

    private final MqttService mqttService;
    // WebSocket 직접 전송용 (MQTT 없이 테스트할 때 사용)
    private final SimpMessagingTemplate template;

    public SensorController(MqttService mqttService, SimpMessagingTemplate template) {
        this.mqttService = mqttService;
        this.template = template;
    }

    @GetMapping("/latest")
    public ResponseEntity<SensorDTO> getLatest() {
        return ResponseEntity.ok(mqttService.getLatest());
    }

    @GetMapping("/test")
    public ResponseEntity<?> test() {
        return ResponseEntity.ok(mqttService.test());
    }

    @GetMapping("/logs")
    public ResponseEntity<?> logs() {
        return ResponseEntity.ok(mqttService.getLogs());
    }

    /**
     * WebSocket 연결 디버깅용 엔드포인트
     * MQTT 없이 REST로 직접 /topic/sensor 에 더미 데이터를 publish
     * 브라우저 콘솔에 "[WS] 메시지 수신:" 로그가 찍히면 WebSocket은 정상
     *
     * 호출: GET http://localhost:8080/api/sensor/ws-test
     */
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
            "sent", true,
            "topic", "/topic/sensor",
            "payload", payload,
            "guide", "브라우저 콘솔에 [WS] 메시지 수신 로그가 보이면 WebSocket 정상"
        ));
    }
}
