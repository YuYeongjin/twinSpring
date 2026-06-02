package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.MonitoringCameraDTO;
import yyj.project.twinspring.dto.MonitoringScheduleDTO;
import yyj.project.twinspring.dto.MonitoringSnapshotDTO;

import java.util.List;

public interface MonitoringService {

    // ── 카메라 ───────────────────────────────────────────────────────
    List<MonitoringCameraDTO> getCamerasByProject(String projectId);
    MonitoringCameraDTO addCamera(String projectId, MonitoringCameraDTO dto);
    MonitoringCameraDTO updateCamera(String cameraId, MonitoringCameraDTO dto);
    void deleteCamera(String cameraId);

    // ── 스케줄 ───────────────────────────────────────────────────────
    MonitoringScheduleDTO getScheduleByProject(String projectId);
    MonitoringScheduleDTO upsertSchedule(String projectId, MonitoringScheduleDTO dto);

    // ── 스냅샷 ───────────────────────────────────────────────────────
    List<MonitoringSnapshotDTO> getSnapshotsByProject(String projectId);
    byte[] getSnapshotImage(String snapshotId);
    void deleteSnapshot(String snapshotId);
}
