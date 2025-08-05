package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import yyj.project.twinspring.config.UnityWsPusher;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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


    @Value("${openai.key}")
    private String key;

    @Override
    public void handleMessage(String payload) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            SensorDTO data = mapper.readValue(payload, SensorDTO.class);
            System.out.println("MQTT 수신 데이터: " + data);
            spotDAO.insertData(data);

            // 이상기후 탐지 후 Noti의 강도설정
            RestTemplate restTemplate = new RestTemplate();
            Map<String, Object> request = new HashMap<>();
            request.put("temperature", data.getTemperature());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

//            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);
//
//            String url = "http://localhost:5000/predict";
//            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
//
//            Map<String, Object> result = response.getBody();
//            System.out.println("이상기온 판단 결과: " + result);

            /*
                챗봇 -> 랭체인으로
             */
            String prompt = "MQTT 수신 데이터: " + data;
            Map<String,String> chatBody = new HashMap<>();
            System.out.println(" 키 ?? " + key) ;
            chatBody.put("prompt",prompt);
            chatBody.put("api_key",key);

            String urls = "http://localhost:5001/chat";
            ResponseEntity<Map> responses = restTemplate.postForEntity(urls, chatBody, Map.class);

            Map<String, Object> results = responses.getBody();
            System.out.println("챗봇 결과: " + results);


            //
            // python vector 유사도 검색 비활성
            /*
            String current = data.toString();
            List<String> history = datas.stream()
                    .map(d ->
                            "location : " + d.get("LOCATION") + ", temperature : " + d.get("TEMPERATURE") + ", time: " + d.get("TIMESTAMP")
                    )
                    .toList();
            // Python API 호출
            RestTemplate restTemplate = new RestTemplate();
            Map<String, Object> request = new HashMap<>();
            request.put("current", current);
            request.put("history", history);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(request, headers);

            String url = "http://localhost:5005/similarity";
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);

            Map<String, Object> result = response.getBody();
            System.out.println("이상기온 판단 결과: " + result);

             */
            //

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
