using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace BimProcessorApi.Models
{
    [Table("bim_element")]
    public class Element
    {
        [Key]
        [Column("element_id")]
        public string ElementId { get; set; }

        [Column("project_id")]
        public string ProjectId { get; set; } // Foreign Key

        [Column("element_type")]
        public string ElementType { get; set; }

        [Column("material")]
        public string Material { get; set; }

        [Column("position_data", TypeName = "json")] // MySQL JSON 타입 매핑
        public string PositionData { get; set; }

        [Column("size_data", TypeName = "json")] // MySQL JSON 타입 매핑
        public string SizeData { get; set; }
        
        // 탐색 속성: 부모 Project
        [ForeignKey("ProjectId")]
        public Project Project { get; set; }
    }
}