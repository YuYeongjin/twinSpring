package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.service.AlertService;

import java.util.Map;

@RestController
@RequestMapping("/api/alert")
public class AlertController {

    private final AlertService alertService;

    public AlertController(AlertService alertService) {
        this.alertService = alertService;
    }

    @PostMapping("/led/on")
    public ResponseEntity<Map<String, String>> ledOn() {
        alertService.ledOn();
        return ResponseEntity.ok(Map.of("status", "on"));
    }

    @PostMapping("/led/off")
    public ResponseEntity<Map<String, String>> ledOff() {
        alertService.ledOff();
        return ResponseEntity.ok(Map.of("status", "off"));
    }

    @GetMapping("/led/status")
    public ResponseEntity<String> ledStatus() {
        return ResponseEntity.ok(alertService.ledStatus());
    }
}
