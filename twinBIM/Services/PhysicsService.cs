using BepuPhysics;
using BepuPhysics.Collidables;
using BepuPhysics.CollisionDetection;
using BepuPhysics.Constraints;
using BepuUtilities;
using BepuUtilities.Memory;
using System.Numerics;
using BimProcessorApi.Models;

namespace BimProcessorApi.Services
{
    // ── BEPUphysics2 콜백 구현 ────────────────────────────────────────────────────
    // CompoundBuilder로 무게중심만 계산하므로 시뮬레이션 스텝을 실행하지 않음.
    // 콜백은 인터페이스 충족용으로만 존재한다.

    struct NullNarrowPhaseCallbacks : INarrowPhaseCallbacks
    {
        public void Initialize(Simulation simulation) { }
        public bool AllowContactGeneration(int workerIndex, CollidableReference a, CollidableReference b, ref float speculativeMargin) => false;
        // v2.4: 두 번째 오버로드는 CollidablePair 사용
        public bool AllowContactGeneration(int workerIndex, CollidablePair pair, int childIndexA, int childIndexB) => false;
        public bool ConfigureContactManifold<TManifold>(
            int workerIndex, CollidablePair pair, ref TManifold manifold, out PairMaterialProperties pairMaterial)
            where TManifold : unmanaged, IContactManifold<TManifold>
        { pairMaterial = default; return false; }
        public bool ConfigureContactManifold(int workerIndex, CollidablePair pair, int childIndexA, int childIndexB, ref ConvexContactManifold manifold) => false;
        public void Dispose() { }
    }

    struct NullPoseIntegratorCallbacks : IPoseIntegratorCallbacks
    {
        public AngularIntegrationMode AngularIntegrationMode => AngularIntegrationMode.Nonconserving;
        public bool AllowSubstepsForUnconstrainedBodies => false;
        public bool IntegrateVelocityForKinematics => false;
        public void Initialize(Simulation simulation) { }
        public void PrepareForIntegration(float dt) { }
        public void IntegrateVelocity(
            System.Numerics.Vector<int> bodyIndices,
            BepuUtilities.Vector3Wide position,
            BepuUtilities.QuaternionWide orientation,
            BepuPhysics.BodyInertiaWide localInertia,
            System.Numerics.Vector<int> integrationMask,
            int workerIndex,
            System.Numerics.Vector<float> dt,
            ref BepuPhysics.BodyVelocityWide velocity) { }
    }

    // ── PhysicsService ────────────────────────────────────────────────────────────
    public class PhysicsService
    {
        // React MACHINE_CONFIGS와 동일한 장비 사양
        // (bodyScale, boomLen, armLen, bucketLen, totalMassKg)
        private static readonly Dictionary<string, (float bs, float bl, float al, float bkl, float mass)> Specs = new()
        {
            ["0.3W"] = (0.55f, 2.8f,  1.4f, 0.48f, 4500f),
            ["0.6W"] = (0.78f, 4.8f,  2.8f, 0.68f, 15000f),
            ["1W"]   = (1.0f,  6.0f,  3.8f, 0.85f, 25000f),
        };

        private const float G = 9.81f;
        private const float D2R = MathF.PI / 180f;

