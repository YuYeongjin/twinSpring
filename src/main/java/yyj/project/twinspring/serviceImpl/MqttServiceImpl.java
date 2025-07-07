package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.config.UnityWsPusher;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;

@Service
public class MqttServiceImpl implements MqttService {

    private static SensorDTO latestData = new SensorDTO();

    private final SpotDAO spotDAO;
    private final UnityWsPusher unityWsPusher;

    public MqttServiceImpl(
            SpotDAO spotDAO,
            UnityWsPusher unityWsPusher
    ) {
        this.spotDAO = spotDAO;
        this.unityWsPusher = unityWsPusher;
    }


    @Override
    public void handleMessage(String payload) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            SensorDTO data = mapper.readValue(payload, SensorDTO.class);
            System.out.println("MQTT 수신 데이터: " + data);

            spotDAO.insertData(data);
            unityWsPusher.send(payload);

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
