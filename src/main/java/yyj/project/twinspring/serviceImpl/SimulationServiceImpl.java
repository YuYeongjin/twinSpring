package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.SimulationDTO;
import yyj.project.twinspring.service.SimulationService;

@Service
public class SimulationServiceImpl implements SimulationService {

    private static final Logger log = LoggerFactory.getLogger(SimulationServiceImpl.class);

    private final WebClient webClient;

    public SimulationServiceImpl(WebClient webClient) {
        this.webClient = webClient;
    }

    @Override
    public Mono<SimulationDTO> getExcavatorState(String excavatorId) {
        return webClient.get()
            .uri("/api/simulation/excavator/" + excavatorId)
            .retrieve()
            .bodyToMono(SimulationDTO.class)
            .doOnError(e -> log.warn("굴착기 상태 조회 실패: {}", e.getMessage()))
            .onErrorResume(e -> Mono.just(defaultState(excavatorId)));
    }

    @Override
    public Mono<SimulationDTO> updateExcavatorState(SimulationDTO state) {
        return webClient.put()
            .uri("/api/simulation/excavator")
            .bodyValue(state)
            .retrieve()
            .bodyToMono(SimulationDTO.class)
            .doOnError(e -> log.warn("굴착기 상태 저장 실패: {}", e.getMessage()))
            .onErrorResume(e -> Mono.just(state));
    }

    @Override
    public Mono<SimulationDTO> resetExcavatorState(String excavatorId) {
        return webClient.post()
            .uri(uriBuilder -> uriBuilder
                .path("/api/simulation/excavator/reset")
                .queryParam("excavatorId", excavatorId)
                .build())
            .retrieve()
            .bodyToMono(SimulationDTO.class)
            .onErrorResume(e -> Mono.just(defaultState(excavatorId)));
    }

    private SimulationDTO defaultState(String excavatorId) {
        SimulationDTO dto = new SimulationDTO();
        dto.setExcavatorId(excavatorId);
        dto.setBoomAngle(35.0);
        dto.setArmAngle(60.0);
        dto.setBucketAngle(-20.0);
        dto.setOperationMode("IDLE");
        return dto;
    }
}
