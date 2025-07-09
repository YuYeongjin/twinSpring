package yyj.project.twinspring.config;

import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.concurrent.CompletionStage;

@Component
public class UnityWsPusher  implements WebSocket.Listener{
    private WebSocket webSocket;

    @PostConstruct
    public void init() {
        // 1) HttpClient 생성
        HttpClient client = HttpClient.newHttpClient();

        // 2) WebSocket 빌더로 연결 시도
        client.newWebSocketBuilder()
                .buildAsync(URI.create("ws://localhost:8081/ws/unity"), this)
                .thenAccept(ws -> {
                    this.webSocket = ws;
                    System.out.println("🌐 Java WS Client: Unity WS 연결 성공");
                })
                .exceptionally(err -> {
                    err.printStackTrace();
                    return null;
                });
    }

    /** Spring에서 호출할 전송 메서드 */
    public void send(String payload) {
        if (webSocket != null) {
            webSocket.sendText(payload, true);
        } else {
            System.err.println("WebSocket 연결이 아직 열리지 않았습니다.");
        }
    }

    // ----------------------------
    // WebSocket.Listener 구현
    // ----------------------------
    @Override
    public void onOpen(WebSocket webSocket) {
        webSocket.request(1);
    }

    @Override
    public CompletionStage<?> onText(WebSocket webSocket,
                                     CharSequence data,
                                     boolean last) {
        System.out.println("메시지 수신: " + data);
        webSocket.request(1);
        return null;
    }
}
