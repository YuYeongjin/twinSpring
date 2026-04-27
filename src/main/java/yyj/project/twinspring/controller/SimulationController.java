package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.SimulationDTO;
import yyj.project.twinspring.service.SimulationService;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {

    private final SimulationService simulationService;

    public SimulationController(SimulationService simulationService) {
        this.simulationService = simulationService;
    }

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
}
