package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

@RestController
@RequestMapping("/api/sensor")
@CrossOrigin(origins = "*")
public class SensorController {

    private final MqttService mqttService;

    public SensorController(MqttService mqttService){
        this.mqttService = mqttService;
    }

    @GetMapping("/latest")
    public ResponseEntity<SensorDTO> getLatest() {
        return ResponseEntity.ok(mqttService.getLatest());
    }

    @GetMapping("/test")
    public ResponseEntity<?> test (){
        return ResponseEntity.ok(mqttService.test());
    }

    @GetMapping("/logs")
    public ResponseEntity<?> logs(){
        return ResponseEntity.ok( mqttService.getLogs());
    }

}
