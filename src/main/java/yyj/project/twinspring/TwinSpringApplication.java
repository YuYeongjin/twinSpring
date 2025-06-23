package yyj.project.twinspring;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@MapperScan("yyj.project.twinspring.dao")
@SpringBootApplication
public class TwinSpringApplication {

    public static void main(String[] args) {
        SpringApplication.run(TwinSpringApplication.class, args);
    }

}
