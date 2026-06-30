package yyj.project.twinspring.controller;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.ExcavatorGpsDTO;

/**
 * 실시간 GPS / IMU 컨트롤러
 *
 * ① 레거시 (단일 굴착기)
 *    REST : POST /api/excavator/gps          → /topic/excavator
 *    STOMP: /app/excavator/gps               → /topic/excavator
 *
 * ② 장비 ID 별 (다중 장비 지원)
 *    REST : POST /api/excavator/gps/{deviceId} → /topic/gps/{deviceId}
 *    STOMP: /app/gps/{deviceId}               → /topic/gps/{deviceId}
 */
@RestController
@RequestMapping("/api/excavator")
public class ExcavatorController {

    private final SimpMessagingTemplate messaging;

    public ExcavatorController(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    // ── 레거시 (단일 토픽) ────────────────────────────────────────────────

    @PostMapping("/gps")
    public void receiveGpsHttp(@RequestBody ExcavatorGpsDTO dto) {
        messaging.convertAndSend("/topic/excavator", dto);
    }

    @MessageMapping("/excavator/gps")
    public void receiveGpsWs(ExcavatorGpsDTO dto) {
        messaging.convertAndSend("/topic/excavator", dto);
    }

    // ── 장비 ID 별 (다중 장비) ────────────────────────────────────────────

    /** REST: POST /api/excavator/gps/{deviceId} */
    @PostMapping("/gps/{deviceId}")
    public void receiveGpsByIdHttp(@PathVariable String deviceId,
                                   @RequestBody ExcavatorGpsDTO dto) {
        messaging.convertAndSend("/topic/gps/" + deviceId, dto);
    }

    /** STOMP: /app/gps/{deviceId} */
    @MessageMapping("/gps/{deviceId}")
    public void receiveGpsByIdWs(@DestinationVariable String deviceId,
                                 ExcavatorGpsDTO dto) {
        messaging.convertAndSend("/topic/gps/" + deviceId, dto);
    }
}
