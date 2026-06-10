package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dao.SiteCameraDAO;
import yyj.project.twinspring.dto.SiteCameraDTO;
import yyj.project.twinspring.service.IntegrationService;

import java.util.*;

@RestController
@RequestMapping("/api/integration")
public class SiteCameraController {

    private final SiteCameraDAO        cameraDAO;
    private final IntegrationService   integrationService;
    private final SimpMessagingTemplate ws;

    public SiteCameraController(SiteCameraDAO cameraDAO,
                                IntegrationService integrationService,
                                SimpMessagingTemplate ws) {
        this.cameraDAO          = cameraDAO;
        this.integrationService = integrationService;
        this.ws                 = ws;
    }

    // ── 현장 원점 설정 ────────────────────────────────────────────────

    @PutMapping("/project/{projectId}/site-origin")
    public ResponseEntity<Void> updateSiteOrigin(
            @PathVariable String projectId,
            @RequestBody Map<String, Double> body) {
        Double refLat = body.get("refLat");
        Double refLng = body.get("refLng");
        if (refLat == null || refLng == null) return ResponseEntity.badRequest().build();
        integrationService.updateSiteOrigin(projectId, refLat, refLng);
        return ResponseEntity.ok().build();
    }

    // ── 카메라 CRUD ───────────────────────────────────────────────────

    @GetMapping("/project/{projectId}/cameras")
    public ResponseEntity<List<SiteCameraDTO>> getCameras(@PathVariable String projectId) {
        List<Map<String, Object>> rows = cameraDAO.getCamerasByProject(projectId);
        List<SiteCameraDTO> result = new ArrayList<>();
        for (Map<String, Object> row : rows) result.add(rowToDTO(row));
        return ResponseEntity.ok(result);
    }

    @PostMapping("/project/{projectId}/cameras")
    public ResponseEntity<SiteCameraDTO> addCamera(
            @PathVariable String projectId,
            @RequestBody SiteCameraDTO dto) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> params = dtoToRow(id, projectId, dto);
        cameraDAO.insertCamera(params);
        SiteCameraDTO created = rowToDTO(cameraDAO.getCameraById(id));
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/project/{projectId}/cameras/{cameraId}")
    public ResponseEntity<SiteCameraDTO> updateCamera(
            @PathVariable String projectId,
            @PathVariable String cameraId,
            @RequestBody SiteCameraDTO dto) {
        Map<String, Object> params = dtoToRow(cameraId, projectId, dto);
        cameraDAO.updateCamera(params);
        return ResponseEntity.ok(rowToDTO(cameraDAO.getCameraById(cameraId)));
    }

    @DeleteMapping("/project/{projectId}/cameras/{cameraId}")
    public ResponseEntity<Void> deleteCamera(
            @PathVariable String projectId,
            @PathVariable String cameraId) {
        cameraDAO.deleteCamera(cameraId);
        return ResponseEntity.noContent().build();
    }

    // ── CV 서버 → detection 수신 → WebSocket 브로드캐스트 ─────────────
    // CV 서버가 픽셀 → 물리 좌표 변환을 완료한 결과를 전송
    // 프론트 CameraLoader가 /topic/camera/{cameraId} 구독
    @PostMapping("/camera/{cameraId}/detection")
    public ResponseEntity<Void> receiveDetection(
            @PathVariable String cameraId,
            @RequestBody Map<String, Object> payload) {
        payload.put("cameraId", cameraId);
        ws.convertAndSend("/topic/camera/" + cameraId, payload);
        return ResponseEntity.ok().build();
    }

    // ── helpers ───────────────────────────────────────────────────────

    private SiteCameraDTO rowToDTO(Map<String, Object> row) {
        if (row == null) return null;
        SiteCameraDTO dto = new SiteCameraDTO();
        dto.setCameraId((String)  row.get("cameraId"));
        dto.setProjectId((String) row.get("projectId"));
        dto.setName((String)      row.get("name"));
        dto.setUrl((String)       row.get("url"));
        dto.setWorldX(toDouble(row.get("worldX")));
        dto.setWorldY(toDouble(row.get("worldY")));
        dto.setWorldZ(toDouble(row.get("worldZ")));
        dto.setYaw(toDouble(row.get("yaw")));
        dto.setFovH(toDouble(row.get("fovH")));
        dto.setActive(row.get("active") instanceof Boolean b ? b : Boolean.TRUE);
        dto.setCreatedAt(row.get("createdAt") != null ? row.get("createdAt").toString() : null);
        return dto;
    }

    private Map<String, Object> dtoToRow(String id, String projectId, SiteCameraDTO dto) {
        Map<String, Object> m = new HashMap<>();
        m.put("cameraId",  id);
        m.put("projectId", projectId);
        m.put("name",      dto.getName());
        m.put("url",       dto.getUrl());
        m.put("worldX",    dto.getWorldX()  != null ? dto.getWorldX()  : 0.0);
        m.put("worldY",    dto.getWorldY()  != null ? dto.getWorldY()  : 0.0);
        m.put("worldZ",    dto.getWorldZ()  != null ? dto.getWorldZ()  : 0.0);
        m.put("yaw",       dto.getYaw()     != null ? dto.getYaw()     : 0.0);
        m.put("fovH",      dto.getFovH()    != null ? dto.getFovH()    : 90.0);
        m.put("active",    dto.getActive()  != null ? dto.getActive()  : true);
        return m;
    }

    private Double toDouble(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).doubleValue();
        try { return Double.parseDouble(v.toString()); } catch (Exception e) { return null; }
    }
}
