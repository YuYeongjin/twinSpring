package yyj.project.twinspring.dto;

/**
 * 채팅 응답 DTO (Python Agent → Spring → React)
 */
public class ChatResponseDTO {

    private String response;
    private String intent;      // "rag_db" | "bim_builder" | "chat"
    private String sessionId;

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
}
