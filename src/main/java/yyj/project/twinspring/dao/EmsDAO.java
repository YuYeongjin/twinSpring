package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import yyj.project.twinspring.dto.EmsAlertDTO;
import yyj.project.twinspring.dto.EmsDTO;
import yyj.project.twinspring.dto.EmsThresholdDTO;

import java.util.List;
import java.util.Map;

/**
 * EMS 데이터 액세스 객체 (MyBatis Mapper 인터페이스)
 * ENERGY_DATA, EMS_ALERT, EMS_THRESHOLD 테이블에 대한 CRUD 메서드 정의
 */
@Mapper
public interface EmsDAO {

    // ======================== 에너지 데이터 ========================

    /** 에너지 계측 데이터 저장 */
    void insertEnergyData(EmsDTO data);

    /** 최근 100건의 에너지 데이터 조회 */
    List<Map<String, Object>> getRecentEnergyData();

    /** 위치별 최신 에너지 데이터 조회 */
    Map<String, Object> getLatestByLocation(@Param("location") String location);

    /** 구역별 에너지 합계 집계 (오늘 기준) */
    List<Map<String, Object>> getEnergyByZone();

    /** 시간대별 에너지 추이 조회 (최근 24시간) */
    List<Map<String, Object>> getHourlyEnergyTrend();

    /** 일별 에너지 합계 조회 (최근 30일) */
    List<Map<String, Object>> getDailyEnergySummary();

    // ======================== 알람 관리 ========================

    /** 알람 저장 */
    void insertAlert(EmsAlertDTO alert);

    /** 미해결 알람 목록 조회 */
    List<EmsAlertDTO> getActiveAlerts();

    /** 알람 해결 처리 */
    void resolveAlert(@Param("id") Long id);

    /** 최근 50건 알람 이력 조회 */
    List<EmsAlertDTO> getAlertHistory();

    // ======================== 임계값 설정 ========================

    /** 임계값 저장 또는 업데이트 */
    void upsertThreshold(EmsThresholdDTO threshold);

    /** 특정 위치, 유형의 임계값 조회 */
    EmsThresholdDTO getThreshold(@Param("thresholdType") String thresholdType,
                                  @Param("location") String location);

    /** 모든 임계값 조회 */
    List<EmsThresholdDTO> getAllThresholds();
}
