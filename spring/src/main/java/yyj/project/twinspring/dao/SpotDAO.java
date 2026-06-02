package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import yyj.project.twinspring.dto.SensorDTO;

import java.util.List;
import java.util.Map;

@Mapper
public interface SpotDAO {

    void insertData(SensorDTO data);

    /** 최근 N개 원시 데이터 (location 필터 선택) */
    List<Map<String, Object>> getRecentLogs(Map<String, Object> params);

    /** 기존 하위호환 - 최근 100개 전체 */
    List<Map<String, Object>> getAll();

    /** time_bucket 집계 트렌드 (TimescaleDB) */
    List<Map<String, Object>> getTrend(Map<String, Object> params);

    /** sensor_hourly_avg Continuous Aggregate 조회 */
    List<Map<String, Object>> getHourlyAvg(Map<String, Object> params);

    /** sensor_daily_avg Continuous Aggregate 조회 */
    List<Map<String, Object>> getDailyAvg(Map<String, Object> params);

    /** 위치 목록 */
    List<String> getLocations();

    /** 기간 평균 (기존 하위호환) */
    Map<String, String> getAvgData(@Param("location") String location,
                                   @Param("start_time") String start_time);
}
