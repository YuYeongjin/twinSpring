package yyj.project.twinspring.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.SimulationDTO;
import yyj.project.twinspring.dto.SimulationProjectDTO;
import yyj.project.twinspring.service.SimulationService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {

    private final SimulationService simulationService;

    public SimulationController(SimulationService simulationService) {
        this.simulationService = simulationService;
    }

    // ── 굴착기 상태 ────────────────────────────────────────────────

    @GetMapping("/excavator")
    public Mono<ResponseEntity<SimulationDTO>> getState(
            @RequestParam(defaultValue = "EX-001") String excavatorId) {
        return simulationService.getExcavatorState(excavatorId)
            .map(ResponseEntity::ok);
    }

    @PutMapping("/excavator")
    public Mono<ResponseEntity<SimulationDTO>> updateState(@RequestBody SimulationDTO state) {
        return simulationService.updateExcavatorState(state)
            .map(ResponseEntity::ok);
    }

    @PostMapping("/excavator/reset")
    public Mono<ResponseEntity<SimulationDTO>> reset(
            @RequestParam(defaultValue = "EX-001") String excavatorId) {
        return simulationService.resetExcavatorState(excavatorId)
            .map(ResponseEntity::ok);
    }

    // ── 시뮬레이션 프로젝트 CRUD ───────────────────────────────────

    @GetMapping("/projects")
    public ResponseEntity<List<SimulationProjectDTO>> getProjects() {
        return ResponseEntity.ok(simulationService.getSimulationProjects());
    }

    @PostMapping("/project")
    public ResponseEntity<SimulationProjectDTO> createProject(@RequestBody Map<String, String> body) {
        String projectName = body.get("projectName");
        if (projectName == null || projectName.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        SimulationProjectDTO created = simulationService.createSimulationProject(projectName.trim());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/project/{projectId}/name")
    public ResponseEntity<Void> renameProject(
            @PathVariable String projectId,
            @RequestBody Map<String, String> body) {
        String newName = body.get("projectName");
        if (newName == null || newName.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        simulationService.renameSimulationProject(projectId, newName.trim());
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/project/{projectId}")
    public ResponseEntity<Void> deleteProject(@PathVariable String projectId) {
        simulationService.deleteSimulationProject(projectId);
        return ResponseEntity.noContent().build();
    }
}
