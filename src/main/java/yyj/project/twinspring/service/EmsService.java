package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.EmsAlertDTO;
import yyj.project.twinspring.dto.EmsDTO;
import yyj.project.twinspring.dto.EmsThresholdDTO;

import java.util.List;
import java.util.Map;

/**
 * EMS(에너지 관리 시스템) 서비스 인터페이스
 * 에너지 데이터 처리, 알람 관리, 에너지 분석 기능 정의
 */
public interface EmsService {

    /**
     * MQTT 또는 REST로 수신된 에너지 데이터를 처리
     * - DB 저장 → 임계값 검사 → 알람 생성 → WebSocket 브로드캐스트
     */
    void handleEnergyData(EmsDTO data);

    /** 최신 에너지 데이터 반환 */
    EmsDTO getLatestEnergyData();

    /** 최근 에너지 로그 반환 */
    List<Map<String, Object>> getEnergyLogs();

    /** 구역별 에너지 소비 현황 반환 */
    List<Map<String, Object>> getEnergyByZone();

    /** 시간별 에너지 추이 반환 (최근 24시간) */
    List<Map<String, Object>> getHourlyTrend();

    /** 일별 에너지 요약 반환 (최근 30일) */
    List<Map<String, Object>> getDailySummary();

    /**
     * 에너지 비용 계산
     * @param energyKwh 소비 전력량 (kWh)
     * @return 예상 전기요금 (원)
     */
    double calculateEnergyCost(double energyKwh);

    /** 미해결 알람 목록 반환 */
    List<EmsAlertDTO> getActiveAlerts();

    /** 알람 해결 처리 */
    void resolveAlert(Long id);

    /** 알람 이력 반환 */
    List<EmsAlertDTO> getAlertHistory();

    /** 임계값 설정 또는 업데이트 */
    void setThreshold(EmsThresholdDTO threshold);

    /** 모든 임계값 조회 */
    List<EmsThresholdDTO> getAllThresholds();

    /**
     * EMS 전체 요약 데이터 반환 (대시보드 메인 카드용)
     * - 현재 전력, 오늘 누적 kWh, 예상 요금, 미해결 알람 수 포함
     */
    Map<String, Object> getEmsSummary();
}
