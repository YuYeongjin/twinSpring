package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface IntegrationDAO {

    List<Map<String, Object>> getAllIntegrationProjects();

    List<Map<String, Object>> getIntegrationProjectsByWbs(@Param("wbsProjectId") String wbsProjectId);

    Map<String, Object> getIntegrationProjectById(@Param("projectId") String projectId);

    void insertIntegrationProject(Map<String, Object> params);

    void updateIntegrationProject(Map<String, Object> params);

    void updateSimConfig(Map<String, Object> params);

    void deleteIntegrationProject(@Param("projectId") String projectId);
}
