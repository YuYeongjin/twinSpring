package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.netty.channel.ChannelOption;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import yyj.project.twinspring.dto.ChatMessageDTO;
import yyj.project.twinspring.dto.ChatRequestDTO;
import yyj.project.twinspring.dto.ChatResponseDTO;
import yyj.project.twinspring.dto.MultimodalRequestDTO;
import yyj.project.twinspring.dto.WbsRagRequestDTO;
import yyj.project.twinspring.service.ChatService;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * AI 채팅 서비스 구현체
 *
 * - Python FastAPI Agent 서버에 HTTP 요청을 프록시합니다.
 * - 세션별 대화 이력을 인메모리(ConcurrentHashMap)로 관리합니다.
 */
@Service
public class ChatServiceImpl implements ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatServiceImpl.class);

    private final WebClient agentClient;
    private final ObjectMapper objectMapper;

    /** sessionId → 대화 이력 */
    private final Map<String, List<ChatMessageDTO>> sessions = new ConcurrentHashMap<>();

    public ChatServiceImpl(
            WebClient.Builder builder,
            ObjectMapper objectMapper,
            @Value("${agent.url:http://localhost:7070}") String agentUrl
    ) {
        // LLM(Ollama) 응답은 영어/일본어 등 언어에 따라 수 분이 걸릴 수 있음
        // responseTimeout 없이 build()하면 Reactor Netty 기본 acquire timeout(45초)에 걸려 504 발생
        HttpClient agentHttpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5_000)   // 연결 실패는 5초 내 감지
                .responseTimeout(Duration.ofMinutes(10));               // LLM 응답 최대 10분 대기

        this.agentClient = builder
                .baseUrl(agentUrl)
                .defaultHeader("Content-Type", "application/json")
                .clientConnector(new ReactorClientHttpConnector(agentHttpClient))
                .build();
        this.objectMapper = objectMapper;
    }

    @Override
    public ChatResponseDTO sendMessage(ChatRequestDTO request) {
        String sessionId = request.getSessionId() != null ? request.getSessionId() : "default";

        // 세션 이력 로드 (최근 20턴만 전달)
        List<ChatMessageDTO> history = sessions.computeIfAbsent(sessionId, k -> new ArrayList<>());
        int start = Math.max(0, history.size() - 20);
        List<ChatMessageDTO> recentHistory = history.subList(start, history.size());

        // Python Agent 요청 바디 구성
        ObjectNode body = objectMapper.createObjectNode();
        body.put("message", request.getMessage());
        body.put("session_id", sessionId);

        ArrayNode historyArray = body.putArray("history");
        for (ChatMessageDTO msg : recentHistory) {
            ObjectNode msgNode = historyArray.addObject();
            msgNode.put("role", msg.getRole());
            msgNode.put("content", msg.getContent());
        }

        ObjectNode context = body.putObject("context");
        if (request.getProjectId() != null) {
            context.put("projectId", request.getProjectId());
        } else {
            context.putNull("projectId");
        }
        if (request.getSimulationProjectId() != null) {
            context.put("simulationProjectId", request.getSimulationProjectId());
        } else {
            context.putNull("simulationProjectId");
        }

        // Python Agent 호출
        String agentResponse;
        String intent = "chat";
        Map<String, Object> bimData = null;
        Map<String, Object> sensorData = null;
        try {
            String raw = agentClient.post()
                    .uri("/chat")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofMinutes(10))  // 안전망: 10분 초과 시 TimeoutException
                    .block();

            JsonNode json = objectMapper.readTree(raw);
            agentResponse = json.path("response").asText("응답을 받지 못했습니다.");
            intent = json.path("intent").asText("chat");

            // bimData 파싱 (bim_query 노드에서 반환)
            JsonNode bimDataNode = json.path("bimData");
            if (!bimDataNode.isMissingNode() && !bimDataNode.isNull()) {
                bimData = objectMapper.convertValue(bimDataNode, Map.class);
            }

            // sensorData 파싱 (rag_db 노드에서 반환)
            JsonNode sensorDataNode = json.path("sensorData");
            if (!sensorDataNode.isMissingNode() && !sensorDataNode.isNull()) {
                sensorData = objectMapper.convertValue(sensorDataNode, Map.class);
            }

        } catch (Exception e) {
            log.error("Agent 호출 실패: {}", e.getMessage());
            agentResponse = "AI Agent에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
        }

        // 세션 이력 저장
        history.add(new ChatMessageDTO("user", request.getMessage()));
        history.add(new ChatMessageDTO("assistant", agentResponse));

        ChatResponseDTO responseDTO = new ChatResponseDTO(agentResponse, intent, sessionId);
        responseDTO.setBimData(bimData);
        responseDTO.setSensorData(sensorData);
        return responseDTO;
    }

    @Override
    public ChatResponseDTO sendSimpleMessage(ChatRequestDTO request) {
        String sessionId = request.getSessionId() != null ? request.getSessionId() : "default";

        // 세션 이력 로드 (최근 20턴)
        List<ChatMessageDTO> history = sessions.computeIfAbsent(sessionId, k -> new ArrayList<>());
        int start = Math.max(0, history.size() - 20);
        List<ChatMessageDTO> recentHistory = history.subList(start, history.size());

        // Python /chat-simple 요청 바디 구성 (context 불필요 — chat 노드만 사용)
        ObjectNode body = objectMapper.createObjectNode();
        body.put("message", request.getMessage());
        body.put("session_id", sessionId);

        ArrayNode historyArray = body.putArray("history");
        for (ChatMessageDTO msg : recentHistory) {
            ObjectNode msgNode = historyArray.addObject();
            msgNode.put("role", msg.getRole());
            msgNode.put("content", msg.getContent());
        }

        // context 빈 객체 전달 (스키마 호환)
        body.putObject("context");

        String agentResponse;
        try {
            String raw = agentClient.post()
                    .uri("/chat-simple")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofMinutes(10))
                    .block();

            JsonNode json = objectMapper.readTree(raw);
            agentResponse = json.path("response").asText("응답을 받지 못했습니다.");
        } catch (Exception e) {
            log.error("Simple Chat Agent 호출 실패: {}", e.getMessage());
            agentResponse = "AI Agent에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
        }

        // 세션 이력 저장
        history.add(new ChatMessageDTO("user", request.getMessage()));
        history.add(new ChatMessageDTO("assistant", agentResponse));

        return new ChatResponseDTO(agentResponse, "chat", sessionId);
    }

    @Override
    public ChatResponseDTO sendMultimodal(MultimodalRequestDTO request) {
        String sessionId = request.getSessionId() != null ? request.getSessionId() : "default";

        ObjectNode body = objectMapper.createObjectNode();
        body.put("message", request.getMessage() != null ? request.getMessage() : "이 이미지를 분석해주세요.");
        body.put("image_base64", request.getImageBase64());
        body.put("session_id", sessionId);

        String agentResponse;
        try {
            String raw = agentClient.post()
                    .uri("/chat-multimodal")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofMinutes(10))
                    .block();

            JsonNode json = objectMapper.readTree(raw);
            agentResponse = json.path("response").asText("응답을 받지 못했습니다.");
        } catch (Exception e) {
            log.error("Multimodal Agent 호출 실패: {}", e.getMessage());
            agentResponse = "이미지 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        }

        return new ChatResponseDTO(agentResponse, "vision", sessionId);
    }

    @Override
    public List<ChatMessageDTO> getHistory(String sessionId) {
        return sessions.getOrDefault(sessionId, List.of());
    }

    @Override
    public void clearHistory(String sessionId) {
        sessions.remove(sessionId);
        // Python Agent 세션 상태(pending_action 등)도 초기화
        try {
            agentClient.delete()
                    .uri("/session/" + sessionId)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block();
        } catch (Exception e) {
            log.warn("Agent 세션 초기화 실패 (무시): {}", e.getMessage());
        }
    }

    @Override
    public Flux<String> streamMessage(ChatRequestDTO request) {
        String sessionId = request.getSessionId() != null ? request.getSessionId() : "default";

        List<ChatMessageDTO> history = sessions.computeIfAbsent(sessionId, k -> new ArrayList<>());
        int start = Math.max(0, history.size() - 20);
        List<ChatMessageDTO> recentHistory = history.subList(start, history.size());

        ObjectNode body = objectMapper.createObjectNode();
        body.put("message", request.getMessage());
        body.put("session_id", sessionId);

        ArrayNode historyArray = body.putArray("history");
        for (ChatMessageDTO msg : recentHistory) {
            ObjectNode msgNode = historyArray.addObject();
            msgNode.put("role", msg.getRole());
            msgNode.put("content", msg.getContent());
        }

        ObjectNode context = body.putObject("context");
        if (request.getProjectId() != null) context.put("projectId", request.getProjectId());
        else context.putNull("projectId");
        if (request.getSimulationProjectId() != null) context.put("simulationProjectId", request.getSimulationProjectId());
        else context.putNull("simulationProjectId");

        /*
         * SSE 프록시 방식:
         *   bodyToFlux(String.class)         — 네트워크 청크 단위 읽기
         *                                       여러 SSE 이벤트가 한 청크로 묶이면 파싱 깨짐 → 500
         *   bodyToFlux(ServerSentEvent<String>) — SSE 포맷을 직접 파싱 (이벤트 단위 보장)
         *                                       data 필드만 추출해 반환 → 정확하고 안전
         *
         * Spring MVC + WebFlux 공존(starter-web + starter-webflux) 환경에서
         * Flux<String> 반환은 ReactiveAdapterRegistry 를 통해 정상 동작합니다.
         * Spring SSE 포매터가 각 String 요소를 "data: {json}\n\n" 으로 래핑해 클라이언트에 전송.
         */
        return agentClient.post()
                .uri("/chat-stream")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                // ServerSentEvent<String> → Python SSE 를 이벤트 단위로 정확히 파싱
                .bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {})
                // data 필드가 있는 이벤트만 (id-only, comment 이벤트 제외)
                .filter(sse -> sse.data() != null && !sse.data().isBlank())
                // 순수 JSON 문자열 추출 ("data: " 접두사 없음)
                .map(ServerSentEvent::data)
                .doOnNext(json -> {
                    // done 이벤트에서 대화 이력 저장
                    if (json.contains("\"done\":true")) {
                        try {
                            JsonNode node = objectMapper.readTree(json);
                            String response = node.path("response").asText("");
                            if (!response.isEmpty()) {
                                history.add(new ChatMessageDTO("user", request.getMessage()));
                                history.add(new ChatMessageDTO("assistant", response));
                            }
                        } catch (Exception e) {
                            log.warn("스트림 done 이벤트 파싱 실패: {}", e.getMessage());
                        }
                    }
                });
    }

    @Override
    public boolean isAgentAvailable() {
        try {
            agentClient.get()
                    .uri("/health")
                    .exchangeToMono(cr -> Mono.just(cr.statusCode()))
                    .block(Duration.ofSeconds(3));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public Map<String, Object> wbsProjectChat(Map<String, Object> request) {
        try {
            String raw = agentClient.post()
                    .uri("/wbs-project-chat")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(60))
                    .block();

            //noinspection unchecked
            return objectMapper.readValue(raw, Map.class);
        } catch (Exception e) {
            log.error("[WbsProjectChat] 에이전트 호출 실패: {}", e.getMessage());
            return Map.of(
                "response", "죄송합니다, 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
                "collected", Map.of(),
                "ready", false
            );
        }
    }

    @Override
    public Map<String, Object> wbsRagSuggest(WbsRagRequestDTO request) {
        try {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("eventType", request.getEventType() != null ? request.getEventType() : "");
            body.put("title",     request.getTitle()     != null ? request.getTitle()     : "");
            body.put("detail",    request.getDetail()    != null ? request.getDetail()    : "");

            String raw = agentClient.post()
                    .uri("/wbs-rag-suggest")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(15))
                    .block();

            //noinspection unchecked
            return objectMapper.readValue(raw, Map.class);
        } catch (Exception e) {
            log.error("[WbsRagSuggest] RAG 검색 실패: {}", e.getMessage());
            return Map.of("query", "", "evidence", List.of(), "hasData", false);
        }
    }
}
