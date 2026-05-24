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
    // 다중점 / 도형 지원 (nullable — 기존 선과 호환)
    private String pointsJson;   // JSON: [[x,y,z], ...]  — 3개 이상이면 폴리라인
    private boolean closed;      // true 이면 마지막 점을 첫 점과 연결 (다각형)
    private double shapeHeight;  // > 0 이면 closed 다각형을 Y축 방향으로 돌출 (3D 도형)
}
