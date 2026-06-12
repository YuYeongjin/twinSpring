package yyj.project.twinspring.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class BimProjectDTO {

    private String projectId;
    private String projectName;
    private String structureType;
    private String spanCount;

    // ── geoOrigin (IFC 파싱 시 추출, PostgreSQL 로컬 저장용) ─────────
    private Double geoLatitude;   // IfcSite 위도 (없으면 null)
    private Double geoLongitude;  // IfcSite 경도 (없으면 null)
    private Double geoElevation;  // IfcSite 표고 (없으면 null)
    private Double ifcOffsetX;    // Three.js X 정규화 오프셋 (IFC X 중심)
    private Double ifcOffsetY;    // Three.js Z 정규화 오프셋 (IFC Y 최솟값)
    private Double ifcOffsetZ;    // Three.js Y 정규화 오프셋 (IFC Z 최솟값)
    private Double ifcScale;      // IFC 단위 스케일 (mm→m: 0.001)

    public void setProjectId(String projectId) {
        this.projectId = projectId;
    }
    public void setProjectName(String projectName) {
        this.projectName = projectName;
    }
    public void setStructureType(String structureType) {
        this.structureType = structureType;
    }
    public void setSpanCount(String spanCount) {
        this.spanCount = spanCount;
    }

    @Override
    public String toString() {
        return "{"
                + "\"projectId\":\"" + projectId + "\","
                + "\"projectName\":\"" + projectName + "\","
                + "\"structureType\":\"" + structureType + "\","
                + "\"spanCount\": \"" + spanCount + "\""
                + "}";
    }
}
