using System.Text.Json.Serialization;

namespace BimProcessorApi.Models
{
    public class PhysicsRequest
    {
        [JsonPropertyName("state")]
        public ExcavatorState State { get; set; } = new();

        [JsonPropertyName("machineId")]
        public string MachineId { get; set; } = "0.6W";

        // 굴착기 위치의 지형 경사 (라디안) - 전후 기울기
        [JsonPropertyName("terrainPitch")]
        public double TerrainPitch { get; set; } = 0;

        // 지형 경사 - 좌우 기울기
        [JsonPropertyName("terrainRoll")]
        public double TerrainRoll { get; set; } = 0;

        // 버킷 굴착 반력 (N) - 굴착 깊이에서 추정
        [JsonPropertyName("bucketForce")]
        public double BucketForce { get; set; } = 0;
    }

    public class PhysicsResult
    {
        // SAFE / WARNING / DANGER
        [JsonPropertyName("dangerLevel")]
        public string DangerLevel { get; set; } = "SAFE";

        // 1.0 = 완전 안정, 0.0 = 전도 임박, 음수 = 전도 중
        [JsonPropertyName("stabilityMargin")]
        public double StabilityMargin { get; set; } = 1.0;

        // React 3D 진동 파라미터
        [JsonPropertyName("wobbleAmplitude")]
        public double WobbleAmplitude { get; set; } = 0.0;  // 라디안

        [JsonPropertyName("wobbleFrequency")]
        public double WobbleFrequency { get; set; } = 2.5;  // Hz

        // 복합 무게중심 좌표 (장비 로컬 프레임)
        [JsonPropertyName("comX")]
        public double ComX { get; set; }

        [JsonPropertyName("comY")]
        public double ComY { get; set; }

        [JsonPropertyName("comZ")]
        public double ComZ { get; set; }

        // ZMP → 전도 방향 (정규화 수평 벡터)
        [JsonPropertyName("tipDirectionX")]
        public double TipDirectionX { get; set; }

        [JsonPropertyName("tipDirectionZ")]
        public double TipDirectionZ { get; set; }

        [JsonPropertyName("alerts")]
        public string[] Alerts { get; set; } = Array.Empty<string>();
    }
}