        public PhysicsResult Evaluate(PhysicsRequest req)
        {
            var s = req.State;
            if (!Specs.TryGetValue(req.MachineId, out var spec))
                spec = Specs["0.6W"];

            var (bs, boomLen, armLen, bucketLen, totalMass) = spec;

            // ── 1. BEPUphysics2 CompoundBuilder로 복합 형체 무게중심 계산 ──────────
            var pool = new BufferPool();
            Vector3 comLocal;

            try
            {
                var simulation = Simulation.Create(
                    pool,
                    new NullNarrowPhaseCallbacks(),
                    new NullPoseIntegratorCallbacks(),
                    new SolveDescription(1, 1));

                try
                {
                    comLocal = BuildCompoundCoM(simulation, pool, s, bs, boomLen, armLen, bucketLen, totalMass);
                }
                finally
                {
                    simulation.Dispose();
                }
            }
            finally
            {
                pool.Clear();
            }

            // ── 2. ZMP(영 모멘트 점) 계산 ────────────────────────────────────────
            // 지형 경사 보정: 경사가 있으면 중력 수평 성분이 ZMP를 이동시킴
            double pitch = req.TerrainPitch;  // 전후 경사 (rad)
            double roll  = req.TerrainRoll;   // 좌우 경사 (rad)

            double zmpX = comLocal.X - comLocal.Y * Math.Tan(roll);
            double zmpZ = comLocal.Z - comLocal.Y * Math.Tan(pitch);

            // 버킷 굴착 반력이 ZMP를 버킷 방향으로 이동
            // 버킷 끝의 수평 투영 좌표를 근사: swing 방향으로 (reach ≈ armLen + boomLen 절반)
            double swingRad = s.SwingAngle * D2R;
            double boomRad  = s.BoomAngle  * D2R;
            double armAbsRad = boomRad - s.ArmAngle * D2R;
            double reach = boomLen * Math.Cos(boomRad) + armLen * Math.Cos(armAbsRad);
            double bucketTipX = Math.Sin(swingRad) * reach;
            double bucketTipZ = Math.Cos(swingRad) * reach;

            // 반력 모멘트 → ZMP 이동량 (F * r / (m * g))
            double forceShift = req.BucketForce * reach / (totalMass * G);
            zmpX += Math.Sin(swingRad) * forceShift;
            zmpZ += Math.Cos(swingRad) * forceShift;

            // ── 3. 지지 다각형(트랙 풋프린트) 안정성 판정 ───────────────────────
            double tHX = 2.1 * bs;   // 트랙 절반 폭 (좌우)
            double tHZ = 2.75 * bs;  // 트랙 절반 길이 (전후)

            // 정규화 여유 거리: 1.0 = 중심, 0.0 = 경계, 음수 = 경계 밖
            double marginX = 1.0 - Math.Abs(zmpX) / tHX;
            double marginZ = 1.0 - Math.Abs(zmpZ) / tHZ;
            double margin   = Math.Min(marginX, marginZ);

            // ── 4. 위험 등급 및 진동 파라미터 산출 ──────────────────────────────
            string dangerLevel;
            double wobbleAmp;
            double wobbleFreq;
            var alerts = new List<string>();

            if (margin > 0.30)
            {
                dangerLevel = "SAFE";
                wobbleAmp   = 0.0;
                wobbleFreq  = 2.5;
            }
            else if (margin > 0.05)
            {
                dangerLevel = "WARNING";
                // 여유가 0.30 → 0.05 범위: 진동 0 → 0.025 rad
                wobbleAmp   = (0.30 - margin) / 0.25 * 0.025;
                wobbleFreq  = 2.5 + (0.30 - margin) * 3.0;
                alerts.Add($"Relaxation {margin * 100:F0}% — Check equipment movement/posture");
            }
            else
            {
                dangerLevel = "DANGER";
                wobbleAmp   = 0.025 + Math.Abs(Math.Min(0, margin)) * 0.08;
                wobbleFreq  = 5.0;
                alerts.Add("⚠ Dangers of falling! Stop working immediately and move the equipment to a safe position");
                if (Math.Abs(zmpX) > tHX) alerts.Add($"Left and right instability ({(zmpX > 0 ? "right" : "left")} risk of falling)");
                if (Math.Abs(zmpZ) > tHZ) alerts.Add($"Front-back instability ({(zmpZ > 0 ? "Front" : "Rear")} risk of falling)");
            }

            // 전도 방향 벡터 (정규화)
            double tipX = zmpX / tHX;
            double tipZ = zmpZ / tHZ;
            double tipLen = Math.Sqrt(tipX * tipX + tipZ * tipZ);
            if (tipLen > 0.001) { tipX /= tipLen; tipZ /= tipLen; }

            return new PhysicsResult
            {
                DangerLevel      = dangerLevel,
                StabilityMargin  = Math.Round(Math.Clamp(margin, -1.0, 1.0), 3),
                WobbleAmplitude  = Math.Round(Math.Clamp(wobbleAmp,  0, 0.15), 4),
                WobbleFrequency  = Math.Round(wobbleFreq, 2),
                ComX             = Math.Round(comLocal.X, 3),
                ComY             = Math.Round(comLocal.Y, 3),
                ComZ             = Math.Round(comLocal.Z, 3),
                TipDirectionX    = Math.Round(tipX, 3),
                TipDirectionZ    = Math.Round(tipZ, 3),
                Alerts           = alerts.ToArray(),
            };
        }

