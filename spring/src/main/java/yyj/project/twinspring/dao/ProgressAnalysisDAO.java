package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;

import java.util.List;
import java.util.Map;

@Mapper
public interface ProgressAnalysisDAO {
    void insertAnalysis(Map<String, Object> params);
    List<Map<String, Object>> getAnalysisByProject(String wbsProjectId);
    List<Map<String, Object>> getAnalysisByTask(String wbsTaskId);
    Map<String, Object> getLatestAnalysisByTask(String wbsTaskId);
}
