package yyj.project.twinspring.dto;

import java.util.List;

/**
 * 채팅 요청 DTO (React → Spring → Python Agent)
 */
public class ChatRequestDTO {

    private String sessionId;
    private String message;
    private List<ChatMessageDTO> history;
    private String projectId;   // 현재 선택된 BIM 프로젝트 ID (nullable)

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public List<ChatMessageDTO> getHistory() { return history; }
    public void setHistory(List<ChatMessageDTO> history) { this.history = history; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
}
