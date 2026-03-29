package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.SpotDAO;
import yyj.project.twinspring.dto.EmsDTO;
import yyj.project.twinspring.dto.SensorDTO;
import yyj.project.twinspring.service.EmsService;
import yyj.project.twinspring.service.MqttService;

import java.time.LocalDateTime;
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
    // EMS 서비스: MQTT 메시지에 에너지 데이터가 포함된 경우 처리를 위임
    private final EmsService emsService;

    public MqttServiceImpl(SpotDAO spotDAO, SimpMessagingTemplate template, EmsService emsService) {
        this.spotDAO = spotDAO;
        this.template = template;
        this.emsService = emsService;
    }

    /**
     * MQTT 메시지 수신 및 분기 처리
     *
     * 메시지 유형 판별 로직:
     * 1. JSON 파싱 후 "powerKw" 필드가 있으면 → EMS 에너지 데이터로 처리
     * 2. "temperature" 또는 "humidity" 필드가 있으면 → 온습도 센서 데이터로 처리
     * 3. 둘 다 있으면 각각 분기 처리 (복합 페이로드 지원)
     *
     * MQTT 토픽 구조 예시:
     *  - test/topic        : 온습도 센서 데이터
     *  - ems/power         : 에너지 계측 데이터 (선택적으로 토픽 분리 가능)
     */
    @Override
    public void handleMessage(String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);

            // EMS 에너지 데이터 여부 판별: powerKw 필드 존재 시 EMS 데이터로 분기
            if (root.has("powerKw")) {
                EmsDTO emsData = objectMapper.treeToValue(root, EmsDTO.class);
                log.info("MQTT EMS 에너지 데이터 수신: location={}, power={}kW",
                        emsData.getLocation(), emsData.getPowerKw());
                // EmsService로 위임: DB 저장 + 알람 검사 + WebSocket 브로드캐스트
                emsService.handleEnergyData(emsData);
            }

            if (root.has("temperature") || root.has("humidity")) {
                SensorDTO data = objectMapper.treeToValue(root, SensorDTO.class);
                OffsetDateTime odt = OffsetDateTime.parse(data.getTimestamp());

                // 포맷터 정의 (T 대신 공백 사용)
                String dbFriendlyTimestamp = odt.toLocalDateTime()
                        .format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSSSSS"));

                data.setTimestamp(dbFriendlyTimestamp);

                spotDAO.insertData(data);
            }

            // 두 필드 모두 없는 경우 경고 로그
            if (!root.has("powerKw") && !root.has("temperature") && !root.has("humidity")) {
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
