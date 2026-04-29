using BimProcessorApi.Data;
using BimProcessorApi.Models;
using Microsoft.EntityFrameworkCore;

namespace BimProcessorApi.Services
{
    public class SimulationService
    {
        private readonly BimDbContext _context;

        // 관절 한계 각도 (도)
        private static readonly Dictionary<string, (double Min, double Max)> Limits = new()
        {
            ["BoomAngle"]   = (0,    80),
            ["ArmAngle"]    = (-20,  120),
            ["BucketAngle"] = (-90,  30),
        };

        // 링크 길이 (m) — 프론트엔드와 동일 값 사용
        private const double BoomLen   = 4.8;
        private const double ArmLen    = 3.2;
        private const double BucketLen = 0.75;
        private const double BoomPivotY = 2.1; // 지면에서 붐 피벗까지 높이

        public SimulationService(BimDbContext context)
        {
            _context = context;
        }

        public async Task EnsureTableAsync()
        {
            await _context.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS simulation_excavator (
                    excavator_id   VARCHAR(50)    NOT NULL PRIMARY KEY,
                    position_x     DOUBLE         NOT NULL DEFAULT 0,
                    position_y     DOUBLE         NOT NULL DEFAULT 0,
                    position_z     DOUBLE         NOT NULL DEFAULT 0,
                    body_rotation  DOUBLE         NOT NULL DEFAULT 0,
                    swing_angle    DOUBLE         NOT NULL DEFAULT 0,
                    boom_angle     DOUBLE         NOT NULL DEFAULT 35,
                    arm_angle      DOUBLE         NOT NULL DEFAULT 60,
                    bucket_angle   DOUBLE         NOT NULL DEFAULT -20,
                    operation_mode VARCHAR(30)    NOT NULL DEFAULT 'IDLE',
                    soil_in_bucket DOUBLE         NOT NULL DEFAULT 0,
                    height_map_data MEDIUMTEXT    NULL,
                    updated_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            ");
            // 기존 테이블에 컬럼이 없을 경우 추가 (MySQL은 IF NOT EXISTS 미지원으로 try-catch)
            try { await _context.Database.ExecuteSqlRawAsync("ALTER TABLE simulation_excavator ADD COLUMN soil_in_bucket DOUBLE NOT NULL DEFAULT 0"); } catch { }
            try { await _context.Database.ExecuteSqlRawAsync("ALTER TABLE simulation_excavator ADD COLUMN height_map_data MEDIUMTEXT NULL"); } catch { }
        }

        public async Task<ExcavatorState> GetStateAsync(string excavatorId = "EX-001")
        {
            var state = await _context.ExcavatorStates
                .FirstOrDefaultAsync(e => e.ExcavatorId == excavatorId);

            if (state == null)
            {
                state = new ExcavatorState { ExcavatorId = excavatorId };
                _context.ExcavatorStates.Add(state);
                await _context.SaveChangesAsync();
            }
            return state;
        }

        public async Task<ExcavatorState> UpdateStateAsync(ExcavatorState newState)
        {
            newState.BoomAngle   = Clamp(newState.BoomAngle,   Limits["BoomAngle"]);
            newState.ArmAngle    = Clamp(newState.ArmAngle,    Limits["ArmAngle"]);
            newState.BucketAngle = Clamp(newState.BucketAngle, Limits["BucketAngle"]);
            newState.UpdatedAt   = DateTime.UtcNow;

            var existing = await _context.ExcavatorStates
                .FirstOrDefaultAsync(e => e.ExcavatorId == newState.ExcavatorId);

            if (existing == null)
            {
                _context.ExcavatorStates.Add(newState);
                await _context.SaveChangesAsync();
                return newState;
            }

            existing.PositionX     = newState.PositionX;
            existing.PositionY     = newState.PositionY;
            existing.PositionZ     = newState.PositionZ;
            existing.BodyRotation  = newState.BodyRotation;
            existing.SwingAngle    = newState.SwingAngle;
            existing.BoomAngle     = newState.BoomAngle;
            existing.ArmAngle      = newState.ArmAngle;
            existing.BucketAngle   = newState.BucketAngle;
            existing.OperationMode = newState.OperationMode;
            existing.SoilInBucket  = newState.SoilInBucket;
            existing.HeightMapData = newState.HeightMapData;
            existing.UpdatedAt     = newState.UpdatedAt;

            await _context.SaveChangesAsync();
            return existing;
        }

        public KinematicsResult CalculateKinematics(ExcavatorState s)
        {
            const double Deg2Rad = Math.PI / 180.0;

            double boomRad   = s.BoomAngle * Deg2Rad;
            double armRad    = s.ArmAngle  * Deg2Rad;
            double bucketRad = s.BucketAngle * Deg2Rad;
            double swingRad  = s.SwingAngle * Deg2Rad;

            // 붐 끝 (붐 피벗 기준 로컬 Z-Y 평면)
            double boomTipZ = BoomLen * Math.Cos(boomRad);
            double boomTipY = BoomLen * Math.Sin(boomRad);

            // 암 끝 (붐 끝 기준 상대 각도)
            double armAbsRad = boomRad - armRad; // 암은 붐에서 아래쪽으로
            double armTipZ = boomTipZ + ArmLen * Math.Cos(armAbsRad);
            double armTipY = boomTipY - ArmLen * Math.Sin(armAbsRad);

            // 버킷 끝
            double bucketAbsRad = armAbsRad - bucketRad;
            double bucketTipZ = armTipZ + BucketLen * Math.Cos(bucketAbsRad);
            double bucketTipY = armTipY - BucketLen * Math.Sin(bucketAbsRad);

            // 선회(swing) + 차체 위치 적용
            double cosSwing = Math.Cos(swingRad);
            double sinSwing = Math.Sin(swingRad);

            double worldX = s.PositionX + sinSwing * bucketTipZ;
            double worldY = s.PositionY + BoomPivotY + bucketTipY;
            double worldZ = s.PositionZ + cosSwing * bucketTipZ;

            double reach = Math.Sqrt(bucketTipZ * bucketTipZ);
            double depth = Math.Max(0, -(worldY));

            return new KinematicsResult
            {
                BucketTipX    = Math.Round(worldX, 3),
                BucketTipY    = Math.Round(worldY, 3),
                BucketTipZ    = Math.Round(worldZ, 3),
                ReachDistance = Math.Round(reach, 3),
                ExcavationDepth = Math.Round(depth, 3),
            };
        }

        public async Task<ExcavatorState> ResetAsync(string excavatorId = "EX-001")
        {
            return await UpdateStateAsync(new ExcavatorState
            {
                ExcavatorId   = excavatorId,
                PositionX     = 0, PositionY = 0, PositionZ = 0,
                BodyRotation  = 0, SwingAngle = 0,
                BoomAngle     = 35, ArmAngle = 60, BucketAngle = -20,
                OperationMode = "IDLE",
            });
        }

        private static double Clamp(double v, (double Min, double Max) lim)
            => Math.Max(lim.Min, Math.Min(lim.Max, v));
    }

    public class KinematicsResult
    {
        public double BucketTipX      { get; set; }
        public double BucketTipY      { get; set; }
        public double BucketTipZ      { get; set; }
        public double ReachDistance   { get; set; }
        public double ExcavationDepth { get; set; }
    }
}
