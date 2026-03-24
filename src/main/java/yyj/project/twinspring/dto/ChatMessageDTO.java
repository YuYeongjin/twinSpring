package yyj.project.twinspring.dto;

import java.time.LocalDateTime;

/**
 * 채팅 메시지 DTO
 */
public class ChatMessageDTO {

    private String role;       // "user" | "assistant"
    private String content;
    private LocalDateTime timestamp;

    public ChatMessageDTO() {}

    public ChatMessageDTO(String role, String content) {
        this.role = role;
        this.content = content;
        this.timestamp = LocalDateTime.now();
    }

    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public LocalDateTime getTimestamp() { return timestamp; }
    public void setTimestamp(LocalDateTime timestamp) { this.timestamp = timestamp; }
}
