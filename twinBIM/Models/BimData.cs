using System.Collections.Generic;

namespace BimProcessorApi.Models
{
    // BIM 모델 전체를 담는 컨테이너
    public class BimModelData
    {
        public string ModelName { get; set; }
        public List<BimElement> Elements { get; set; } = new List<BimElement>();
    }

    // BIM 부재(Element)의 속성 및 형상 정보
    public class BimElement
    {
        public string Id { get; set; }        // 고유 ID (예: COL_001)
        public string Type { get; set; }      // 부재 타입 (예: IfcWall, IfcColumn)
        public float[] Position { get; set; } // 3D 위치 [x, y, z]
        public float[] Size { get; set; }     // 크기 [width, height, depth]
        public string Material { get; set; }  // 속성 데이터
        public string ProjectId { get; set; } // 프로젝트 ID
    }
}