package yyj.project.twinspring.controller;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.MonitoringCameraDTO;
import yyj.project.twinspring.dto.MonitoringScheduleDTO;
import yyj.project.twinspring.dto.MonitoringSnapshotDTO;
import yyj.project.twinspring.service.MonitoringService;

import java.util.List;

/**
 * 모니터링 상시 촬영 REST API
 *
 * 카메라 관리
 *   GET    /api/monitoring/cameras/{projectId}        — 카메라 목록
 *   POST   /api/monitoring/cameras/{projectId}        — 카메라 추가
 *   PUT    /api/monitoring/camera/{cameraId}          — 카메라 수정
 *   DELETE /api/monitoring/camera/{cameraId}          — 카메라 삭제
 *
 * 스케줄
 *   GET    /api/monitoring/schedule/{projectId}       — 스케줄 조회
 *   PUT    /api/monitoring/schedule/{projectId}       — 스케줄 저장
 *
 * 스냅샷
 *   GET    /api/monitoring/snapshots/{projectId}      — 스냅샷 목록
 *   GET    /api/monitoring/snapshot/{id}/image        — 이미지 bytes
 *   DELETE /api/monitoring/snapshot/{id}              — 스냅샷 삭제
 */
@RestController
@RequestMapping("/api/monitoring")
public class MonitoringController {

    private final MonitoringService monitoringService;

    public MonitoringController(MonitoringService monitoringService) {
        this.monitoringService = monitoringService;
    }

    // ── 카메라 ───────────────────────────────────────────────────────

    @GetMapping("/cameras/{projectId}")
    public ResponseEntity<List<MonitoringCameraDTO>> getCameras(@PathVariable String projectId) {
        return ResponseEntity.ok(monitoringService.getCamerasByProject(projectId));
    }

    @PostMapping("/cameras/{projectId}")
    public ResponseEntity<MonitoringCameraDTO> addCamera(
            @PathVariable String projectId,
            @RequestBody MonitoringCameraDTO dto) {
        if (dto.getCameraUrl() == null || dto.getCameraUrl().isBlank())
            return ResponseEntity.badRequest().build();
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(monitoringService.addCamera(projectId, dto));
    }

    @PutMapping("/camera/{cameraId}")
    public ResponseEntity<MonitoringCameraDTO> updateCamera(
            @PathVariable String cameraId,
            @RequestBody MonitoringCameraDTO dto) {
        return ResponseEntity.ok(monitoringService.updateCamera(cameraId, dto));
    }

    @DeleteMapping("/camera/{cameraId}")
    public ResponseEntity<Void> deleteCamera(@PathVariable String cameraId) {
        monitoringService.deleteCamera(cameraId);
        return ResponseEntity.noContent().build();
    }

    // ── 스케줄 ───────────────────────────────────────────────────────

    @GetMapping("/schedule/{projectId}")
    public ResponseEntity<MonitoringScheduleDTO> getSchedule(@PathVariable String projectId) {
        MonitoringScheduleDTO dto = monitoringService.getScheduleByProject(projectId);
        return dto != null ? ResponseEntity.ok(dto) : ResponseEntity.notFound().build();
    }

    @PutMapping("/schedule/{projectId}")
    public ResponseEntity<MonitoringScheduleDTO> upsertSchedule(
            @PathVariable String projectId,
            @RequestBody MonitoringScheduleDTO dto) {
        return ResponseEntity.ok(monitoringService.upsertSchedule(projectId, dto));
    }

    // ── 스냅샷 ───────────────────────────────────────────────────────

    @GetMapping("/snapshots/{projectId}")
    public ResponseEntity<List<MonitoringSnapshotDTO>> getSnapshots(@PathVariable String projectId) {
        return ResponseEntity.ok(monitoringService.getSnapshotsByProject(projectId));
    }

    @GetMapping("/snapshot/{snapshotId}/image")
    public ResponseEntity<byte[]> getSnapshotImage(@PathVariable String snapshotId) {
        byte[] data = monitoringService.getSnapshotImage(snapshotId);
        if (data == null || data.length == 0) return ResponseEntity.notFound().build();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.IMAGE_JPEG);
        return new ResponseEntity<>(data, headers, HttpStatus.OK);
    }

    @DeleteMapping("/snapshot/{snapshotId}")
    public ResponseEntity<Void> deleteSnapshot(@PathVariable String snapshotId) {
        monitoringService.deleteSnapshot(snapshotId);
        return ResponseEntity.noContent().build();
    }
}
