package yyj.project.twinspring.dto;

public class SimulationProjectDTO {

    private String projectId;
    private String projectName;

    public SimulationProjectDTO() {}

    public SimulationProjectDTO(String projectId, String projectName) {
        this.projectId = projectId;
        this.projectName = projectName;
    }

    public String getProjectId()   { return projectId; }
    public String getProjectName() { return projectName; }

    public void setProjectId(String projectId)     { this.projectId = projectId; }
    public void setProjectName(String projectName) { this.projectName = projectName; }
}
