package yyj.project.twinspring.dto;

public class WbsProjectDTO {
    private String projectId;
    private String projectName;
    private String location;       // 장소/현장 주소
    private Long   contractAmount; // 계약금액 (원)
    private String status;         // PLANNED | IN_PROGRESS | COMPLETED | ON_HOLD
    private String description;
    private String startDate;      // yyyy-MM-dd
    private String endDate;
    private String clientName;     // 발주처
    private String managerName;    // 현장소장
    private Integer taskCount;     // 조회용 (선택)
    private String createdAt;

    public WbsProjectDTO() {}

    public WbsProjectDTO(String projectId, String projectName, String location,
                         Long contractAmount, String status, String description,
                         String startDate, String endDate,
                         String clientName, String managerName,
                         Integer taskCount, String createdAt) {
        this.projectId      = projectId;
        this.projectName    = projectName;
        this.location       = location;
        this.contractAmount = contractAmount;
        this.status         = status;
        this.description    = description;
        this.startDate      = startDate;
        this.endDate        = endDate;
        this.clientName     = clientName;
        this.managerName    = managerName;
        this.taskCount      = taskCount;
        this.createdAt      = createdAt;
    }

    // ── Getters & Setters ─────────────────────────────────────────

    public String  getProjectId()      { return projectId; }
    public void    setProjectId(String v) { this.projectId = v; }

    public String  getProjectName()    { return projectName; }
    public void    setProjectName(String v) { this.projectName = v; }

    public String  getLocation()       { return location; }
    public void    setLocation(String v) { this.location = v; }

    public Long    getContractAmount() { return contractAmount; }
    public void    setContractAmount(Long v) { this.contractAmount = v; }

    public String  getStatus()         { return status; }
    public void    setStatus(String v) { this.status = v; }

    public String  getDescription()    { return description; }
    public void    setDescription(String v) { this.description = v; }

    public String  getStartDate()      { return startDate; }
    public void    setStartDate(String v) { this.startDate = v; }

    public String  getEndDate()        { return endDate; }
    public void    setEndDate(String v) { this.endDate = v; }

    public String  getClientName()     { return clientName; }
    public void    setClientName(String v) { this.clientName = v; }

    public String  getManagerName()    { return managerName; }
    public void    setManagerName(String v) { this.managerName = v; }

    public Integer getTaskCount()      { return taskCount; }
    public void    setTaskCount(Integer v) { this.taskCount = v; }

    public String  getCreatedAt()      { return createdAt; }
    public void    setCreatedAt(String v) { this.createdAt = v; }
}
