package yyj.project.twinspring.service;

public interface MqttService {

    void handleMessage(String payload);
}
