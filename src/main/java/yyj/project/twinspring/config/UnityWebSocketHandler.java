//package yyj.project.twinspring.config;
//
//
//import org.springframework.stereotype.Component;
//import org.springframework.web.socket.*;
//import org.springframework.web.socket.handler.TextWebSocketHandler;
//
//import java.util.Set;
//import java.util.concurrent.CopyOnWriteArraySet;
//
//@Component
//public class UnityWebSocketHandler extends TextWebSocketHandler {
//
//    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
//
//    @Override
//    public void afterConnectionEstablished(WebSocketSession session) {
//        sessions.add(session);
//        System.out.println("✅ Unity 연결됨: " + session.getId());
//    }
//
//    @Override
//    public void handleTextMessage(WebSocketSession session, TextMessage message) {
//        System.out.println("📨 Unity → Spring: " + message.getPayload());
//    }
//
//    @Override
//    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
//        sessions.remove(session);
//        System.out.println("🔌 연결 해제됨: " + session.getId());
//    }
//
//    public void broadcast(String payload) {
//        for (WebSocketSession session : sessions) {
//            try {
//                session.sendMessage(new TextMessage(payload));
//            } catch (Exception e) {
//                e.printStackTrace();
//            }
//        }
//    }
//}