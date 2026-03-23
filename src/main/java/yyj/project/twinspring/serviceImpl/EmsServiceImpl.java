package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.EmsDAO;
import yyj.project.twinspring.dto.EmsAlertDTO;
import yyj.project.twinspring.dto.EmsDTO;
import yyj.project.twinspring.dto.EmsThresholdDTO;
import yyj.project.twinspring.service.EmsService;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * EMS(에너지 관리 시스템) 서비스 구현체
 *
 * 주요 기능:
 * 1. 에너지 데이터 수신 및 저장 (MQTT 연동)
 * 2. 임계값 기반 알람 자동 생성 (과부하, 저역률 등)
 * 3. 에너지 비용 계산 (한국전력 산업용 요금 기준 참고)
 * 4. WebSocket을 통한 실시간 에너지 데이터 브로드캐스트
 * 5. 구역별/시간별 에너지 분석
 */
@Service
public class EmsServiceImpl implements EmsService {

    private static final Logger log = LoggerFactory.getLogger(EmsServiceImpl.class);

    // JSON 직렬화/역직렬화 (스레드 안전하므로 공유 사용)
    private static final ObjectMapper objectMapper = new ObjectMapper();

    // 한국전력 산업용(갑) 전력 요금 단가 (원/kWh) - 실제 적용 시 한전 API로 대체 권장
    private static final double ENERGY_RATE_PER_KWH = 115.0;

    // 기본 임계값 상수 (DB 설정이 없을 경우 fallback)
    private static final double DEFAULT_MAX_POWER_KW = 50.0;       // 최대 허용 전력 (kW)
    private static final double DEFAULT_MIN_POWER_FACTOR = 0.85;   // 최소 역률 (85%)
    private static final double DEFAULT_MAX_VOLTAGE = 240.0;       // 최대 전압 (V)
    private static final double DEFAULT_MIN_VOLTAGE = 200.0;       // 최소 전압 (V)

    // 최신 에너지 데이터 (volatile: 멀티스레드 환경에서 가시성 보장)
    private volatile EmsDTO latestEnergyData = new EmsDTO();

    private final EmsDAO emsDAO;
    private final SimpMessagingTemplate template; // WebSocket 메시지 전송

    public EmsServiceImpl(EmsDAO emsDAO, SimpMessagingTemplate template) {
        this.emsDAO = emsDAO;
        this.template = template;
    }

