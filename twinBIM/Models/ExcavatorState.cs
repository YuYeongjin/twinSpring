using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace BimProcessorApi.Models
{
    [Table("simulation_excavator")]
    public class ExcavatorState
    {
        [Key]
        [Column("excavator_id")]
        [JsonPropertyName("excavatorId")]
        public string ExcavatorId { get; set; } = "EX-001";

        [Column("position_x")]
        [JsonPropertyName("positionX")]
        public double PositionX { get; set; } = 0.0;

        [Column("position_y")]
        [JsonPropertyName("positionY")]
        public double PositionY { get; set; } = 0.0;

        [Column("position_z")]
        [JsonPropertyName("positionZ")]
        public double PositionZ { get; set; } = 0.0;

        [Column("body_rotation")]
        [JsonPropertyName("bodyRotation")]
        public double BodyRotation { get; set; } = 0.0;

        [Column("swing_angle")]
        [JsonPropertyName("swingAngle")]
        public double SwingAngle { get; set; } = 0.0;

        [Column("boom_angle")]
        [JsonPropertyName("boomAngle")]
        public double BoomAngle { get; set; } = 35.0;

        [Column("arm_angle")]
        [JsonPropertyName("armAngle")]
        public double ArmAngle { get; set; } = 60.0;

        [Column("bucket_angle")]
        [JsonPropertyName("bucketAngle")]
        public double BucketAngle { get; set; } = -20.0;

        [Column("operation_mode")]
        [JsonPropertyName("operationMode")]
        public string OperationMode { get; set; } = "IDLE";

        [Column("soil_in_bucket")]
        [JsonPropertyName("soilInBucket")]
        public double SoilInBucket { get; set; } = 0.0;

        [Column("height_map_data")]
        [JsonPropertyName("heightMapData")]
        public string? HeightMapData { get; set; } = null;

        [Column("updated_at")]
        [JsonPropertyName("updatedAt")]
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
