package yyj.project.twinspring.dto;

import java.util.List;

/**
 * 채팅 요청 DTO (React → Spring → Python Agent)
 */
public class ChatRequestDTO {

    private String sessionId;
    private String message;
    private List<ChatMessageDTO> history;
    private String projectId;             // 현재 선택된 BIM 프로젝트 ID (nullable)
    private String simulationProjectId;   // 현재 선택된 시뮬레이션 프로젝트 ID (nullable)
    private String wbsProjectId;          // 현재 선택된 WBS 프로젝트 ID (nullable)
    private String directAgent;           // 탭 전용 에이전트 이름 (nullable, 설정 시 supervisor 라우팅 스킵)

    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public List<ChatMessageDTO> getHistory() { return history; }
    public void setHistory(List<ChatMessageDTO> history) { this.history = history; }

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getSimulationProjectId() { return simulationProjectId; }
    public void setSimulationProjectId(String simulationProjectId) { this.simulationProjectId = simulationProjectId; }

    public String getWbsProjectId() { return wbsProjectId; }
    public void setWbsProjectId(String wbsProjectId) { this.wbsProjectId = wbsProjectId; }

    public String getDirectAgent() { return directAgent; }
    public void setDirectAgent(String directAgent) { this.directAgent = directAgent; }
}
