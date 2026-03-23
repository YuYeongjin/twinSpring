package yyj.project.twinspring.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.io.File;
import java.nio.file.Paths;
@Component
public class IntegratedServiceRunner implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(IntegratedServiceRunner.class);

    @Override
    public void run(String... args) throws Exception {
        // 도커 내부 경로로 수정 (/app 기준)
        String os = System.getProperty("os.name").toLowerCase();

        // 1. C# BIM API 실행
        // 도커 환경(/app/bim-api)과 로컬 환경(target/classes/bim-api)을 모두 고려
        String bimPath = findExecutablePath("bim-api/twinBim");
        if (bimPath != null) {
            startProcess(new String[]{bimPath}, "C# BIM API");
        }

        // 2. Python 센서 실행
        String pythonScript = findExecutablePath("resources/sensor.py");
        if (pythonScript != null) {
            // 도커 내부에서는 python3가 기본입니다.
            String pythonCmd = "python";
            startProcess(new String[]{pythonCmd, pythonScript}, "Python Sensor");
        }
    }

    private String findExecutablePath(String subPath) {
        // 1순위: /app/ 하위 (도커)
        File dockerPath = new File("/app/" + subPath);
        if (dockerPath.exists()) return dockerPath.getAbsolutePath();

        // 2순위: target/classes/ 하위 (로컬 개발)
        File localPath = new File("target/classes/" + subPath);
        if (localPath.exists()) return localPath.getAbsolutePath();

        log.error("파일을 찾을 수 없습니다: {}", subPath);
        return null;
    }

    private void startProcess(String[] command, String serviceName) {
        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.inheritIO();
            pb.start();
            log.info(">>>> {} 시작 성공", serviceName);
        } catch (Exception e) {
            log.error(">>>> {} 시작 실패: {}", serviceName, e.getMessage());
        }
    }
}