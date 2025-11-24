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
