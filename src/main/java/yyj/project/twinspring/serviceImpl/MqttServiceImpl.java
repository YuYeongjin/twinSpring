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
import java.time.ZonedDateTime;
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


    @Override
    public void handleMessage(String payload) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            SensorDTO data = mapper.readValue(payload, SensorDTO.class);
            System.out.println("MQTT 수신 데이터: " + data);
            spotDAO.insertData(data);

            ZonedDateTime zdt = ZonedDateTime.parse(data.getTimestamp()); // "2025-08-20T19:30:30.754860+09:00"
            ZonedDateTime hourStart = zdt.withMinute(0).withSecond(0).withNano(0);
            ZonedDateTime hourEnd   = hourStart.plusHours(1);
            System.out.println("start : " + hourStart + " // " + "data.getLocation() : " + data.getLocation() );
            Map<String,String> avgData = spotDAO.getAvgData(data.getLocation(),hourStart.toString());
            System.out.println("avgData : " + avgData);
            // 이상기후 탐지 후 Noti의 강도설정
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String,Object> sensorData = new HashMap<>();
            sensorData.put("location",data.getLocation());
            sensorData.put("temperature",data.getTemperature());
            sensorData.put("time",data.getTimestamp());
            sensorData.put("humidity",data.getHumidity());

            Map<String,Object> avgMap = new HashMap<>();
            avgMap.put("location",data.getLocation());
            avgMap.put("temperature",avgData.get("temperature"));
            avgMap.put("time",avgData.get("timestamp"));
            avgMap.put("humidity",avgData.get("humidity"));

            Map<String,Object> promptBody = new HashMap<>();
            promptBody.put("sensor_data",sensorData);
            promptBody.put("avg_data",avgMap);
            promptBody.put("prompt","현재 지역의 평균 대비 이상 기후인지 확인해줘");

            System.out.println("data : " + promptBody);

            String urls = "http://localhost:5005/agent";
            ResponseEntity<Map> responses = restTemplate.postForEntity(urls, promptBody, Map.class);

            Map<String, Object> results = responses.getBody();
            System.out.println("챗봇 결과: " + results);

            unityWsPusher.send(payload);

        } catch (Exception e) {
            e.getMessage();
        }
    }

    @Override
    public SensorDTO getLatest() {
        System.out.println("호출");
        return latestData != null ? latestData : new SensorDTO("unknown", 0, LocalDateTime.now().toString(),0);
    }

    @Override
    public Object test() {
        RestTemplate restTemplate = new RestTemplate();

        Map<String,String> chatBody = new HashMap<>();
        chatBody.put("query","location : bridgeA', 'temperature:30', 'timestamp : 2025-08-07T21:11:08, 이 값들이 이상기후인지 확인해줘");

        String urls = "http://127.0.0.1:5005/agent";
        ResponseEntity<Map> responses = restTemplate.postForEntity(urls, chatBody, Map.class);

        System.out.println("responses : " + responses.toString());
        Map<String, Object> results = responses.getBody();
        System.out.println("agent 결과: " + results);
        return null;
    }
}

/*
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

            Map<String,Object> promptData = new HashMap<>();
            promptData.put("location",data.getLocation());
            promptData.put("temperature",data.getTemperature());
            promptData.put("time",data.getTimestamp());
            promptData.put("humidity",data.getHumidity());

            Map<String,Object> promptBody = new HashMap<>();
            promptBody.put("data",promptData);
            promptBody.put("prompt","현재 지역의 평균 대비 이상 기후인지 확인해줘");

            System.out.println("data : " + promptBody);

            String urls = "http://localhost:5005/agent";
            ResponseEntity<Map> responses = restTemplate.postForEntity(urls, promptBody, Map.class);

            Map<String, Object> results = responses.getBody();
            System.out.println("챗봇 결과: " + results);

            unityWsPusher.send(payload);

        } catch (Exception e) {
            e.getMessage();
        }
    }
 */