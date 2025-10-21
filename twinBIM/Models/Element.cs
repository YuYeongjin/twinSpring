using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization; 

namespace BimProcessorApi.Models
{
    [Table("bim_element")]
    public class Element
    {
        [Key]
        [Column("element_id")]
        [JsonPropertyName("elementId")]
        public string ElementId { get; set; }

        [Column("project_id")]
        [JsonPropertyName("projectId")]
        public string ProjectId { get; set; }

        [Column("element_type")]
        [JsonPropertyName("elementType")] 
        public string ElementType { get; set; }

        [Column("material")]
        [JsonPropertyName("material")] 
        public string Material { get; set; }

        [Column("position_data", TypeName = "json")]
        [JsonPropertyName("positionData")]
        public string PositionData { get; set; }

        [Column("size_data", TypeName = "json")]
        [JsonPropertyName("sizeData")] 
        public string SizeData { get; set; }

        [ForeignKey("ProjectId")]
        [JsonIgnore]
        public Project Project { get; set; }
    }
}