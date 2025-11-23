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
        public double? PositionX { get; set; }

        public double? PositionY { get; set; }

        public double? PositionZ { get; set; }

        public double? SizeX { get; set; }

        public double? SizeY { get; set; }
        public double? SizeZ { get; set; }
        public string Material { get; set; }  // 속성 데이터
        public string ProjectId { get; set; } // 프로젝트 ID
    }
}