package yyj.project.twinspring.dto;

public class SafeIotMappingDTO {
    private String mappingId;
    private String projectId;
    private String projectName;
    private String sensorLocation;  // sensor_data.location 값 (예: "bridgeA")
    private String sensorAlias;     // 사용자 지정 표시 이름
    private String createdAt;

    public SafeIotMappingDTO() {}

    public String getMappingId()     { return mappingId; }
    public void   setMappingId(String v)     { this.mappingId = v; }

    public String getProjectId()     { return projectId; }
    public void   setProjectId(String v)     { this.projectId = v; }

    public String getProjectName()   { return projectName; }
    public void   setProjectName(String v)   { this.projectName = v; }

    public String getSensorLocation() { return sensorLocation; }
    public void   setSensorLocation(String v) { this.sensorLocation = v; }

    public String getSensorAlias()   { return sensorAlias; }
    public void   setSensorAlias(String v)   { this.sensorAlias = v; }

    public String getCreatedAt()     { return createdAt; }
    public void   setCreatedAt(String v)     { this.createdAt = v; }
}
