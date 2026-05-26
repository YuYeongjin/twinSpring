package yyj.project.twinspring.dto;

/**
 * WBS 프로젝트 ↔ BIM / Safe / Simulation 프로젝트 연결 정보
 */
public class ProjectLinkDTO {
    private String linkId;
    private String wbsProjectId;
    private String wbsProjectName;    // 역방향 조회용 (JOIN)
    private String linkedType;        // BIM | SAFE | SIMULATION
    private String linkedProjectId;
    private String linkedProjectName; // 순방향 조회용 (JOIN)
    private String linkedLocation;    // 조회용 (JOIN)
    private String linkedStatus;      // 조회용 (JOIN)
    private String createdAt;
    private String note;              // 연결 메모 (선택)

    public ProjectLinkDTO() {}

    public String getLinkId()             { return linkId; }
    public void   setLinkId(String v)     { this.linkId = v; }

    public String getWbsProjectId()       { return wbsProjectId; }
    public void   setWbsProjectId(String v) { this.wbsProjectId = v; }

    public String getWbsProjectName()    { return wbsProjectName; }
    public void   setWbsProjectName(String v) { this.wbsProjectName = v; }

    public String getLinkedType()         { return linkedType; }
    public void   setLinkedType(String v) { this.linkedType = v; }

    public String getLinkedProjectId()    { return linkedProjectId; }
    public void   setLinkedProjectId(String v) { this.linkedProjectId = v; }

    public String getLinkedProjectName()  { return linkedProjectName; }
    public void   setLinkedProjectName(String v) { this.linkedProjectName = v; }

    public String getLinkedLocation()     { return linkedLocation; }
    public void   setLinkedLocation(String v) { this.linkedLocation = v; }

    public String getLinkedStatus()       { return linkedStatus; }
    public void   setLinkedStatus(String v) { this.linkedStatus = v; }

    public String getCreatedAt()          { return createdAt; }
    public void   setCreatedAt(String v)  { this.createdAt = v; }

    public String getNote()               { return note; }
    public void   setNote(String v)       { this.note = v; }
}
