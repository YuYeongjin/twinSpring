package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.SensorDTO;

import java.util.List;
import java.util.Map;

public interface MqttService {

    void handleMessage(String payload);

    SensorDTO getLatest();

    List<Map<String, Object>> getLogs();

    Object test();
}
