package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface SimulationDAO {

    List<Map<String, Object>> getAllSimulationProjects();

    void insertSimulationProject(Map<String, Object> params);

    void updateSimulationProjectName(Map<String, Object> params);

    void deleteSimulationProject(@Param("projectId") String projectId);
}
