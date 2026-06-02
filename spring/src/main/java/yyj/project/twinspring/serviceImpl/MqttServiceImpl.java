package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.AlertService;
import yyj.project.twinspring.service.MqttService;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class MqttServiceImpl implements MqttService {

    private static final Logger log = LoggerFactory.getLogger(MqttServiceImpl.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private volatile SensorDTO latestData = new SensorDTO();
    private volatile boolean alertActive = false;

    @Value("${alert.temp.max:35.0}") private double tempMax;
    @Value("${alert.temp.min:0.0}")  private double tempMin;
    @Value("${alert.hum.max:80.0}")  private double humMax;
    @Value("${alert.hum.min:20.0}")  private double humMin;

    private final SpotDAO spotDAO;
    private final SimpMessagingTemplate template;
    private final AlertService alertService;

    public MqttServiceImpl(SpotDAO spotDAO, SimpMessagingTemplate template, AlertService alertService) {
        this.spotDAO = spotDAO;
        this.template = template;
        this.alertService = alertService;
    }

    @Override
    public void handleMessage(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            if (root.has("temperature") || root.has("humidity")) {
                SensorDTO data = objectMapper.treeToValue(root, SensorDTO.class);
                OffsetDateTime odt = OffsetDateTime.parse(data.getTimestamp());

                String dbFriendlyTimestamp = odt.toLocalDateTime()
                        .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSSSSS"));
                data.setTimestamp(dbFriendlyTimestamp);

                latestData = data;
                spotDAO.insertData(data);
                template.convertAndSend("/topic/sensor", data);

                checkAndTriggerAlert(data);
            }

            if (!root.has("temperature") && !root.has("humidity")) {
                log.warn("MQTT 메시지 형식 미인식: {}", payload);
            }

        } catch (Exception e) {
            log.error("MQTT 메시지 처리 실패. payload={}", payload, e);
        }
    }

    private void checkAndTriggerAlert(SensorDTO data) {
        boolean tempAlert = data.getTemperature() > tempMax || data.getTemperature() < tempMin;
        boolean humAlert  = data.getHumidity()    > humMax  || data.getHumidity()    < humMin;
        boolean nowAlert  = tempAlert || humAlert;

        if (nowAlert && !alertActive) {
            alertActive = true;
            alertService.ledOn();

            Map<String, Object> msg = new HashMap<>();
            msg.put("type", "alert");
            msg.put("temperature", data.getTemperature());
            msg.put("humidity", data.getHumidity());
            msg.put("timestamp", data.getTimestamp());
            msg.put("reason", buildReason(tempAlert, humAlert, data));
            template.convertAndSend("/topic/alert", msg);

            log.warn("[Alert] 임계값 초과 — temp={}, hum={}", data.getTemperature(), data.getHumidity());

        } else if (!nowAlert && alertActive) {
            alertActive = false;
            alertService.ledOff();

            Map<String, Object> msg = new HashMap<>();
            msg.put("type", "resolved");
            msg.put("temperature", data.getTemperature());
            msg.put("humidity", data.getHumidity());
            msg.put("timestamp", data.getTimestamp());
            template.convertAndSend("/topic/alert", msg);

            log.info("[Alert] 정상 복귀 — temp={}, hum={}", data.getTemperature(), data.getHumidity());
        }
    }

    private String buildReason(boolean tempAlert, boolean humAlert, SensorDTO data) {
        StringBuilder sb = new StringBuilder();
        if (tempAlert) sb.append(String.format("온도 %.1f°C (허용: %.1f~%.1f)", data.getTemperature(), tempMin, tempMax));
        if (tempAlert && humAlert) sb.append(" / ");
        if (humAlert)  sb.append(String.format("습도 %.1f%% (허용: %.1f~%.1f)", data.getHumidity(), humMin, humMax));
        return sb.toString();
    }

    @Override
    public SensorDTO getLatest() {
        return latestData;
    }

    @Override
    public List<Map<String, Object>> getLogs() {
        return spotDAO.getAll();
    }

    @Override
    public List<Map<String, Object>> getRecentLogs(String location, Integer hours, int limit) {
        Map<String, Object> p = new HashMap<>();
        p.put("location", location);
        p.put("hours",    hours);
        p.put("limit",    limit);
        return spotDAO.getRecentLogs(p);
    }

    @Override
    public List<Map<String, Object>> getTrend(String location, int hours, String bucket) {
        Map<String, Object> p = new HashMap<>();
        p.put("location", location);
        p.put("hours",    hours);
        p.put("bucket",   bucket);
        return spotDAO.getTrend(p);
    }

    @Override
    public List<Map<String, Object>> getHourlyAvg(String location, int hours) {
        Map<String, Object> p = new HashMap<>();
        p.put("location", location);
        p.put("hours",    hours);
        return spotDAO.getHourlyAvg(p);
    }

    @Override
    public List<Map<String, Object>> getDailyAvg(String location, int days) {
        Map<String, Object> p = new HashMap<>();
        p.put("location", location);
        p.put("days",     days);
        return spotDAO.getDailyAvg(p);
    }

    @Override
    public List<String> getLocations() {
        return spotDAO.getLocations();
    }

    @Override
    public Object test() {
        return getLogs();
    }
}
