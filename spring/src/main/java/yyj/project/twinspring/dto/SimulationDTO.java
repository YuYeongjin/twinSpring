package yyj.project.twinspring.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class SimulationDTO {

    @JsonProperty("excavatorId")
    private String excavatorId;

    @JsonProperty("positionX")
    private double positionX;

    @JsonProperty("positionY")
    private double positionY;

    @JsonProperty("positionZ")
    private double positionZ;

    @JsonProperty("bodyRotation")
    private double bodyRotation;

    @JsonProperty("swingAngle")
    private double swingAngle;

    @JsonProperty("boomAngle")
    private double boomAngle;

    @JsonProperty("armAngle")
    private double armAngle;

    @JsonProperty("bucketAngle")
    private double bucketAngle;

    @JsonProperty("operationMode")
    private String operationMode;

    @JsonProperty("soilInBucket")
    private Double soilInBucket;

    @JsonProperty("selectedMachineId")
    private String selectedMachineId;

    @JsonProperty("heightMapData")
    private String heightMapData;

    @JsonProperty("zoneMapData")
    private String zoneMapData;

    @JsonProperty("hasRandomTerrain")
    private Boolean hasRandomTerrain;

    public SimulationDTO() {}

    // ── Getters ──────────────────────────────────────────────────────────────

    public String getExcavatorId()      { return excavatorId; }
    public double getPositionX()        { return positionX; }
    public double getPositionY()        { return positionY; }
    public double getPositionZ()        { return positionZ; }
    public double getBodyRotation()     { return bodyRotation; }
    public double getSwingAngle()       { return swingAngle; }
    public double getBoomAngle()        { return boomAngle; }
    public double getArmAngle()         { return armAngle; }
    public double getBucketAngle()      { return bucketAngle; }
    public String getOperationMode()    { return operationMode; }
    public Double getSoilInBucket()     { return soilInBucket; }
    public String getSelectedMachineId(){ return selectedMachineId; }
    public String getHeightMapData()    { return heightMapData; }
    public String getZoneMapData()      { return zoneMapData; }
    public Boolean getHasRandomTerrain(){ return hasRandomTerrain; }

    // ── Setters ──────────────────────────────────────────────────────────────

    public void setExcavatorId(String excavatorId)         { this.excavatorId = excavatorId; }
    public void setPositionX(double positionX)             { this.positionX = positionX; }
    public void setPositionY(double positionY)             { this.positionY = positionY; }
    public void setPositionZ(double positionZ)             { this.positionZ = positionZ; }
    public void setBodyRotation(double bodyRotation)       { this.bodyRotation = bodyRotation; }
    public void setSwingAngle(double swingAngle)           { this.swingAngle = swingAngle; }
    public void setBoomAngle(double boomAngle)             { this.boomAngle = boomAngle; }
    public void setArmAngle(double armAngle)               { this.armAngle = armAngle; }
    public void setBucketAngle(double bucketAngle)         { this.bucketAngle = bucketAngle; }
    public void setOperationMode(String operationMode)     { this.operationMode = operationMode; }
    public void setSoilInBucket(Double soilInBucket)       { this.soilInBucket = soilInBucket; }
    public void setSelectedMachineId(String selectedMachineId) { this.selectedMachineId = selectedMachineId; }
    public void setHeightMapData(String heightMapData)         { this.heightMapData = heightMapData; }
    public void setZoneMapData(String zoneMapData)             { this.zoneMapData = zoneMapData; }
    public void setHasRandomTerrain(Boolean hasRandomTerrain)  { this.hasRandomTerrain = hasRandomTerrain; }
}