    /**
     * 에너지 데이터 수신 처리
     * MQTT 메시지 또는 REST 요청으로 들어온 에너지 데이터를 처리하는 핵심 메서드
     *
     * 처리 순서:
     * 1. timestamp가 없으면 현재 시각으로 설정
     * 2. DB에 에너지 데이터 저장
     * 3. 최신 데이터 메모리에 캐싱
     * 4. 임계값 초과 여부 검사 → 알람 생성
     * 5. WebSocket으로 실시간 브로드캐스트 (/topic/ems)
     */
    @Override
    public void handleEnergyData(EmsDTO data) {
        try {
            // timestamp가 없으면 현재 시각으로 자동 설정
            if (data.getTimestamp() == null || data.getTimestamp().isBlank()) {
                data.setTimestamp(LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
            }

            // DB 저장
            emsDAO.insertEnergyData(data);
            latestEnergyData = data;

            log.info("EMS 에너지 데이터 수신: location={}, power={}kW, energy={}kWh",
                    data.getLocation(), data.getPowerKw(), data.getEnergyKwh());

            // 임계값 초과 검사 → 알람 자동 생성
            checkAndGenerateAlerts(data);

            // WebSocket으로 실시간 전송 (프론트엔드 /topic/ems 구독)
            String json = objectMapper.writeValueAsString(data);
            template.convertAndSend("/topic/ems", json);

        } catch (Exception e) {
            log.error("EMS 에너지 데이터 처리 실패: {}", data, e);
        }
    }

    /**
     * 임계값 초과 여부 검사 및 알람 자동 생성
     *
     * 검사 항목:
     * 1. 소비 전력 초과 (OVER_POWER): 과부하 위험
     * 2. 역률 미달 (LOW_POWER_FACTOR): 에너지 손실 발생
     * 3. 과전압 (HIGH_VOLTAGE): 설비 손상 위험
     * 4. 저전압 (LOW_VOLTAGE): 오작동 위험
     */
    private void checkAndGenerateAlerts(EmsDTO data) {
        String now = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);

        // 1. 소비 전력 임계값 검사
        EmsThresholdDTO powerThreshold = emsDAO.getThreshold("MAX_POWER_KW", data.getLocation());
        double maxPower = (powerThreshold != null) ? powerThreshold.getThresholdValue() : DEFAULT_MAX_POWER_KW;

        if (data.getPowerKw() > maxPower) {
            // 초과 비율에 따라 심각도 결정
            String severity = (data.getPowerKw() > maxPower * 1.2) ? "CRITICAL" : "WARNING";
            EmsAlertDTO alert = new EmsAlertDTO(
                    null,
                    "OVER_POWER",
                    severity,
                    String.format("[%s] 소비 전력 임계값 초과: %.1fkW (기준: %.1fkW)",
                            data.getLocation(), data.getPowerKw(), maxPower),
                    data.getLocation(),
                    maxPower,
                    data.getPowerKw(),
                    false,
                    now
            );
            emsDAO.insertAlert(alert);
            // WebSocket으로 알람 브로드캐스트
            broadcastAlert(alert);
            log.warn("EMS 알람 발생 [{}]: {}", severity, alert.getMessage());
        }

        // 2. 역률 임계값 검사 (0보다 클 때만 검사 - 데이터가 있는 경우)
        if (data.getPowerFactor() > 0) {
            EmsThresholdDTO pfThreshold = emsDAO.getThreshold("MIN_POWER_FACTOR", data.getLocation());
            double minPF = (pfThreshold != null) ? pfThreshold.getThresholdValue() : DEFAULT_MIN_POWER_FACTOR;

            if (data.getPowerFactor() < minPF) {
                EmsAlertDTO alert = new EmsAlertDTO(
                        null,
                        "LOW_POWER_FACTOR",
                        "WARNING",
                        String.format("[%s] 역률 기준치 미달: %.2f (기준: %.2f) - 에너지 손실 발생",
                                data.getLocation(), data.getPowerFactor(), minPF),
                        data.getLocation(),
                        minPF,
                        data.getPowerFactor(),
                        false,
                        now
                );
                emsDAO.insertAlert(alert);
                broadcastAlert(alert);
                log.warn("EMS 알람 발생 [WARNING]: {}", alert.getMessage());
            }
        }

        // 3. 전압 범위 검사 (전압 데이터가 있는 경우만)
        if (data.getVoltage() > 0) {
            if (data.getVoltage() > DEFAULT_MAX_VOLTAGE) {
                EmsAlertDTO alert = new EmsAlertDTO(
                        null, "HIGH_VOLTAGE", "CRITICAL",
                        String.format("[%s] 과전압 감지: %.1fV (기준 최대: %.1fV)", data.getLocation(), data.getVoltage(), DEFAULT_MAX_VOLTAGE),
                        data.getLocation(), DEFAULT_MAX_VOLTAGE, data.getVoltage(), false, now
                );
                emsDAO.insertAlert(alert);
                broadcastAlert(alert);
            } else if (data.getVoltage() < DEFAULT_MIN_VOLTAGE) {
                EmsAlertDTO alert = new EmsAlertDTO(
                        null, "LOW_VOLTAGE", "WARNING",
                        String.format("[%s] 저전압 감지: %.1fV (기준 최소: %.1fV)", data.getLocation(), data.getVoltage(), DEFAULT_MIN_VOLTAGE),
                        data.getLocation(), DEFAULT_MIN_VOLTAGE, data.getVoltage(), false, now
                );
                emsDAO.insertAlert(alert);
                broadcastAlert(alert);
            }
        }
    }

