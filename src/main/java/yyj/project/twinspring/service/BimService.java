package yyj.project.twinspring.service;


import io.micrometer.observation.ObservationFilter;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimModelDTO;

public interface BimService {

    Mono<String> getModelData(String projectId);
}
