package yyj.project.twinspring.config;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class IntegratedServiceRunner implements CommandLineRunner {

    @Override
    public void run(String... args) {
        // bim-api, sensor 는 docker-compose 에서 별도 컨테이너로 관리됨
    }
}
