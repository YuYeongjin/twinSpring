package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Data
public class BimElementDTO {
    private String elementId;
    private String projectId;
    private String elementType;
    private String material;

    private Double positionX;
    private Double positionY;
    private Double positionZ;

    private Double sizeX;
    private Double sizeY;
    private Double sizeZ;

    private Double rotationX;
    private Double rotationY;
    private Double rotationZ;

    // ── IFC 원본 좌표 (Z-up, 정규화 전) — GIS / AI Agent 위치 추적용 ─
    private Double ifcWorldX;
    private Double ifcWorldY;
    private Double ifcWorldZ;

    // ── IFC 구조 분석 결과 — GlobalId, Name, 층, 동 ────────────────
    private String globalId;
    private String ifcName;
    private String storey;
    private String building;

    // ── IFC 속성 정보 (IfcPropertySet + IfcElementQuantity → JSON 직렬화) ──
    private String ifcProperties;

    /*
    @Override
    public String toString() {
        return "{"
                + "\"projectId\": \"" + projectId + "\", "
                + "\"elementId\": \"" + elementId + "\", "
                + "\"elementType\": \"" + elementType + "\", "
                + "\"material\": \"" + material + "\", "
                + "\"positionData\": [" + positionX + ", " + positionY + ", " + positionZ + "], "
                + "\"sizeData\": [" + sizeX + ", " + sizeY + ", " + sizeZ + "]"
                + "}";
    }

     */

}
