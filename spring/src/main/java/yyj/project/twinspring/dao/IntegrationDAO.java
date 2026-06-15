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

    void updateSiteOrigin(Map<String, Object> params);

    void deleteIntegrationProject(@Param("projectId") String projectId);

    /** project_link 삭제 전, 통합관제에 동일한 WBS+BIM 조합이 남아있는지 확인 */
    int countIntegrationByWbsAndBim(@Param("wbsProjectId") String wbsProjectId,
                                    @Param("bimProjectId")  String bimProjectId);
}
