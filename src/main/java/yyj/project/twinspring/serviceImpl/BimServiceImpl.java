package yyj.project.twinspring.serviceImpl;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimProjectDTO;
import yyj.project.twinspring.service.BimService;

import java.util.List;

@Service
public class BimServiceImpl implements BimService {


    private final WebClient webClient;

    public BimServiceImpl(WebClient webClient) {
        this.webClient = webClient;
    }

    @Override
    public Mono<String> getModelData(String projectId) {
        String url = "/api/bim/model/" + projectId;

        System.out.println(" URL :: "+url);
        // C# 서버 /api/bim/model 호출
        return webClient.get()
                .uri("/api/bim/model/{projectId}", projectId)
                .retrieve()
                .bodyToMono(String.class)
                .doOnError(e -> System.err.println("C# 서버 통신 오류: " + e.getMessage()));
    }

    @Override
    public Mono<List<BimProjectDTO>> getProjectList() {

        System.out.println("[Spring Service] C# 서버로부터 프로젝트 목록 요청 중...");

        // RAW JSON 로그는 doOnNext로 추가하는 것이 가장 좋고, 최종적으로 DTO List를 반환
        return webClient.get()
                .uri("/api/bim/projects") // 올바른 URL 사용 가정
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse ->
                        Mono.error(new RuntimeException("C# Server Error: " + clientResponse.statusCode())))
                .bodyToFlux(BimProjectDTO.class) // DTO Flux를 받고
                .collectList(); // 최종적으로 Mono<List<BimProjectDTO>>로 변환하여 반환
    }

    @Override
    public ResponseEntity<Mono<List<BimElementDTO>>> getModelElements(String projectId) {
        System.out.println("getModelElements");
        return ResponseEntity.ok(webClient.get().uri("/api/bim/projects").retrieve().bodyToFlux(BimElementDTO.class).collectList());
    }

    @Override
    public ResponseEntity<Mono<Void>> deleteProject(String projectId) {
        return ResponseEntity.ok(webClient.delete().uri("/api/bim/project/{projectId}", projectId).retrieve().bodyToMono(Void.class));
    }

    @Override
    public ResponseEntity<Mono<Void>> updateElement(BimElementDTO element) {
        return ResponseEntity.ok(webClient.put()
                .uri("/api/bim/element")
                .bodyValue(element)
                .retrieve()
                .onStatus(status -> status.is4xxClientError() || status.is5xxServerError(), clientResponse -> {
                    // C# 서버에서 오류 발생 시 (404 Not Found 등) 예외 처리
                    System.err.println("C# Server Error: " + clientResponse.statusCode());
                    return Mono.error(new RuntimeException("C# Element update failed with status: " + clientResponse.statusCode()));
                })
                .bodyToMono(Void.class));
    }

    @Override
    public Mono<ResponseEntity<Void>> newProject(String category) {
        return null;
    }

    @Override
    public Mono<BimProjectDTO> createProject(BimProjectDTO project) {
        System.out.println("@@@ " + project.toString());
        return webClient.post()
                .uri( "/api/bim/project")
                .bodyValue(project.toString())
                .retrieve()
                .onStatus(status -> status.isError(), clientResponse -> {
                    // C# 서버에서 오류 발생 시 예외 처리
                    System.err.println("C# Server Error: " + clientResponse.statusCode());

                    return Mono.error(new RuntimeException("C# Project creation failed."));
                })
                .bodyToMono(BimProjectDTO.class);

    }


}