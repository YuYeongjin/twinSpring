package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimModelDTO;
import yyj.project.twinspring.service.BimService;

@Service
public class BimServiceImpl implements BimService {

    private static final String CSHARP_BASE_URL = "http://localhost:5112";

    private final WebClient webClient;

    public BimServiceImpl(WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder.baseUrl(CSHARP_BASE_URL).build();
    }

    @Override
    public Mono<String> getModelData(String projectId) {

        // C# 서버의 /api/bim/model 엔드포인트를 호출
        return webClient.get()
                .uri("/api/bim/model/{projectId}", projectId)
                .retrieve()
                .bodyToMono(String.class) // C# 응답을 DTO로 자동 변환
                .doOnError(e -> System.err.println("C# 서버 통신 오류: " + e.getMessage()));
    }
}