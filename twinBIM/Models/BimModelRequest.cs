
using System.Collections.Generic;

namespace BimProcessorApi.Models
{
    public class BimModelRequest
    {
        // 프로젝트 메타데이터
        public Project Project { get; set; }
        
        // 부재 요소 목록
        public List<Element> Elements { get; set; }
    }
}