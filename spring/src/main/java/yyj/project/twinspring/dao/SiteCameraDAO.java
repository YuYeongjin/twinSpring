package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface SiteCameraDAO {
    List<Map<String, Object>> getCamerasByProject(@Param("projectId") String projectId);
    Map<String, Object>       getCameraById(@Param("cameraId") String cameraId);
    void insertCamera(Map<String, Object> params);
    void updateCamera(Map<String, Object> params);
    void deleteCamera(@Param("cameraId") String cameraId);
}
