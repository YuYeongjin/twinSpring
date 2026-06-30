package yyj.project.twinspring.dto;

public class MonitoringSnapshotDTO {
    private String snapshotId;
    private String projectId;
    private String scheduleId;
    private String cameraId;    // 어느 카메라에서 찍혔는지
    private String cameraName;  // 카메라 표시명 (삭제 후에도 이름 유지)
    private String mode;
    private boolean isProblem;
    private String detectionJson;
    private String capturedAt;
    private String expiresAt;
    // image_data 는 /image 엔드포인트로 별도 제공 — DTO 에 포함하지 않음

    public MonitoringSnapshotDTO() {}

    public String getSnapshotId()            { return snapshotId; }
    public void   setSnapshotId(String v)    { this.snapshotId = v; }

    public String getProjectId()             { return projectId; }
    public void   setProjectId(String v)     { this.projectId = v; }

    public String getScheduleId()            { return scheduleId; }
    public void   setScheduleId(String v)    { this.scheduleId = v; }

    public String getCameraId()              { return cameraId; }
    public void   setCameraId(String v)      { this.cameraId = v; }

    public String getCameraName()            { return cameraName; }
    public void   setCameraName(String v)    { this.cameraName = v; }

    public String getMode()                  { return mode; }
    public void   setMode(String v)          { this.mode = v; }

    public boolean isProblem()               { return isProblem; }
    public void    setProblem(boolean v)     { this.isProblem = v; }

    public String getDetectionJson()         { return detectionJson; }
    public void   setDetectionJson(String v) { this.detectionJson = v; }

    public String getCapturedAt()            { return capturedAt; }
    public void   setCapturedAt(String v)    { this.capturedAt = v; }

    public String getExpiresAt()             { return expiresAt; }
    public void   setExpiresAt(String v)     { this.expiresAt = v; }
}
