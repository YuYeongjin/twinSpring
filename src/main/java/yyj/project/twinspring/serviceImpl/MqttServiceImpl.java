package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.*;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import yyj.project.twinspring.config.UnityWsPusher;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.Map;

@Service
public class MqttServiceImpl implements MqttService {

    private static SensorDTO latestData = new SensorDTO();

    private final SpotDAO spotDAO;
    private final UnityWsPusher unityWsPusher;
    private final SimpMessagingTemplate template;
    public MqttServiceImpl(
            SpotDAO spotDAO,
            UnityWsPusher unityWsPusher,
            SimpMessagingTemplate template) {
        this.spotDAO = spotDAO;
        this.unityWsPusher = unityWsPusher;
        this.template = template;
    }


    @Override
    public void handleMessage(String payload) {
        try {
            ObjectMapper mapper = new ObjectMapper();
            SensorDTO data = mapper.readValue(payload, SensorDTO.class);
            System.out.println("MQTT 수신 데이터: " + data);
            spotDAO.insertData(data);

            // 화면으로 Send


//            ZonedDateTime zdt = ZonedDateTime.parse(data.getTimestamp());
//            ZonedDateTime hourStart = zdt.withMinute(0).withSecond(0).withNano(0);
//            Map<String,String> avgData = spotDAO.getAvgData(data.getLocation(),hourStart.toString());
//            System.out.println("avgData : " + avgData);
            // 이상기후 탐지 후 Noti의 강도설정

            /*
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
            */

//            unityWsPusher.send(payload);

            template.convertAndSend("/topic/sensor", payload);
        } catch (Exception e) {
            e.printStackTrace();
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
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);

        Map<String, Object> body = new HashMap<>();
        body.put("date", "2025-08-25_03:12:10");
        body.put("amount", 3500000);
        body.put("source_account_address", "0x5ce9a16a7b7656ecbb760f13996bea982a18fbff");
        body.put("target_account_address", "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
        body.put("nx", 51.5074);
        body.put("ny", -0.1278);
        body.put("device_info", "new-device-zzz-999");

        HttpEntity<Map<String, Object>> req = new HttpEntity<>(body, headers);
        ResponseEntity<String> resp = restTemplate.postForEntity("http://localhost:5005/agent", req, String.class);
        System.out.println(resp.getBody());

        return null;
    }

    @Override
    public Object getLogs() {
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