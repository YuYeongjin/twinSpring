package yyj.project.twinspring.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class BimElementDTO {
    private String elementId;
    private String projectId;
    private String elementType;
    private String material;

    private double positionX;
    private double positionY;
    private double positionZ;

    private double sizeX;
    private double sizeY;
    private double sizeZ;
/*
    @Override
    public String toString() {
        // JSON 문자열을 생성
        return "{"
                + "\"projectId\":\"" + projectId + "\","
                + "\"elementId\":\"" + elementId + "\","
                + "\"elementType\":\"" + elementType + "\","
                + "\"material\": \"" + material + "\","
                + "\"positionData\": " + positionData + ","
                + "\"sizeData\": " + sizeData
                + "}";
    }

 */
}
