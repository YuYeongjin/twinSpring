package yyj.project.twinspring.config;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class PythonManager {

    private Process pythonProcess;

    @PostConstruct
    public void startPythonServer() {
        try {
            ProcessBuilder pb = new ProcessBuilder("python", "detector_test.py");
            pb.directory(new java.io.File("src\\main\\java\\yyj\\project\\twinspring\\util"));
            pb.redirectErrorStream(true);
            pythonProcess = pb.start();

            System.out.println("@@@ Python 서버 실행됨.");

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    @PreDestroy
    public void stopPythonServer() {
        if (pythonProcess != null && pythonProcess.isAlive()) {
            pythonProcess.destroy();
            System.out.println("@@@ Python 서버 종료됨.");
        }
    }
}
