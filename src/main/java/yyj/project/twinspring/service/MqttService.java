package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.SensorDTO;

public interface MqttService {

    void handleMessage(String payload);
    SensorDTO getLatest();
}
