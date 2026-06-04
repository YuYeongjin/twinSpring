package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.ChatMessageDTO;
import yyj.project.twinspring.dto.ChatRequestDTO;
import yyj.project.twinspring.dto.ChatResponseDTO;
import yyj.project.twinspring.dto.MultimodalRequestDTO;
import yyj.project.twinspring.dto.WbsRagRequestDTO;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * AI 채팅 서비스 인터페이스
 */
public interface ChatService {

    /** 메시지를 Agent에게 전달하고 응답을 반환 (Full Multi-Agent 라우팅) */
    ChatResponseDTO sendMessage(ChatRequestDTO request);

    /** 단순 챗봇 응답 — LangGraph 라우팅 없이 chat 노드만 직접 호출 */
    ChatResponseDTO sendSimpleMessage(ChatRequestDTO request);

    /** 이미지 + 텍스트를 Agent 비전 모델로 분석 */
    ChatResponseDTO sendMultimodal(MultimodalRequestDTO request);

    /** 세션의 대화 이력 반환 */
    List<ChatMessageDTO> getHistory(String sessionId);

    /** 세션의 대화 이력 초기화 */
    void clearHistory(String sessionId);

    /** Agent 서버 헬스체크 */
    boolean isAgentAvailable();

    /** Agent /chat-stream 을 프록시하는 SSE 스트림 */
    Flux<String> streamMessage(ChatRequestDTO request);

    /**
     * WBS 이벤트 발생 시 관련 건설 시방서(KCS/KDS) 증거를 RAG 검색하여 반환.
     * AgentWbsPopup 에서 사용자 승인 전 근거 자료 표시에 사용.
     */
    Map<String, Object> wbsRagSuggest(WbsRagRequestDTO request);

    /**
     * WBS 프로젝트 생성 에이전트 채팅.
     * 사용자 메시지에서 현장 프로젝트 정보를 수집하고, 충분한 정보가 모이면 ready=true 반환.
     * WbsDashboard 의 에이전트 채팅 패널에서 사용.
     */
    Map<String, Object> wbsProjectChat(Map<String, Object> request);

    /**
     * 구조해석 결과에 기반한 KCS/KDS 시방서 RAG 검색.
     * StructuralDashboard 의 시방서 패널에서 사용.
     */
    Map<String, Object> structuralSpec(Map<String, Object> request);

    /**
     * 굴착 존·날씨·깊이에 맞는 KCS/KDS 토공 시방서 RAG 검색.
     * SimulationDashboard 의 시방서 패널에서 사용.
     */
    Map<String, Object> excavationSpec(Map<String, Object> request);

    /** RAG 인덱스 현황 조회 (청크 수, 빌드 상태) */
    Map<String, Object> ragStatus();

    /** RAG 인덱스 재구축 트리거 */
    Map<String, Object> ragRebuild();
}