    /**
     * WebSocket으로 알람을 실시간 브로드캐스트
     * 프론트엔드에서 /topic/ems-alert 구독 시 수신 가능
     */
    private void broadcastAlert(EmsAlertDTO alert) {
        try {
            String json = objectMapper.writeValueAsString(alert);
            template.convertAndSend("/topic/ems-alert", json);
        } catch (Exception e) {
            log.error("EMS 알람 WebSocket 전송 실패", e);
        }
    }

    @Override
    public EmsDTO getLatestEnergyData() {
        return latestEnergyData;
    }

    @Override
    public List<Map<String, Object>> getEnergyLogs() {
        return emsDAO.getRecentEnergyData();
    }

    @Override
    public List<Map<String, Object>> getEnergyByZone() {
        return emsDAO.getEnergyByZone();
    }

    @Override
    public List<Map<String, Object>> getHourlyTrend() {
        return emsDAO.getHourlyEnergyTrend();
    }

    @Override
    public List<Map<String, Object>> getDailySummary() {
        return emsDAO.getDailyEnergySummary();
    }

    /**
     * 에너지 비용 계산
     * 한국전력 산업용(갑) 요금 기준으로 계산 (단순 단가 × 사용량)
     * 실제 적용 시 기본요금, 시간대별 요금, 세금 등을 추가 반영해야 함
     *
     * @param energyKwh 사용 전력량 (kWh)
     * @return 예상 전기요금 (원)
     */
    @Override
    public double calculateEnergyCost(double energyKwh) {
        return energyKwh * ENERGY_RATE_PER_KWH;
    }

    @Override
    public List<EmsAlertDTO> getActiveAlerts() {
        return emsDAO.getActiveAlerts();
    }

    @Override
    public void resolveAlert(Long id) {
        emsDAO.resolveAlert(id);
        log.info("EMS 알람 해결 처리: id={}", id);
    }

    @Override
    public List<EmsAlertDTO> getAlertHistory() {
        return emsDAO.getAlertHistory();
    }

    @Override
    public void setThreshold(EmsThresholdDTO threshold) {
        // 수정 시각 자동 설정
        threshold.setUpdatedAt(LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME));
        emsDAO.upsertThreshold(threshold);
        log.info("EMS 임계값 설정: type={}, location={}, value={}",
                threshold.getThresholdType(), threshold.getLocation(), threshold.getThresholdValue());
    }

    @Override
    public List<EmsThresholdDTO> getAllThresholds() {
        return emsDAO.getAllThresholds();
    }

    /**
     * EMS 대시보드 메인 요약 데이터 반환
     * 한 번의 API 호출로 대시보드에 필요한 핵심 정보를 모두 제공
     *
     * 반환 데이터:
     * - currentPowerKw    : 현재 소비 전력 (kW)
     * - currentVoltage    : 현재 전압 (V)
     * - currentPowerFactor: 현재 역률
     * - todayEnergyKwh    : 오늘 누적 전력량 (kWh)
     * - estimatedCost     : 오늘 예상 전기요금 (원)
     * - activeAlertCount  : 미해결 알람 수
     * - zoneData          : 구역별 에너지 소비 현황
     */
    @Override
    public Map<String, Object> getEmsSummary() {
        Map<String, Object> summary = new HashMap<>();

        // 최신 에너지 데이터에서 현재 값 추출
        summary.put("currentPowerKw", latestEnergyData.getPowerKw());
        summary.put("currentVoltage", latestEnergyData.getVoltage());
        summary.put("currentPowerFactor", latestEnergyData.getPowerFactor());
        summary.put("currentEnergyKwh", latestEnergyData.getEnergyKwh());
        summary.put("location", latestEnergyData.getLocation());

        // 오늘 예상 전기요금 계산
        summary.put("estimatedCost", calculateEnergyCost(latestEnergyData.getEnergyKwh()));

        // 미해결 알람 개수
        List<EmsAlertDTO> activeAlerts = emsDAO.getActiveAlerts();
        summary.put("activeAlertCount", activeAlerts.size());
        summary.put("activeAlerts", activeAlerts);

        // 구역별 에너지 소비 현황
        summary.put("zoneData", emsDAO.getEnergyByZone());

        return summary;
    }
}
