package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@Data
public class BimModelDTO {

    private String modelName;
    private List<BimElement> elements;

    @Override
    public String toString(){
        return "modelName : " + modelName + ", elements : " + elements;
    };


    public class BimElement{
        public String id;        // 부재의 고유 ID (클릭 시 사용)
        public String type;      // IfcWall, IfcColumn 등
        public float[] position; // 3D 위치 좌표 (예: [0, 0, 0])
        public float[] size;     // 크기 (예: [width, height, depth])
        public String material;  // 속성 데이터
    }
}
