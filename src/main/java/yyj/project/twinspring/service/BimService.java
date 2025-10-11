package yyj.project.twinspring.service;


import reactor.core.publisher.Mono;

public interface BimService {

    Mono<String> getModelData(String projectId);
}
