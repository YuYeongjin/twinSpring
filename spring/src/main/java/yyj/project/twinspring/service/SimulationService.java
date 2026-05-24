package yyj.project.twinspring.service;

import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.SimulationDTO;
import yyj.project.twinspring.dto.SimulationProjectDTO;

import java.util.List;

public interface SimulationService {
    Mono<SimulationDTO> getExcavatorState(String excavatorId);
    Mono<SimulationDTO> updateExcavatorState(SimulationDTO state);
    Mono<SimulationDTO> resetExcavatorState(String excavatorId);

    // ── 프로젝트 CRUD ──────────────────────────────────────────────
    List<SimulationProjectDTO> getSimulationProjects();
    SimulationProjectDTO createSimulationProject(String projectName);
    void renameSimulationProject(String projectId, String newName);
    void deleteSimulationProject(String projectId);
}
