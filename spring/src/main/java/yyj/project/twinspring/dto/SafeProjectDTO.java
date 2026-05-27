package yyj.project.twinspring.dto;

public class SafeProjectDTO {
    private String projectId;
    private String projectName;
    private String location;        // 현장 위치/카메라 설치 위치
    private String description;
    private String cameraUrl;       // IP 카메라 URL (선택)
    private String status;          // ACTIVE | INACTIVE | ARCHIVED
    private String createdAt;

    public SafeProjectDTO() {}

    public SafeProjectDTO(String projectId, String projectName, String location,
                          String description, String cameraUrl, String status, String createdAt) {
        this.projectId   = projectId;
        this.projectName = projectName;
        this.location    = location;
        this.description = description;
        this.cameraUrl   = cameraUrl;
        this.status      = status;
        this.createdAt   = createdAt;
    }

    public String getProjectId()    { return projectId; }
    public void   setProjectId(String v) { this.projectId = v; }

    public String getProjectName()  { return projectName; }
    public void   setProjectName(String v) { this.projectName = v; }

    public String getLocation()     { return location; }
    public void   setLocation(String v) { this.location = v; }

    public String getDescription()  { return description; }
    public void   setDescription(String v) { this.description = v; }

    public String getCameraUrl()    { return cameraUrl; }
    public void   setCameraUrl(String v) { this.cameraUrl = v; }

    public String getStatus()       { return status; }
    public void   setStatus(String v) { this.status = v; }

    public String getCreatedAt()    { return createdAt; }
    public void   setCreatedAt(String v) { this.createdAt = v; }
}
