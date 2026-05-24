package yyj.project.twinspring.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.SimulationDTO;
import yyj.project.twinspring.dto.SimulationProjectDTO;
import yyj.project.twinspring.service.SimulationService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {

    private static final Logger log = LoggerFactory.getLogger(SimulationController.class);

    private final SimulationService simulationService;
    private final WebClient webClient;

    public SimulationController(SimulationService simulationService, WebClient webClient) {
        this.simulationService = simulationService;
        this.webClient = webClient;
    }

    // ── C# 물리 평가 프록시 ────────────────────────────────────────

    @PostMapping("/physics/evaluate")
    public Mono<ResponseEntity<Map<String, Object>>> evaluatePhysics(@RequestBody Map<String, Object> body) {
        return webClient.post()
                .uri("/api/simulation/physics/evaluate")
                .bodyValue(body)
                .retrieve()
                .toEntity(new ParameterizedTypeReference<Map<String, Object>>() {})
                .onErrorResume(e -> {
                    // C# BIM 서버 미응답 시 로그 남기고 안전 기본값 반환 (503 대신 200)
                    log.warn("[Physics] twinBIM 서버 미응답: {}", e.getMessage());
                    Map<String, Object> safeResult = new HashMap<>();
                    safeResult.put("dangerLevel", "SAFE");
                    safeResult.put("wobbleAmplitude", 0.0);
                    safeResult.put("wobbleFrequency", 2.5);
                    safeResult.put("tipDirectionX", 0.0);
                    safeResult.put("tipDirectionZ", 1.0);
                    safeResult.put("isStable", true);
                    safeResult.put("tipAngle", 0.0);
                    safeResult.put("groundPressure", 0.0);
                    safeResult.put("message", "Physics server unavailable – using safe defaults");
                    safeResult.put("serverAvailable", false);
                    return Mono.just(ResponseEntity.ok(safeResult));
                });
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
