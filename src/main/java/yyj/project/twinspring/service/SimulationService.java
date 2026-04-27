package yyj.project.twinspring.service;

import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.SimulationDTO;

public interface SimulationService {
    Mono<SimulationDTO> getExcavatorState(String excavatorId);
    Mono<SimulationDTO> updateExcavatorState(SimulationDTO state);
    Mono<SimulationDTO> resetExcavatorState(String excavatorId);
}
