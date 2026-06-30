package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface MonitoringDAO {

    // ── 카메라 ───────────────────────────────────────────────────────
    List<Map<String, Object>> getCamerasByProject(@Param("projectId") String projectId);
    List<Map<String, Object>> getEnabledCamerasByProject(@Param("projectId") String projectId);
    Map<String, Object> getCameraById(@Param("cameraId") String cameraId);
    void insertCamera(Map<String, Object> params);
    void updateCamera(Map<String, Object> params);
    void deleteCamera(@Param("cameraId") String cameraId);

    // ── 스케줄 ───────────────────────────────────────────────────────
    List<Map<String, Object>> getEnabledSchedules();
    Map<String, Object> getScheduleByProjectId(@Param("projectId") String projectId);
    void upsertSchedule(Map<String, Object> params);
    void updateLastCapturedAt(@Param("scheduleId") String scheduleId);

    // ── 스냅샷 ───────────────────────────────────────────────────────
    List<Map<String, Object>> getSnapshotsByProject(@Param("projectId") String projectId);
    Map<String, Object> getSnapshotById(@Param("snapshotId") String snapshotId);
    byte[] getSnapshotImageData(@Param("snapshotId") String snapshotId);
    void insertSnapshot(Map<String, Object> params);

    int countProblemSnapshots(@Param("projectId") String projectId);
    void deleteOldestProblemSnapshot(@Param("projectId") String projectId);
    void deleteExpiredSnapshots();
    void deleteSnapshot(@Param("snapshotId") String snapshotId);

    /** PROGRESS 분석 후 detectionJson / isProblem 업데이트 */
    void updateSnapshotDetection(Map<String, Object> params);
}
