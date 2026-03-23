package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dao.BimDAO;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimProjectDTO;
import yyj.project.twinspring.service.BimService;

import java.util.List;
import java.util.UUID;

@Service
public class BimServiceImpl implements BimService {

    private static final Logger log = LoggerFactory.getLogger(BimServiceImpl.class);

    private final WebClient webClient;
    private final BimDAO bimDAO;

    public BimServiceImpl(WebClient webClient, BimDAO bimDAO) {
        this.webClient = webClient;
        this.bimDAO = bimDAO;
    }

    @Override
    public Mono<String> getModelData(String projectId) {
        log.debug("C# 서버 모델 요청: projectId={}", projectId);
        return webClient.get()
                .uri("/api/bim/model/{projectId}", projectId)
                .retrieve()
                .bodyToMono(String.class)
                .doOnError(e -> log.error("C# 서버 통신 오류: {}", e.getMessage()));
    }

    @Override
    public Mono<List<BimProjectDTO>> getProjectList() {
        log.debug("C# 서버 프로젝트 목록 요청");
        return webClient.get()
                .uri("/api/bim/projects")
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse ->
                        Mono.error(new RuntimeException("C# Server Error: " + clientResponse.statusCode())))
                .bodyToFlux(BimProjectDTO.class)
                .collectList();
    }

    @Override
    public ResponseEntity<Mono<List<BimElementDTO>>> getModelElements(String projectId) {
        log.debug("getModelElements: projectId={}", projectId);
        return ResponseEntity.ok(
                webClient.get()
                        .uri("/api/bim/projects")
                        .retrieve()
                        .bodyToFlux(BimElementDTO.class)
                        .collectList());
    }

    @Override
    public ResponseEntity<Mono<Void>> deleteProject(String projectId) {
        return ResponseEntity.ok(
                webClient.delete()
                        .uri("/api/bim/project/{projectId}", projectId)
                        .retrieve()
                        .bodyToMono(Void.class));
    }

    @Override
    public ResponseEntity<Mono<Void>> updateElement(BimElementDTO element) {
        log.debug("Element 수정 요청: {}", element);
        return ResponseEntity.ok(
                webClient.post()
                        .uri("/api/bim/element")
                        .bodyValue(element)
                        .retrieve()
                        .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(), clientResponse -> {
                            log.error("C# Element 업데이트 실패: {}", clientResponse.statusCode());
                            return Mono.error(new RuntimeException("C# Element update failed: " + clientResponse.statusCode()));
                        })
                        .bodyToMono(Void.class));
    }

    @Override
    public Mono<ResponseEntity<Void>> newProject(String category) {
        // TODO: 카테고리별 프로젝트 생성 로직 구현 필요
        throw new UnsupportedOperationException("newProject(category) is not yet implemented");
    }

    @Override
    public Mono<BimProjectDTO> createProject(BimProjectDTO project) {
        String projectId = "P-" + UUID.randomUUID().toString().substring(0, 5);
        project.setProjectId(projectId);
        log.info("프로젝트 생성 요청: {}", project);

        return webClient.post()
                .uri("/api/bim/project")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(project)
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse -> {
                    log.error("C# 프로젝트 생성 실패: {}", clientResponse.statusCode());
                    return Mono.error(new RuntimeException("C# Project creation failed."));
                })
                .bodyToMono(BimProjectDTO.class);
    }

    @Override
    public ResponseEntity<Mono<List<BimElementDTO>>> getProject(String projectId) {
        log.debug("프로젝트 요소 조회: projectId={}", projectId);
        ParameterizedTypeReference<List<BimElementDTO>> typeRef = new ParameterizedTypeReference<>() {};
        Mono<List<BimElementDTO>> responseBodyMono = webClient.get()
                .uri("/api/bim/project/{projectId}", projectId)
                .retrieve()
                .bodyToMono(typeRef);
        return ResponseEntity.ok(responseBodyMono);
    }


}