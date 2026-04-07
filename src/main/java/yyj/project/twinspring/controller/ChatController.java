package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.ChatMessageDTO;
import yyj.project.twinspring.dto.ChatRequestDTO;
import yyj.project.twinspring.dto.ChatResponseDTO;
import yyj.project.twinspring.dto.MultimodalRequestDTO;
import yyj.project.twinspring.service.ChatService;

import java.util.List;

/**
 * AI 채팅 REST API 컨트롤러
 *
 *  POST  /api/chat/message            - 메시지 전송 (Agent 호출)
 *  GET   /api/chat/history/{sessionId} - 대화 이력 조회
 *  DELETE /api/chat/history/{sessionId} - 대화 이력 초기화
 */
@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    /**
     * 사용자 메시지를 AI Agent로 전달하고 응답 반환
     *
     * Body 예시:
     * {
     *   "sessionId": "user-abc",
     *   "message": "현재 온도는?",
     *   "projectId": "proj-001",
     *   "history": [{"role": "user", "content": "..."}]
     * }
     */
    @PostMapping("/message")
    public ResponseEntity<ChatResponseDTO> sendMessage(@RequestBody ChatRequestDTO request) {
        ChatResponseDTO response = chatService.sendMessage(request);
        return ResponseEntity.ok(response);
    }

    /**
     * 이미지 + 텍스트 멀티모달 분석
     * Body: { sessionId, message, imageBase64 }
     */
    @PostMapping("/multimodal")
    public ResponseEntity<ChatResponseDTO> sendMultimodal(@RequestBody MultimodalRequestDTO request) {
        ChatResponseDTO response = chatService.sendMultimodal(request);
        return ResponseEntity.ok(response);
    }

    /**
     * 세션의 대화 이력 조회
     */
    @GetMapping("/history/{sessionId}")
    public ResponseEntity<List<ChatMessageDTO>> getHistory(@PathVariable String sessionId) {
        return ResponseEntity.ok(chatService.getHistory(sessionId));
    }

    /**
     * 세션의 대화 이력 초기화
     */
    @DeleteMapping("/history/{sessionId}")
    public ResponseEntity<Void> clearHistory(@PathVariable String sessionId) {
        chatService.clearHistory(sessionId);
        return ResponseEntity.noContent().build();
    }
}
