package yyj.project.twinspring.dto;

import java.util.Map;

/**
 * 채팅 응답 DTO (Python Agent → Spring → React)
 */
public class ChatResponseDTO {

    private String response;
    private String intent;      // "rag_db" | "bim_builder" | "bim_query" | "chat"
    private String sessionId;
    private Map<String, Object> bimData;  // bim_query 구조화 데이터

    public ChatResponseDTO() {}

    public ChatResponseDTO(String response, String intent, String sessionId) {
        this.response = response;
        this.intent = intent;
        this.sessionId = sessionId;
    }

    public String getResponse() { return response; }
    public void setResponse(String response) { this.response = response; }

    public String getIntent() { return intent; }
    public void setIntent(String intent) { this.intent = intent; }

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public Map<String, Object> getBimData() { return bimData; }
    public void setBimData(Map<String, Object> bimData) { this.bimData = bimData; }
}
