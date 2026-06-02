package yyj.project.twinspring.dto;

public class MonitoringScheduleDTO {
    private String scheduleId;
    private String projectId;
    private boolean enabled;
    private int captureIntervalSec;
    private int retentionSec;
    private String lastCapturedAt;
    private String createdAt;

    public MonitoringScheduleDTO() {}

    public String getScheduleId()            { return scheduleId; }
    public void   setScheduleId(String v)    { this.scheduleId = v; }

    public String getProjectId()             { return projectId; }
    public void   setProjectId(String v)     { this.projectId = v; }

    public boolean isEnabled()               { return enabled; }
    public void    setEnabled(boolean v)     { this.enabled = v; }

    public int  getCaptureIntervalSec()          { return captureIntervalSec; }
    public void setCaptureIntervalSec(int v)     { this.captureIntervalSec = v; }

    public int  getRetentionSec()            { return retentionSec; }
    public void setRetentionSec(int v)       { this.retentionSec = v; }

    public String getLastCapturedAt()        { return lastCapturedAt; }
    public void   setLastCapturedAt(String v){ this.lastCapturedAt = v; }

    public String getCreatedAt()             { return createdAt; }
    public void   setCreatedAt(String v)     { this.createdAt = v; }
}
