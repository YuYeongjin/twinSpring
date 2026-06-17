package yyj.project.twinspring.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.http.codec.json.Jackson2JsonDecoder;
import org.springframework.http.codec.json.Jackson2JsonEncoder;
import org.springframework.web.reactive.function.client.ExchangeStrategies;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;

@Configuration
public class WebClientConfig {

    @Value("${bim.server.url:http://localhost:5112}")
    private String csharpBaseUrl;

    @Value("${detect.server.url:http://localhost:5001}")
    private String detectBaseUrl;

    @Bean
    public WebClient webClient(WebClient.Builder builder, ObjectMapper objectMapper) {
        // C# BIM 서버: 연결 3초, 응답 5초 타임아웃
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3_000)
                .responseTimeout(Duration.ofSeconds(5));

        ExchangeStrategies strategies = ExchangeStrategies.builder()
                .codecs(configurer -> {
                    configurer.defaultCodecs()
                            .jackson2JsonEncoder(new Jackson2JsonEncoder(objectMapper, MediaType.APPLICATION_JSON));
                    configurer.defaultCodecs()
                            .jackson2JsonDecoder(new Jackson2JsonDecoder(objectMapper, MediaType.APPLICATION_JSON));
                })
                .build();
        return builder
                .baseUrl(csharpBaseUrl)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .exchangeStrategies(strategies)
                .build();
    }

    @Bean("detectWebClient")
    public WebClient detectWebClient(WebClient.Builder builder) {
        return builder
                .baseUrl(detectBaseUrl)
                .build();
    }

    @Value("${ollama.url:http://localhost:11434}")
    private String ollamaUrl;

    @Bean("ollamaWebClient")
    public WebClient ollamaWebClient(WebClient.Builder builder) {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5_000)
                .responseTimeout(Duration.ofSeconds(60));
        return builder
                .baseUrl(ollamaUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
    }

    @Value("${agent.server.url:http://localhost:7070}")
    private String agentBaseUrl;

    @Bean("agentWebClient")
    public WebClient agentWebClient(WebClient.Builder builder) {
        // Python IFC 변환은 대용량 파일 처리 → 응답 10분 타임아웃
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5_000)
                .responseTimeout(Duration.ofMinutes(10));

        ExchangeStrategies largeStrategies = ExchangeStrategies.builder()
                .codecs(configurer -> configurer.defaultCodecs()
                        .maxInMemorySize(512 * 1024 * 1024)) // 512MB (GLB 응답)
                .build();

        return builder
                .baseUrl(agentBaseUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .exchangeStrategies(largeStrategies)
                .build();
    }
}