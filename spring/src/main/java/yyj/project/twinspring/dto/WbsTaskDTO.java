package yyj.project.twinspring.dto;

public class WbsTaskDTO {
    private String  taskId;
    private String  wbsProjectId;
    private String  projectName;      // 프로젝트명 (getAllTasks JOIN 결과)
    private String  wbsCode;          // WBS 코드 (예: 1.1.2)
    private String  taskName;         // 작업명
    private String  startDate;        // yyyy-MM-dd
    private String  endDate;
    private Integer duration;         // 일수 (자동계산 또는 직접입력)
    private Integer progress;         // 진행률 0~100
    private String  predecessorIds;   // 선행작업 IDs (쉼표 구분, CPM 계산용)
    private String  status;           // NOT_STARTED | IN_PROGRESS | COMPLETED | DELAYED
    private String  responsible;      // 담당자
    private String  notes;            // 비고
    private String  source;           // MANUAL | AGENT_CPM | AGENT_CRACK | AGENT_AUTO
    private Integer sortOrder;        // 표시 순서
    private String  createdAt;
    private String  parentTaskId;     // 상위 태스크 ID (세부 공정용)

    public WbsTaskDTO() {}

    // ── Getters & Setters ─────────────────────────────────────────

    public String  getTaskId()         { return taskId; }
    public void    setTaskId(String v) { this.taskId = v; }

    public String  getWbsProjectId()   { return wbsProjectId; }
    public void    setWbsProjectId(String v) { this.wbsProjectId = v; }

    public String  getProjectName()    { return projectName; }
    public void    setProjectName(String v) { this.projectName = v; }

    public String  getWbsCode()        { return wbsCode; }
    public void    setWbsCode(String v) { this.wbsCode = v; }

    public String  getTaskName()       { return taskName; }
    public void    setTaskName(String v) { this.taskName = v; }

    public String  getStartDate()      { return startDate; }
    public void    setStartDate(String v) { this.startDate = v; }

    public String  getEndDate()        { return endDate; }
    public void    setEndDate(String v) { this.endDate = v; }

    public Integer getDuration()       { return duration; }
    public void    setDuration(Integer v) { this.duration = v; }

    public Integer getProgress()       { return progress; }
    public void    setProgress(Integer v) { this.progress = v; }

    public String  getPredecessorIds() { return predecessorIds; }
    public void    setPredecessorIds(String v) { this.predecessorIds = v; }

    public String  getStatus()         { return status; }
    public void    setStatus(String v) { this.status = v; }

    public String  getResponsible()    { return responsible; }
    public void    setResponsible(String v) { this.responsible = v; }

    public String  getNotes()          { return notes; }
    public void    setNotes(String v)  { this.notes = v; }

    public String  getSource()         { return source; }
    public void    setSource(String v) { this.source = v; }

    public Integer getSortOrder()      { return sortOrder; }
    public void    setSortOrder(Integer v) { this.sortOrder = v; }

    public String  getCreatedAt()      { return createdAt; }
    public void    setCreatedAt(String v) { this.createdAt = v; }

    public String  getParentTaskId()   { return parentTaskId; }
    public void    setParentTaskId(String v) { this.parentTaskId = v; }
}
