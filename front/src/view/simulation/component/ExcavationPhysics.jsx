/**
 * ExcavationPhysics.jsx
 *
 * C# BEPUphysics2 기반 안정성 평가 API를 폴링하여 React Three.js 씬에
 * 물리 피드백(진동/전도 경고)을 적용한다.
 *
 * @react-three/rapier 를 사용해:
 *   - TerrainRapierCollider : 변형 지형을 Heightfield 콜라이더로 등록
 *   - ExcavatorCollider     : 굴착기 충돌 프록시 (CuboidCollider)
 *   - usePhysicsEvaluation  : C# 물리 API 폴링 훅 (500ms)
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { RigidBody, CuboidCollider, HeightfieldCollider } from '@react-three/rapier';
import axios from 'axios';

// C# BIM 서버 (twinBIM, port 5112)
const BIM_API = axios.create({
  baseURL: process.env.NODE_ENV === 'development' ? 'http://localhost:5112' : '',
  timeout: 2000,
});

// ── 지형 상수 (SimulationDashboard와 동일) ───────────────────────────────────
const GRID_COLS = 80;
const GRID_ROWS = 80;
const CELL_M    = 1.0;
const HALF_C    = GRID_COLS / 2;
const HALF_R    = GRID_ROWS / 2;

function sampleH(hm, wx, wz) {
  const fx = wx + HALF_C - 0.5;
  const fz = wz + HALF_R - 0.5;
  const c0 = Math.floor(fx), r0 = Math.floor(fz);
  const tx = fx - c0, tz = fz - r0;
  function gh(c, r) {
    if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return 0;
    return hm[r * GRID_COLS + c];
  }
  return gh(c0,r0)*(1-tx)*(1-tz) + gh(c0+1,r0)*tx*(1-tz)
       + gh(c0,r0+1)*(1-tx)*tz   + gh(c0+1,r0+1)*tx*tz;
}

function vertH(hm, c, r) {
  let s = 0, n = 0;
  for (let dc = -1; dc <= 0; dc++) {
    for (let dr = -1; dr <= 0; dr++) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && cc < GRID_COLS && rr >= 0 && rr < GRID_ROWS) {
        s += hm[rr * GRID_COLS + cc]; n++;
      }
    }
  }
  return n ? s / n : 0;
}

// ── usePhysicsEvaluation 훅 ────────────────────────────────────────────────
/**
 * C# BEPUphysics2 API를 500ms 간격으로 폴링한다.
 * 결과(PhysicsResult)를 state로 반환하고, wobbleRef를 실시간 업데이트한다.
 *
 * @param stateRef      - 굴착기 상태 ref
 * @param machineRef    - 장비 사양 ref
 * @param kinematicsRef - 버킷 끝 위치 ref (굴착 반력 계산)
 * @param heightMapRef  - 지형 heightmap ref (경사 계산)
 * @param wobbleRef     - ExcavatorModel에 진동 파라미터를 전달하는 ref
 */
export function usePhysicsEvaluation(stateRef, machineRef, kinematicsRef, heightMapRef, wobbleRef) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const s  = stateRef.current;
        const m  = machineRef.current;
        const km = kinematicsRef.current;
        const hm = heightMapRef.current;

        // 굴착기 위치에서 지형 경사 계산
        const dx = 2.0;
        const hFwd = sampleH(hm, s.positionX, s.positionZ + dx);
        const hBwd = sampleH(hm, s.positionX, s.positionZ - dx);
        const hRht = sampleH(hm, s.positionX + dx, s.positionZ);
        const hLft = sampleH(hm, s.positionX - dx, s.positionZ);
        const terrainPitch = Math.atan2(hFwd - hBwd, 2 * dx);
        const terrainRoll  = Math.atan2(hRht - hLft, 2 * dx);

        // 굴착 깊이 → 버킷 반력 추정 (최대 30kN)
        const depth = km ? parseFloat(km.depth ?? 0) : 0;
        const bucketForce = Math.min(depth * 8000, 30000);

        const res = await BIM_API.post('/api/simulation/physics/evaluate', {
          state: s,
          machineId: m.id,
          terrainPitch,
          terrainRoll,
          bucketForce,
        });

        const r = res.data;
        setResult(r);

        // wobbleRef 업데이트 (3D 애니메이션 직접 구동)
        if (wobbleRef?.current) {
          wobbleRef.current.amplitude  = r.wobbleAmplitude  ?? 0;
          wobbleRef.current.frequency  = r.wobbleFrequency  ?? 2.5;
          wobbleRef.current.dirX       = r.tipDirectionX    ?? 0;
          wobbleRef.current.dirZ       = r.tipDirectionZ    ?? 1;
          wobbleRef.current.dangerLevel = r.dangerLevel     ?? 'SAFE';
        }
      } catch {
        // 서버 미접속 시 경고 없이 무시
      }
    }, 500);

    return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}

// ── TerrainRapierCollider ─────────────────────────────────────────────────
/**
 * heightMap → rapier HeightfieldCollider
 * version prop이 변경될 때마다 높이 데이터를 재빌드한다 (key 변경).
 */
export function TerrainRapierCollider({ heightMapRef, version }) {
  const heights = useMemo(() => {
    const hm = heightMapRef.current;
    // rapier heightfield: (GRID_ROWS+1) * (GRID_COLS+1) 개 꼭짓점 높이 필요
    const vC  = GRID_COLS + 1;
    const vR  = GRID_ROWS + 1;
    const arr = new Float32Array(vC * vR);
    for (let r = 0; r <= GRID_ROWS; r++) {
      for (let c = 0; c <= GRID_COLS; c++) {
        // rapier의 row=i → X축, col=j → Z축 순서
        arr[c * vR + r] = vertH(hm, c, r);
      }
    }
    return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return (
    <RigidBody key={version} type="fixed" colliders={false} position={[0, 0, 0]}>
      <HeightfieldCollider
        args={[
          GRID_ROWS,   // nrows
          GRID_COLS,   // ncols
          heights,
          // scale: 전체 월드 크기 (80m × 높이 × 80m)
          { x: GRID_COLS * CELL_M, y: 1, z: GRID_ROWS * CELL_M },
        ]}
      />
    </RigidBody>
  );
}

// ── ExcavatorCollider ─────────────────────────────────────────────────────
/**
 * 굴착기 하부 차체에 해당하는 충돌 프록시 (CuboidCollider).
 * 매 프레임 굴착기 위치와 동기화하여 지형과의 충돌을 감지한다.
 */
export function ExcavatorCollider({ stateRef, machine }) {
  const rbRef = useRef(null);
  const bs    = machine.bodyScale;

  // useFrame은 @react-three/fiber가 필요하므로 여기서는 setInterval로 대체
  useEffect(() => {
    const id = setInterval(() => {
      const rb = rbRef.current;
      if (!rb) return;
      const s = stateRef.current;
      // rapier kinematic position 업데이트
      rb.setNextKinematicTranslation({
        x: s.positionX,
        y: s.positionY + 0.5 * bs,
        z: s.positionZ,
      });
    }, 16); // ~60fps
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RigidBody ref={rbRef} type="kinematicPosition" colliders={false}>
      <CuboidCollider
        args={[2.1 * bs, 0.5 * bs, 2.75 * bs]}
      />
    </RigidBody>
  );
}
