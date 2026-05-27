package yyj.project.twinspring.controller;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.ExcavatorGpsDTO;

/**
 * 굴착기 실시간 GPS / IMU 제어 컨트롤러
 *
 * 외부 센서(모바일 앱, IoT 기기 등)에서 전송한 GPS/IMU 데이터를
 * WebSocket 토픽 /topic/excavator 로 브로드캐스트한다.
 *
 * ① REST: POST /api/excavator/gps
 *    - HTTP를 선호하는 클라이언트(모바일 앱, 서버 → 서버)용
 *    - Content-Type: application/json
 *
 * ② STOMP: /app/excavator/gps  (WebSocket /ws/sensor 연결 후)
 *    - 프론트엔드 또는 IoT 기기가 STOMP로 직접 발행할 때 사용
 *
 * 두 경로 모두 동일한 /topic/excavator 토픽에 브로드캐스트한다.
 */
@RestController
@RequestMapping("/api/excavator")
public class ExcavatorController {

    private final SimpMessagingTemplate messaging;

    public ExcavatorController(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    /**
     * REST 방식으로 GPS/IMU 패킷을 수신하여 WebSocket 브로드캐스트.
     * POST /api/excavator/gps
     */
    @PostMapping("/gps")
    public void receiveGpsHttp(@RequestBody ExcavatorGpsDTO dto) {
        messaging.convertAndSend("/topic/excavator", dto);
    }

    /**
     * STOMP 방식으로 GPS/IMU 패킷을 수신하여 WebSocket 브로드캐스트.
     * 클라이언트에서 stompClient.publish({ destination: '/app/excavator/gps', body: JSON.stringify(dto) })
     */
    @MessageMapping("/excavator/gps")
    public void receiveGpsWs(ExcavatorGpsDTO dto) {
        messaging.convertAndSend("/topic/excavator", dto);
    }
}
