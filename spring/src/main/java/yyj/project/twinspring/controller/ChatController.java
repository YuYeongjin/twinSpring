package yyj.project.twinspring.controller;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.Map;
import yyj.project.twinspring.dto.ChatMessageDTO;
import yyj.project.twinspring.dto.ChatRequestDTO;
import yyj.project.twinspring.dto.ChatResponseDTO;
import yyj.project.twinspring.dto.MultimodalRequestDTO;
import yyj.project.twinspring.dto.WbsRagRequestDTO;
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
     * 사용자 메시지를 AI Agent로 전달하고 응답 반환 (Full Multi-Agent 라우팅)
     * Agent 탭에서 사용 — LangGraph 전체 라우팅 실행
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
     * Agent /chat-stream SSE 프록시
     * text/event-stream 으로 토큰을 스트리밍 — 영어/일본어 504 방지
     *
     * SSE 이벤트:
     *   data: {"step": "classifying"}        ← 분류 중
     *   data: {"step": "sensor_agent"}       ← 에이전트 선택
     *   data: {"content": "안녕"}            ← 토큰 chunk
     *   data: {"done": true, "response": "...", "intent": "...", ...}  ← 완료
     *
     * 헤더:
     *   X-Accel-Buffering: no  → Nginx 버퍼링 비활성화 (SSE 즉시 전달)
     *   Cache-Control: no-cache
     */
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamMessage(@RequestBody ChatRequestDTO request) {
        return chatService.streamMessage(request);
    }

    /**
     * 단순 챗봇 응답 — LangGraph 라우팅 없이 chat 노드만 호출
     * 다른 탭의 우측 하단 ChatView에서 사용
     */
    @PostMapping("/simple")
    public ResponseEntity<ChatResponseDTO> sendSimpleMessage(@RequestBody ChatRequestDTO request) {
        ChatResponseDTO response = chatService.sendSimpleMessage(request);
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

    /**
     * Agent 서버 헬스체크
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, String>> agentStatus() {
        boolean available = chatService.isAgentAvailable();
        return available
                ? ResponseEntity.ok(Map.of("status", "online"))
                : ResponseEntity.status(503).body(Map.of("status", "offline"));
    }

    /**
     * WBS 이벤트 발생 시 관련 건설 시방서(KCS/KDS) 증거 RAG 검색
     *
     * Body 예시:
     * {
     *   "eventType": "CRACK",
     *   "title": "3층 기둥 균열 감지",
     *   "detail": "균열폭 0.3mm 이상"
     * }
     *
     * Response:
     * {
     *   "query": "구조물 균열 ...",
     *   "evidence": [{ "source": "KCS 41 30 01", "series": "...", "content": "..." }],
     *   "hasData": true
     * }
     */
    @PostMapping("/wbs-rag-suggest")
    public ResponseEntity<Map<String, Object>> wbsRagSuggest(@RequestBody WbsRagRequestDTO request) {
        Map<String, Object> result = chatService.wbsRagSuggest(request);
        return ResponseEntity.ok(result);
    }

    /**
     * WBS 프로젝트 생성 에이전트 채팅
     *
     * Body 예시:
     * {
     *   "message": "한강대교 보강공사 현장 등록해줘",
     *   "history": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
     *   "collected": {"projectName": "한강대교 보강공사"}
     * }
     *
     * Response:
     * {
     *   "response": "알겠습니다. 현장 위치를 알려주세요.",
     *   "collected": {"projectName": "한강대교 보강공사"},
     *   "ready": false
     * }
     */
    @PostMapping("/wbs-project-chat")
    public ResponseEntity<Map<String, Object>> wbsProjectChat(@RequestBody Map<String, Object> request) {
        Map<String, Object> result = chatService.wbsProjectChat(request);
        return ResponseEntity.ok(result);
    }

    /**
     * 구조해석 결과에 기반한 KCS/KDS 시방서 RAG 검색
     * StructuralDashboard 시방서 패널에서 사용
     */
    @PostMapping("/structural-spec")
    public ResponseEntity<Map<String, Object>> structuralSpec(@RequestBody Map<String, Object> request) {
        Map<String, Object> result = chatService.structuralSpec(request);
        return ResponseEntity.ok(result);
    }

    /**
     * 굴착 존·날씨·깊이에 맞는 KCS/KDS 토공 시방서 RAG 검색
     * SimulationDashboard 시방서 패널에서 사용
     */
    @PostMapping("/excavation-spec")
    public ResponseEntity<Map<String, Object>> excavationSpec(@RequestBody Map<String, Object> request) {
        Map<String, Object> result = chatService.excavationSpec(request);
        return ResponseEntity.ok(result);
    }
}
