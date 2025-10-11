package yyj.project.twinspring.serviceImpl;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.service.BimService;

@Service
public class BimServiceImpl implements BimService {

    @Value("bim.server.url")
    private static String CSHARP_BASE_URL;

    private final WebClient webClient;

    public BimServiceImpl(WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder.baseUrl(CSHARP_BASE_URL).build();
    }

    @Override
    public Mono<String> getModelData(String projectId) {

        // C# 서버 /api/bim/model 호출
        return webClient.get()
                .uri("/api/bim/model/{projectId}", projectId)
                .retrieve()
                .bodyToMono(String.class)
                .doOnError(e -> System.err.println("C# 서버 통신 오류: " + e.getMessage()));
    }
}