package yyj.project.twinspring.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class BimLineDTO {
    private String lineId;
    private String projectId;
    private double startX;
    private double startY;
    private double startZ;
    private double endX;
    private double endY;
    private double endZ;
    private String color;
    private double lineWidth;
}
