package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@Data
@NoArgsConstructor
public class BimModelDTO {

    private String modelName;
    private List<BimElement> elements;

    @Getter
    @Setter
    @NoArgsConstructor
    public static class BimElement{
        private String id;        // 부재의 고유 ID (클릭 시 사용)
        private String type;      // IfcWall, IfcColumn 등
        private float[] position; // 3D 위치 좌표 (예: [0, 0, 0])
        private float[] size;     // 크기 (예: [width, height, depth])
        private String material;  // 속성 데이터

        private String projectId;
    }
}
