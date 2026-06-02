package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.MonitoringDAO;
import yyj.project.twinspring.dto.MonitoringCameraDTO;
import yyj.project.twinspring.dto.MonitoringScheduleDTO;
import yyj.project.twinspring.dto.MonitoringSnapshotDTO;
import yyj.project.twinspring.service.MonitoringService;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class MonitoringServiceImpl implements MonitoringService {

    private final MonitoringDAO dao;

    public MonitoringServiceImpl(MonitoringDAO dao) {
        this.dao = dao;
    }

    // ── 카메라 ───────────────────────────────────────────────────────

    @Override
    public List<MonitoringCameraDTO> getCamerasByProject(String projectId) {
        return dao.getCamerasByProject(projectId).stream()
                .map(this::rowToCamera)
                .collect(Collectors.toList());
    }

    @Override
    public MonitoringCameraDTO addCamera(String projectId, MonitoringCameraDTO dto) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> p = new HashMap<>();
        p.put("cameraId",   id);
        p.put("projectId",  projectId);
        p.put("cameraName", dto.getCameraName() != null ? dto.getCameraName() : "카메라");
        p.put("cameraUrl",  dto.getCameraUrl());
        p.put("enabled",    dto.isEnabled());
        p.put("sortOrder",  dto.getSortOrder());
        dao.insertCamera(p);
        dto.setCameraId(id);
        dto.setProjectId(projectId);
        return dto;
    }

    @Override
    public MonitoringCameraDTO updateCamera(String cameraId, MonitoringCameraDTO dto) {
        Map<String, Object> p = new HashMap<>();
        p.put("cameraId",   cameraId);
        p.put("cameraName", dto.getCameraName());
        p.put("cameraUrl",  dto.getCameraUrl());
        p.put("enabled",    dto.isEnabled());
        p.put("sortOrder",  dto.getSortOrder());
        dao.updateCamera(p);
        dto.setCameraId(cameraId);
        return dto;
    }

    @Override
    public void deleteCamera(String cameraId) {
        dao.deleteCamera(cameraId);
    }

    // ── 스케줄 ───────────────────────────────────────────────────────

    @Override
    public MonitoringScheduleDTO getScheduleByProject(String projectId) {
        Map<String, Object> row = dao.getScheduleByProjectId(projectId);
        return row != null ? rowToSchedule(row) : null;
    }

    @Override
    public MonitoringScheduleDTO upsertSchedule(String projectId, MonitoringScheduleDTO dto) {
        Map<String, Object> existing = dao.getScheduleByProjectId(projectId);
        String scheduleId = existing != null
                ? (String) existing.get("scheduleId")
                : UUID.randomUUID().toString();

        Map<String, Object> p = new HashMap<>();
        p.put("scheduleId",         scheduleId);
        p.put("projectId",          projectId);
        p.put("enabled",            dto.isEnabled());
        p.put("captureIntervalSec", dto.getCaptureIntervalSec());
        p.put("retentionSec",       dto.getRetentionSec());
        dao.upsertSchedule(p);

        dto.setScheduleId(scheduleId);
        dto.setProjectId(projectId);
        return dto;
    }

    // ── 스냅샷 ───────────────────────────────────────────────────────

    @Override
    public List<MonitoringSnapshotDTO> getSnapshotsByProject(String projectId) {
        return dao.getSnapshotsByProject(projectId).stream()
                .map(this::rowToSnapshot)
                .collect(Collectors.toList());
    }

    @Override
    public byte[] getSnapshotImage(String snapshotId) {
        return dao.getSnapshotImageData(snapshotId);
    }

    @Override
    public void deleteSnapshot(String snapshotId) {
        dao.deleteSnapshot(snapshotId);
    }

    // ── 변환 헬퍼 ────────────────────────────────────────────────────

    private MonitoringCameraDTO rowToCamera(Map<String, Object> r) {
        MonitoringCameraDTO dto = new MonitoringCameraDTO();
        dto.setCameraId((String)   r.get("cameraId"));
        dto.setProjectId((String)  r.get("projectId"));
        dto.setCameraName((String) r.get("cameraName"));
        dto.setCameraUrl((String)  r.get("cameraUrl"));
        Object en = r.get("enabled");
        dto.setEnabled(en instanceof Boolean ? (Boolean) en : Boolean.parseBoolean(String.valueOf(en)));
        dto.setSortOrder(toInt(r.get("sortOrder")));
        dto.setCreatedAt(r.get("createdAt") != null ? r.get("createdAt").toString() : null);
        return dto;
    }

    private MonitoringScheduleDTO rowToSchedule(Map<String, Object> r) {
        MonitoringScheduleDTO dto = new MonitoringScheduleDTO();
        dto.setScheduleId((String) r.get("scheduleId"));
        dto.setProjectId((String)  r.get("projectId"));
        Object en = r.get("enabled");
        dto.setEnabled(en instanceof Boolean ? (Boolean) en : Boolean.parseBoolean(String.valueOf(en)));
        dto.setCaptureIntervalSec(toInt(r.get("captureIntervalSec")));
        dto.setRetentionSec(toInt(r.get("retentionSec")));
        dto.setLastCapturedAt(r.get("lastCapturedAt") != null ? r.get("lastCapturedAt").toString() : null);
        dto.setCreatedAt(r.get("createdAt") != null ? r.get("createdAt").toString() : null);
        return dto;
    }

    private MonitoringSnapshotDTO rowToSnapshot(Map<String, Object> r) {
        MonitoringSnapshotDTO dto = new MonitoringSnapshotDTO();
        dto.setSnapshotId((String)    r.get("snapshotId"));
        dto.setProjectId((String)     r.get("projectId"));
        dto.setScheduleId((String)    r.get("scheduleId"));
        dto.setMode((String)          r.get("mode"));
        dto.setCameraId((String)      r.get("cameraId"));
        dto.setCameraName((String)    r.get("cameraName"));
        Object ip = r.get("isProblem");
        dto.setProblem(ip instanceof Boolean ? (Boolean) ip : Boolean.parseBoolean(String.valueOf(ip)));
        dto.setDetectionJson((String) r.get("detectionJson"));
        dto.setCapturedAt(r.get("capturedAt") != null ? r.get("capturedAt").toString() : null);
        dto.setExpiresAt(r.get("expiresAt")   != null ? r.get("expiresAt").toString()  : null);
        return dto;
    }

    private int toInt(Object v) {
        if (v == null) return 0;
        if (v instanceof Number) return ((Number) v).intValue();
        return Integer.parseInt(v.toString());
    }
}
