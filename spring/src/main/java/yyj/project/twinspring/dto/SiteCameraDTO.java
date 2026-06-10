package yyj.project.twinspring.dto;

public class SiteCameraDTO {
    private String  cameraId;
    private String  projectId;
    private String  name;
    private String  url;
    private Double  worldX;
    private Double  worldY;
    private Double  worldZ;
    private Double  yaw;
    private Double  fovH;
    private Boolean active;
    private String  createdAt;

    public String  getCameraId()  { return cameraId; }
    public void    setCameraId(String v)  { this.cameraId = v; }
    public String  getProjectId() { return projectId; }
    public void    setProjectId(String v) { this.projectId = v; }
    public String  getName()      { return name; }
    public void    setName(String v)      { this.name = v; }
    public String  getUrl()       { return url; }
    public void    setUrl(String v)       { this.url = v; }
    public Double  getWorldX()    { return worldX; }
    public void    setWorldX(Double v)    { this.worldX = v; }
    public Double  getWorldY()    { return worldY; }
    public void    setWorldY(Double v)    { this.worldY = v; }
    public Double  getWorldZ()    { return worldZ; }
    public void    setWorldZ(Double v)    { this.worldZ = v; }
    public Double  getYaw()       { return yaw; }
    public void    setYaw(Double v)       { this.yaw = v; }
    public Double  getFovH()      { return fovH; }
    public void    setFovH(Double v)      { this.fovH = v; }
    public Boolean getActive()    { return active; }
    public void    setActive(Boolean v)   { this.active = v; }
    public String  getCreatedAt() { return createdAt; }
    public void    setCreatedAt(String v) { this.createdAt = v; }
}
