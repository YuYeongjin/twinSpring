package yyj.project.twinspring.service;

import org.springframework.http.ResponseEntity;
import yyj.project.twinspring.dto.SensorDTO;

public interface MqttService {

    void handleMessage(String payload);
    SensorDTO getLatest();

    Object test();

    Object getLogs();
}
