package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface SafeDAO {

    List<Map<String, Object>> getAllSafeProjects();

    Map<String, Object> getSafeProjectById(@Param("projectId") String projectId);

    void insertSafeProject(Map<String, Object> params);

    void updateSafeProject(Map<String, Object> params);

    void deleteSafeProject(@Param("projectId") String projectId);
}
