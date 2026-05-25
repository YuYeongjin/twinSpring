package yyj.project.twinspring.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.servlet.config.annotation.AsyncSupportConfigurer;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }

    /**
     * SSE 스트리밍(Flux<String> 반환) 시 Spring MVC 가 사용하는 async executor 설정.
     *
     * 기본값 SimpleAsyncTaskExecutor 는 요청마다 새 스레드를 생성해 운영 부하에 부적합.
     * ThreadPoolTaskExecutor 로 교체해 스레드를 재사용하고 최대치를 제한.
     *
     *   corePoolSize  : 평시 유지 스레드 수
     *   maxPoolSize   : 최대 스레드 수 (동시 SSE 연결 상한)
     *   queueCapacity : 대기 큐 크기 (maxPool 초과 시 대기)
     *   timeout       : SSE 연결 최대 유지 시간 (LLM 응답 대기 포함 10분)
     */
    @Override
    public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(20);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("mvc-async-");
        executor.initialize();

        configurer.setTaskExecutor(executor);
        configurer.setDefaultTimeout(600_000L); // 10분 (LLM 장기 응답 대비)
    }
}