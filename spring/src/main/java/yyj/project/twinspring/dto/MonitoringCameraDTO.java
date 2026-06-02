package yyj.project.twinspring.dto;

public class MonitoringCameraDTO {
    private String cameraId;
    private String projectId;
    private String cameraName;
    private String cameraUrl;   // rtsp:// · http:// · https://
    private boolean enabled;
    private int sortOrder;
    private String createdAt;

    public MonitoringCameraDTO() {}

    public String  getCameraId()             { return cameraId; }
    public void    setCameraId(String v)     { this.cameraId = v; }

    public String  getProjectId()            { return projectId; }
    public void    setProjectId(String v)    { this.projectId = v; }

    public String  getCameraName()           { return cameraName; }
    public void    setCameraName(String v)   { this.cameraName = v; }

    public String  getCameraUrl()            { return cameraUrl; }
    public void    setCameraUrl(String v)    { this.cameraUrl = v; }

    public boolean isEnabled()               { return enabled; }
    public void    setEnabled(boolean v)     { this.enabled = v; }

    public int     getSortOrder()            { return sortOrder; }
    public void    setSortOrder(int v)       { this.sortOrder = v; }

    public String  getCreatedAt()            { return createdAt; }
    public void    setCreatedAt(String v)    { this.createdAt = v; }
}
