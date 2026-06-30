package yyj.project.twinspring.dto;

public class IntegrationProjectDTO {

    private String projectId;
    private String projectName;
    private String wbsProjectId;   // nullable — 연결된 WBS 프로젝트
    private String bimProjectId;   // nullable — 연결된 BIM 프로젝트
    private String description;
    private String simConfig;      // JSON (작업자·장비·위험구역)
    private String status;         // ACTIVE | INACTIVE
    private Double refLat;         // 현장 원점 위도 (GPS ↔ 물리좌표 변환 기준)
    private Double refLng;         // 현장 원점 경도
    private String createdAt;

    public IntegrationProjectDTO() {}

    // ── Getters & Setters ─────────────────────────────────────────

    public String getProjectId()             { return projectId; }
    public void   setProjectId(String v)     { this.projectId = v; }

    public String getProjectName()           { return projectName; }
    public void   setProjectName(String v)   { this.projectName = v; }

    public String getWbsProjectId()          { return wbsProjectId; }
    public void   setWbsProjectId(String v)  { this.wbsProjectId = v; }

    public String getBimProjectId()          { return bimProjectId; }
    public void   setBimProjectId(String v)  { this.bimProjectId = v; }

    public String getDescription()           { return description; }
    public void   setDescription(String v)   { this.description = v; }

    public String getSimConfig()             { return simConfig; }
    public void   setSimConfig(String v)     { this.simConfig = v; }

    public String getStatus()                { return status; }
    public void   setStatus(String v)        { this.status = v; }

    public Double  getRefLat()               { return refLat; }
    public void    setRefLat(Double v)       { this.refLat = v; }
    public Double  getRefLng()               { return refLng; }
    public void    setRefLng(Double v)       { this.refLng = v; }

    public String getCreatedAt()             { return createdAt; }
    public void   setCreatedAt(String v)     { this.createdAt = v; }
}
