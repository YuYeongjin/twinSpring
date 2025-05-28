package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.config.UnityWebSocketHandler;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;

@Service
public class MqttServiceImpl implements MqttService {

    private volatile SensorDTO latestData;

    private final UnityWebSocketHandler unityWebSocketHandler;

    public MqttServiceImpl(UnityWebSocketHandler unityWebSocketHandler) {
        this.unityWebSocketHandler = unityWebSocketHandler;
    }

    @Override
    public void handleMessage(String payload) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            SensorDTO data = mapper.readValue(payload, SensorDTO.class);
            this.latestData = data;
            System.out.println("MQTT 수신 데이터: " + latestData);

            unityWebSocketHandler.broadcast(payload);

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public SensorDTO getLatest() {
        System.out.println("호출");
        return latestData != null ? latestData : new SensorDTO("unknown", 0, LocalDateTime.now().toString());
    }
}