        // ── BEPUphysics2 CompoundBuilder로 복합 형체 무게중심 계산 ─────────────────
        // 각 링크(하부/상부/붐/암/버킷)를 질량 가중 Box로 표현하고
        // BuildDynamicCompound → center 를 통해 합성 CoM을 얻는다.
        private static Vector3 BuildCompoundCoM(
            Simulation sim, BufferPool pool,
            ExcavatorState s, float bs, float boomLen, float armLen, float bucketLen, float totalMass)
        {
            float swingRad     = (float)s.SwingAngle  * D2R;
            float boomRad      = (float)s.BoomAngle   * D2R;
            float armAbsRad    = boomRad - (float)s.ArmAngle   * D2R;
            float bucketAbsRad = armAbsRad - (float)s.BucketAngle * D2R;

            var swingQ = Quaternion.CreateFromAxisAngle(Vector3.UnitY, swingRad);

            // 질량 배분: 하부 40 / 상부+카운터웨이트 35 / 붐 12 / 암 8 / 버킷 5 %
            float mL  = totalMass * 0.40f;
            float mU  = totalMass * 0.35f;
            float mBm = totalMass * 0.12f;
            float mAr = totalMass * 0.08f;
            float mBk = totalMass * 0.05f;

            using var builder = new CompoundBuilder(pool, sim.Shapes, 6);

            // ① 하부 차체 (트랙 포함) — 선회 없음
            builder.Add(
                new Box(3.9f * bs, 0.72f * bs, 5.4f * bs),
                new RigidPose(new Vector3(0, 0.36f * bs, 0)),
                mL);

            // ② 상부 선회체 (카운터웨이트 포함) — swingAngle로 회전
            var upperLocal = new Vector3(0, 0.72f * bs, -0.3f * bs); // 카운터웨이트로 무게중심 약간 후방
            var upperWorld = new Vector3(0, 0.72f * bs, 0)
                + Vector3.Transform(upperLocal, swingQ);
            builder.Add(
                new Box(3.3f * bs, 1.44f * bs, 4.5f * bs),
                new RigidPose(upperWorld, swingQ),
                mU);

            // ③ 붐 — 붐 피벗 (스케일 공간 [0, 1.4*bs, 1.9*bs]) 기준으로 계산
            var boomPivotLocal = new Vector3(0, 1.4f * bs, 1.9f * bs);
            var boomPivotWorld = new Vector3(0, 0.72f * bs, 0)
                + Vector3.Transform(boomPivotLocal, swingQ);
            var boomDirLocal = new Vector3(0, MathF.Sin(boomRad), MathF.Cos(boomRad));
            var boomDirWorld = Vector3.Transform(boomDirLocal, swingQ);
            var boomCoM      = boomPivotWorld + boomDirWorld * (boomLen * 0.5f);
            var boomQ        = Quaternion.Normalize(swingQ * Quaternion.CreateFromAxisAngle(Vector3.UnitX, -boomRad));
            builder.Add(
                new Box(0.58f * bs, 0.58f * bs, boomLen),
                new RigidPose(boomCoM, boomQ),
                mBm);

            // ④ 암
            var armPivotWorld = boomPivotWorld + boomDirWorld * boomLen;
            var armDirLocal   = new Vector3(0, MathF.Sin(armAbsRad), MathF.Cos(armAbsRad));
            var armDirWorld   = Vector3.Transform(armDirLocal, swingQ);
            var armCoM        = armPivotWorld + armDirWorld * (armLen * 0.5f);
            var armQ          = Quaternion.Normalize(swingQ * Quaternion.CreateFromAxisAngle(Vector3.UnitX, -armAbsRad));
            builder.Add(
                new Box(0.44f * bs, 0.44f * bs, armLen),
                new RigidPose(armCoM, armQ),
                mAr);

            // ⑤ 버킷
            var bucketPivotWorld = armPivotWorld + armDirWorld * armLen;
            var bucketDirLocal   = new Vector3(0, MathF.Sin(bucketAbsRad), MathF.Cos(bucketAbsRad));
            var bucketDirWorld   = Vector3.Transform(bucketDirLocal, swingQ);
            var bucketCoM        = bucketPivotWorld + bucketDirWorld * (bucketLen * 0.5f);
            var bucketQ          = Quaternion.Normalize(swingQ * Quaternion.CreateFromAxisAngle(Vector3.UnitX, -bucketAbsRad));
            builder.Add(
                new Box(1.38f * bs, 0.78f * bs, bucketLen * 1.05f),
                new RigidPose(bucketCoM, bucketQ),
                mBk);

            // BEPUphysics2가 복합 형체 CoM을 계산하여 center에 반환
            builder.BuildDynamicCompound(out var children, out _, out var center);
            pool.Return(ref children);

            return center;
        }
    }
}
