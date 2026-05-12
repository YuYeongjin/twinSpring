package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import yyj.project.twinspring.service.AlertService;

@Service
public class AlertServiceImpl implements AlertService {

    private static final Logger log = LoggerFactory.getLogger(AlertServiceImpl.class);

    private final WebClient raspiClient;

    public AlertServiceImpl(
            WebClient.Builder builder,
            @Value("${raspi.alert.url:http://192.168.0.100:5000}") String raspiUrl
    ) {
        this.raspiClient = builder.baseUrl(raspiUrl).build();
        log.info("Raspberry Pi Alert URL: {}", raspiUrl);
    }

    @Override
    public void ledOn() {
        raspiClient.post()
                .uri("/led/on")
                .retrieve()
                .bodyToMono(String.class)
                .subscribe(
                        res -> log.info("[Alert] LED ON: {}", res),
                        err -> log.warn("[Alert] LED ON 실패 (라즈베리파이 미연결?): {}", err.getMessage())
                );
    }

    @Override
    public void ledOff() {
        raspiClient.post()
                .uri("/led/off")
                .retrieve()
                .bodyToMono(String.class)
                .subscribe(
                        res -> log.info("[Alert] LED OFF: {}", res),
                        err -> log.warn("[Alert] LED OFF 실패: {}", err.getMessage())
                );
    }

    @Override
    public String ledStatus() {
        try {
            return raspiClient.get()
                    .uri("/led/status")
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
        } catch (Exception e) {
            log.warn("[Alert] LED 상태 조회 실패: {}", e.getMessage());
            return "{\"led\":\"unknown\"}";
        }
    }
}
