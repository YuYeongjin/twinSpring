package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.SensorDTO;

import java.util.List;
import java.util.Map;

public interface MqttService {

    void handleMessage(String payload);

    SensorDTO getLatest();

    /** 하위호환 — 최근 100개 원시 로그 */
    List<Map<String, Object>> getLogs();

    /**
     * 최근 로그 (필터 지원)
     * @param location null 이면 전체 위치
     * @param hours    조회 범위(시간), null 이면 제한 없음
     * @param limit    최대 건수 (기본 100)
     */
    List<Map<String, Object>> getRecentLogs(String location, Integer hours, int limit);

    /**
     * TimescaleDB time_bucket 트렌드 집계
     * @param location null 이면 전체
     * @param hours    최근 N시간
     * @param bucket   집계 단위 ("5 minutes" | "30 minutes" | "1 hour" | "1 day")
     */
    List<Map<String, Object>> getTrend(String location, int hours, String bucket);

    /** 시간별 Continuous Aggregate */
    List<Map<String, Object>> getHourlyAvg(String location, int hours);

    /** 일별 Continuous Aggregate */
    List<Map<String, Object>> getDailyAvg(String location, int days);

    /** 등록된 위치 목록 */
    List<String> getLocations();

    Object test();
}
