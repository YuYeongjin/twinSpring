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

        [Column("position_x")]
        [JsonPropertyName("positionX")]
        public double? PositionX { get; set; }

        [Column("position_y")]
        [JsonPropertyName("positionY")]
        public double? PositionY { get; set; }

        [Column("position_z")]
        [JsonPropertyName("positionZ")]
        public double? PositionZ { get; set; }

        [Column("size_x")]
        [JsonPropertyName("sizeX")]
        public double? SizeX { get; set; }

        [Column("size_y")]
        [JsonPropertyName("sizeY")]
        public double? SizeY { get; set; }

        [Column("size_z")]
        [JsonPropertyName("sizeZ")]
        public double? SizeZ { get; set; }

        [ForeignKey("ProjectId")]
        [JsonIgnore]
        public Project? Project { get; set; }
    }
}