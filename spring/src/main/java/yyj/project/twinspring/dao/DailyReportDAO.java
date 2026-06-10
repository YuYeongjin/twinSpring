package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface DailyReportDAO {

    /** 오늘 스냅샷 저장/갱신 (project_id + report_date UNIQUE 기반 upsert) */
    void upsertDailyReport(Map<String, Object> params);

    /** 특정 날짜 일보 조회 — 없으면 null 반환 */
    Map<String, Object> getDailyReport(
            @Param("projectId") String projectId,
            @Param("reportDate") String reportDate);

    /** 저장된 날짜 목록 (최근 90일, 내림차순) */
    List<String> getAvailableDates(@Param("projectId") String projectId);

    /** 태스크별 전날 진척도 조회 (일단위 증감 계산용) */
    Map<String, Object> getPrevDayProgress(
            @Param("projectId") String projectId,
            @Param("reportDate") String reportDate);
}
