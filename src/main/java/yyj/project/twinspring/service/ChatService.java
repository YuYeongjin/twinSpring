package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.ChatMessageDTO;
import yyj.project.twinspring.dto.ChatRequestDTO;
import yyj.project.twinspring.dto.ChatResponseDTO;
import yyj.project.twinspring.dto.MultimodalRequestDTO;

import java.util.List;

/**
 * AI 채팅 서비스 인터페이스
 */
public interface ChatService {

    /** 메시지를 Agent에게 전달하고 응답을 반환 */
    ChatResponseDTO sendMessage(ChatRequestDTO request);

    /** 이미지 + 텍스트를 Agent 비전 모델로 분석 */
    ChatResponseDTO sendMultimodal(MultimodalRequestDTO request);

    /** 세션의 대화 이력 반환 */
    List<ChatMessageDTO> getHistory(String sessionId);

    /** 세션의 대화 이력 초기화 */
    void clearHistory(String sessionId);
}
