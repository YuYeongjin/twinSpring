package yyj.project.twinspring.dto;

/**
 * 멀티모달 채팅 요청 DTO (이미지 + 텍스트)
 * React → Spring → Python Agent /chat-multimodal
 */
public class MultimodalRequestDTO {

    private String sessionId;
    private String message;
    private String imageBase64;  // data URL 또는 순수 base64

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public String getImageBase64() { return imageBase64; }
    public void setImageBase64(String imageBase64) { this.imageBase64 = imageBase64; }
}
