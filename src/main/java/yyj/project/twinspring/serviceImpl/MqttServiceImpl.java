package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.service.MqttService;

@Service
public class MqttServiceImpl implements MqttService {
    @Override
    public void handleMessage(String payload) {
        System.out.println("MQ Handle Service :" + payload);
    }
}
