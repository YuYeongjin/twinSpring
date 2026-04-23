package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.MqttService;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

@Service
public class MqttServiceImpl implements MqttService {

    private static final Logger log = LoggerFactory.getLogger(MqttServiceImpl.class);

    // ObjectMapper는 스레드 안전하므로 재사용
    private static final ObjectMapper objectMapper = new ObjectMapper();

    // static 제거: 인스턴스 필드로 변경 (static이면 멀티인스턴스 환경에서 공유 상태 문제 발생)
    private volatile SensorDTO latestData = new SensorDTO();

    private final SpotDAO spotDAO;
    private final SimpMessagingTemplate template;

    public MqttServiceImpl(SpotDAO spotDAO, SimpMessagingTemplate template) {
        this.spotDAO = spotDAO;
        this.template = template;
    }

    @Override
    public void handleMessage(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            if (root.has("temperature") || root.has("humidity")) {
                SensorDTO data = objectMapper.treeToValue(root, SensorDTO.class);
                OffsetDateTime odt = OffsetDateTime.parse(data.getTimestamp());

                // 포맷터 정의 (T 대신 공백 사용)
                String dbFriendlyTimestamp = odt.toLocalDateTime()
                        .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSSSSS"));

                data.setTimestamp(dbFriendlyTimestamp);

                latestData = data;
                spotDAO.insertData(data);
                template.convertAndSend("/topic/sensor", data);
            }

            if (!root.has("temperature") && !root.has("humidity")) {
                log.warn("MQTT 메시지 형식 미인식: {}", payload);
            }

        } catch (Exception e) {
            log.error("MQTT 메시지 처리 실패. payload={}", payload, e);
        }
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
    public Object test() {
        // 테스트용: DB에서 최신 로그 반환
        return getLogs();
    }
}
