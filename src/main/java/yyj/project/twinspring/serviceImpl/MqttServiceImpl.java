package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import yyj.project.twinspring.config.UnityWsPusher;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

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
            System.out.println(check(data.toString()));
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


    private final RestTemplate restTemplate = new RestTemplate();
    public Object check(String text){
        String url = "http://localhost:5005/similarity";

        // Request body 구성
        Map<String, String> request = new HashMap<>();
        request.put("text", text);

        // Header 설정
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        HttpEntity<Map<String, String>> entity = new HttpEntity<>(request, headers);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    entity,
                    Map.class
            );
            return response.getBody();  // {"similarity": 0.73, ...}
        } catch (Exception e) {
            e.printStackTrace();
            return Map.of("error", "연결 실패");
        }
    }
}
