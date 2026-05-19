package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dao.SimulationDAO;
import yyj.project.twinspring.dto.SimulationDTO;
import yyj.project.twinspring.dto.SimulationProjectDTO;
import yyj.project.twinspring.service.SimulationService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SimulationServiceImpl implements SimulationService {

    private static final Logger log = LoggerFactory.getLogger(SimulationServiceImpl.class);

    private final WebClient webClient;
    private final SimulationDAO simulationDAO;

    public SimulationServiceImpl(@Qualifier("webClient") WebClient webClient, SimulationDAO simulationDAO) {
        this.webClient = webClient;
        this.simulationDAO = simulationDAO;
    }

    // ── 굴착기 상태 (MariaDB 우선, C# 서버 보조) ─────────────────

    @Override
    public Mono<SimulationDTO> getExcavatorState(String excavatorId) {
        // MariaDB에서 먼저 로드 (지형 데이터 포함)
        Map<String, Object> row = simulationDAO.getSimulationState(excavatorId);
        if (row != null) {
            return Mono.just(rowToDTO(row));
        }
        // DB에 없으면 C# 서버 시도 후 기본값 반환
        return webClient.get()
            .uri("/api/simulation/excavator/" + excavatorId)
            .retrieve()
            .bodyToMono(SimulationDTO.class)
            .doOnError(e -> log.warn("굴착기 상태 조회 실패: {}", e.getMessage()))
            .onErrorResume(e -> Mono.just(defaultState(excavatorId)));
    }

    @Override
    public Mono<SimulationDTO> updateExcavatorState(SimulationDTO state) {
        // MariaDB에 저장 (지형 + 장비 선택 포함)
        simulationDAO.upsertSimulationState(dtoToRow(state));
        // C# 서버에도 전달 시도 (실패해도 무시)
        return webClient.put()
            .uri("/api/simulation/excavator")
            .bodyValue(state)
            .retrieve()
            .bodyToMono(SimulationDTO.class)
            .doOnError(e -> log.warn("굴착기 상태 C# 저장 실패: {}", e.getMessage()))
            .onErrorResume(e -> Mono.just(state));
    }

    @Override
    public Mono<SimulationDTO> resetExcavatorState(String excavatorId) {
        SimulationDTO def = defaultState(excavatorId);
        simulationDAO.upsertSimulationState(dtoToRow(def));
        return webClient.post()
            .uri(uriBuilder -> uriBuilder
                .path("/api/simulation/excavator/reset")
                .queryParam("excavatorId", excavatorId)
                .build())
            .retrieve()
            .bodyToMono(SimulationDTO.class)
            .onErrorResume(e -> Mono.just(def));
    }

    private SimulationDTO defaultState(String excavatorId) {
        SimulationDTO dto = new SimulationDTO();
        dto.setExcavatorId(excavatorId);
        dto.setBoomAngle(35.0);
        dto.setArmAngle(60.0);
        dto.setBucketAngle(-25.0);
        dto.setOperationMode("IDLE");
        dto.setSoilInBucket(0.0);
        dto.setSelectedMachineId("0.6W");
        return dto;
    }

    private SimulationDTO rowToDTO(Map<String, Object> row) {
        SimulationDTO dto = new SimulationDTO();
        dto.setExcavatorId((String) row.get("excavatorId"));
        dto.setPositionX(toDouble(row.get("positionX")));
        dto.setPositionY(toDouble(row.get("positionY")));
        dto.setPositionZ(toDouble(row.get("positionZ")));
        dto.setBodyRotation(toDouble(row.get("bodyRotation")));
        dto.setSwingAngle(toDouble(row.get("swingAngle")));
        dto.setBoomAngle(toDouble(row.get("boomAngle"), 35.0));
        dto.setArmAngle(toDouble(row.get("armAngle"), 60.0));
        dto.setBucketAngle(toDouble(row.get("bucketAngle"), -25.0));
        dto.setOperationMode(row.get("operationMode") != null ? (String) row.get("operationMode") : "IDLE");
        dto.setSoilInBucket(toDouble(row.get("soilInBucket")));
        dto.setSelectedMachineId(row.get("selectedMachineId") != null ? (String) row.get("selectedMachineId") : "0.6W");
        dto.setHeightMapData((String) row.get("heightMapData"));
        return dto;
    }

    private Map<String, Object> dtoToRow(SimulationDTO dto) {
        Map<String, Object> m = new HashMap<>();
        m.put("excavatorId",      dto.getExcavatorId() != null ? dto.getExcavatorId() : "EX-001");
        m.put("positionX",        dto.getPositionX());
        m.put("positionY",        dto.getPositionY());
        m.put("positionZ",        dto.getPositionZ());
        m.put("bodyRotation",     dto.getBodyRotation());
        m.put("swingAngle",       dto.getSwingAngle());
        m.put("boomAngle",        dto.getBoomAngle());
        m.put("armAngle",         dto.getArmAngle());
        m.put("bucketAngle",      dto.getBucketAngle());
        m.put("operationMode",    dto.getOperationMode() != null ? dto.getOperationMode() : "IDLE");
        m.put("soilInBucket",     dto.getSoilInBucket() != null ? dto.getSoilInBucket() : 0.0);
        m.put("selectedMachineId",dto.getSelectedMachineId() != null ? dto.getSelectedMachineId() : "0.6W");
        m.put("heightMapData",    dto.getHeightMapData());
        return m;
    }

    private double toDouble(Object v) { return toDouble(v, 0.0); }
    private double toDouble(Object v, double def) {
        if (v == null) return def;
        if (v instanceof Number) return ((Number) v).doubleValue();
        try { return Double.parseDouble(v.toString()); } catch (Exception e) { return def; }
    }

    // ── 프로젝트 CRUD (로컬 MariaDB) ──────────────────────────────

    @Override
    public List<SimulationProjectDTO> getSimulationProjects() {
        return simulationDAO.getAllSimulationProjects().stream()
            .map(row -> new SimulationProjectDTO(
                (String) row.get("projectId"),
                (String) row.get("projectName")))
            .collect(Collectors.toList());
    }

    @Override
    public SimulationProjectDTO createSimulationProject(String projectName) {
        String projectId = UUID.randomUUID().toString();
        Map<String, Object> params = new HashMap<>();
        params.put("projectId", projectId);
        params.put("projectName", projectName);
        simulationDAO.insertSimulationProject(params);
        return new SimulationProjectDTO(projectId, projectName);
    }

    @Override
    public void renameSimulationProject(String projectId, String newName) {
        Map<String, Object> params = new HashMap<>();
        params.put("projectId", projectId);
        params.put("projectName", newName);
        simulationDAO.updateSimulationProjectName(params);
    }

    @Override
    public void deleteSimulationProject(String projectId) {
        simulationDAO.deleteSimulationProject(projectId);
    }
}
