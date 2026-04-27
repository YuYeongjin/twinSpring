import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  OrbitControls, Grid, Sky, GizmoHelper, GizmoViewport, Html
} from '@react-three/drei';
import * as THREE from 'three';
import AxiosCustom from '../../axios/AxiosCustom';

// ── 상수 정의 ─────────────────────────────────────────────────────────────────

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const JOINT_LIMITS = {
  boomAngle:   { min: 0,    max: 80  },
  armAngle:    { min: -20,  max: 120 },
  bucketAngle: { min: -90,  max: 30  },
};

const DEFAULT_STATE = {
  excavatorId: 'EX-001',
  positionX: 0, positionY: 0, positionZ: 0,
  bodyRotation: 0,
  swingAngle: 0,
  boomAngle: 35,
  armAngle: 60,
  bucketAngle: -25,
  operationMode: 'IDLE',
};

// 작업 프리셋 — 순기구학 검증값
// DIG: boomPivotY(2.12) + 4.8×sin5° + 3.2×sin(5°-100°) ≈ -0.65m (지면 아래)
const PRESETS = {
  IDLE:   { boomAngle: 35,  armAngle: 60,  bucketAngle: -25, swingAngle: 0  },
  DIG:    { boomAngle: 5,   armAngle: 100, bucketAngle: 10,  swingAngle: 0  },
  DUMP:   { boomAngle: 65,  armAngle: 20,  bucketAngle: -80, swingAngle: 90 },
  TRAVEL: { boomAngle: 20,  armAngle: 60,  bucketAngle: -30, swingAngle: 0  },
};

const PRESET_LABELS = {
  IDLE: '대기',
  DIG:  '굴착',
  DUMP: '덤핑',
  TRAVEL: '이동',
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── 굴착기 3D 모델 ─────────────────────────────────────────────────────────────
//
// 계층 구조:
//   ExcavatorGroup  (차체 위치 + bodyRotation)
//   ├─ 하부 차체 (undercarriage)
//   │   ├─ 메인 박스
//   │   ├─ 좌측 트랙
//   │   ├─ 우측 트랙
//   │   └─ 롤러 (실린더)
//   └─ 상부 선회체 (Y축 swingAngle 회전)
//       ├─ 본체 / 캡 / 카운터웨이트
//       └─ 붐 피벗 그룹 (X축 -boomAngle 회전)
//           └─ 붐 박스
//           └─ 암 피벗 그룹 (X축 -armAngle 회전)
//               └─ 암 박스
//               └─ 버킷 피벗 그룹 (X축 +bucketAngle 회전)
//                   └─ 버킷 + 이빨

const BOOM_LEN   = 4.8;
const ARM_LEN    = 3.2;
const BOOM_PIVOT = [0, 1.4, 1.9]; // 상부 본체 로컬 좌표

function TrackRollers({ side }) {
  const x = side === 'left' ? -2.1 : 2.1;
  return (
    <>
      {[-2.2, -1.1, 0, 1.1, 2.2].map((z, i) => (
        <mesh key={i} position={[x, 0.04, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.27, 0.27, 0.52, 10]} />
          <meshStandardMaterial color="#1c1c1c" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
    </>
  );
}

function ExcavatorModel({ state }) {
  return (
    <group
      position={[state.positionX, 0, state.positionZ]}
      rotation={[0, state.bodyRotation * D2R, 0]}
    >
      {/* ── 하부 차체 ── */}
      <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.9, 0.72, 5.4]} />
        <meshStandardMaterial color="#3b4228" roughness={0.85} metalness={0.1} />
      </mesh>

      {/* 좌측 트랙 */}
      <mesh position={[-2.1, 0.37, 0]} castShadow>
        <boxGeometry args={[0.62, 0.60, 5.85]} />
        <meshStandardMaterial color="#191919" roughness={0.95} />
      </mesh>
      {/* 우측 트랙 */}
      <mesh position={[2.1, 0.37, 0]} castShadow>
        <boxGeometry args={[0.62, 0.60, 5.85]} />
        <meshStandardMaterial color="#191919" roughness={0.95} />
      </mesh>

      <TrackRollers side="left" />
      <TrackRollers side="right" />

      {/* 전면 아이들러 (구동 휠) */}
      {[-1, 1].map((sx, i) => (
        <mesh key={i} position={[sx * 2.1, 0.37, 2.75]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.32, 0.32, 0.55, 12]} />
          <meshStandardMaterial color="#2a2a2a" metalness={0.6} />
        </mesh>
      ))}
      {/* 후면 스프로킷 */}
      {[-1, 1].map((sx, i) => (
        <mesh key={i} position={[sx * 2.1, 0.37, -2.75]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.34, 0.34, 0.55, 12]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>
      ))}

      {/* ── 상부 선회체 (swingAngle Y 회전) ── */}
      <group
        position={[0, 0.72, 0]}
        rotation={[0, state.swingAngle * D2R, 0]}
      >
        {/* 본체 플랫폼 */}
        <mesh position={[0, 0.72, 0.1]} castShadow receiveShadow>
          <boxGeometry args={[3.3, 1.44, 4.0]} />
          <meshStandardMaterial color="#f5a623" roughness={0.52} metalness={0.22} />
        </mesh>

        {/* 운전석 캡 */}
        <mesh position={[-0.65, 1.92, -0.6]} castShadow>
          <boxGeometry args={[1.95, 1.85, 2.1]} />
          <meshStandardMaterial color="#f5a623" roughness={0.48} metalness={0.2} />
        </mesh>
        {/* 앞 유리 */}
        <mesh position={[-0.65, 2.05, 0.45]}>
          <boxGeometry args={[1.75, 0.85, 0.06]} />
          <meshStandardMaterial color="#88ccff" transparent opacity={0.42} />
        </mesh>
        {/* 측면 유리 (우) */}
        <mesh position={[0.31, 2.05, -0.6]}>
          <boxGeometry args={[0.06, 0.7, 1.6]} />
          <meshStandardMaterial color="#88ccff" transparent opacity={0.38} />
        </mesh>

        {/* 카운터웨이트 */}
        <mesh position={[0.2, 0.7, -2.45]} castShadow>
          <boxGeometry args={[3.1, 0.95, 1.25]} />
          <meshStandardMaterial color="#282828" metalness={0.55} roughness={0.6} />
        </mesh>

        {/* 엔진 커버 */}
        <mesh position={[0.5, 1.35, -1.2]} castShadow>
          <boxGeometry args={[2.2, 0.8, 1.6]} />
          <meshStandardMaterial color="#e09010" roughness={0.55} />
        </mesh>

        {/* 선회 링 */}
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.4, 0.15, 8, 24]} />
          <meshStandardMaterial color="#444" metalness={0.8} />
        </mesh>

        {/* ── 붐 피벗 그룹 ── */}
        <group position={BOOM_PIVOT}>
          <group rotation={[-state.boomAngle * D2R, 0, 0]}>

            {/* 붐 */}
            <mesh position={[0, 0, BOOM_LEN / 2]} castShadow>
              <boxGeometry args={[0.58, 0.58, BOOM_LEN]} />
              <meshStandardMaterial color="#d48810" roughness={0.48} metalness={0.38} />
            </mesh>

            {/* 붐 유압 실린더 (시각적 장식) */}
            <mesh
              position={[-0.35, -0.32, BOOM_LEN * 0.38]}
              rotation={[0.32, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.11, 0.11, BOOM_LEN * 0.72, 8]} />
              <meshStandardMaterial color="#888" metalness={0.85} roughness={0.2} />
            </mesh>

            {/* ── 암 피벗 그룹 (붐 끝) ── */}
            {/* +armAngle: 0°=붐과 나란히, 90°=수직 아래, 120°=뒤로 꺾임 */}
            <group position={[0, 0, BOOM_LEN]}>
              <group rotation={[state.armAngle * D2R, 0, 0]}>

                {/* 암 */}
                <mesh position={[0, 0, ARM_LEN / 2]} castShadow>
                  <boxGeometry args={[0.44, 0.44, ARM_LEN]} />
                  <meshStandardMaterial color="#c07a0a" roughness={0.5} metalness={0.35} />
                </mesh>

                {/* 암 유압 실린더 — 암 아래쪽에 위치 */}
                <mesh
                  position={[-0.28, -0.3, ARM_LEN * 0.35]}
                  rotation={[0.18, 0, 0]}
                  castShadow
                >
                  <cylinderGeometry args={[0.09, 0.09, ARM_LEN * 0.75, 8]} />
                  <meshStandardMaterial color="#777" metalness={0.85} roughness={0.2} />
                </mesh>

                {/* ── 버킷 피벗 그룹 (암 끝) ── */}
                <group position={[0, 0, ARM_LEN]}>
                  <group rotation={[state.bucketAngle * D2R, 0, 0]}>

                    {/* 버킷 본체 */}
                    <mesh position={[0, -0.2, 0.38]} castShadow>
                      <boxGeometry args={[1.38, 0.78, 1.0]} />
                      <meshStandardMaterial color="#6a6a6a" metalness={0.68} roughness={0.38} />
                    </mesh>
                    {/* 버킷 뒷판 */}
                    <mesh position={[0, -0.06, -0.06]} castShadow>
                      <boxGeometry args={[1.38, 0.58, 0.13]} />
                      <meshStandardMaterial color="#5a5a5a" metalness={0.72} />
                    </mesh>
                    {/* 버킷 이빨 (4개) */}
                    {[-0.52, -0.18, 0.18, 0.52].map((x, i) => (
                      <mesh key={i} position={[x, -0.52, 0.8]} castShadow>
                        <boxGeometry args={[0.1, 0.14, 0.32]} />
                        <meshStandardMaterial color="#3a3a3a" metalness={0.88} />
                      </mesh>
                    ))}

                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

// ── 굴착 흔적 시각화 ───────────────────────────────────────────────────────────
// 버킷이 지면 아래에 있을 때 흙이 파인 흔적을 렌더링

function ExcavationMarks({ marks }) {
  if (!marks || marks.length === 0) return null;
  return (
    <>
      {marks.map((m, i) => (
        <group key={i} position={[m.x, 0, m.z]}>
          {/* 흙 교란 면 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[m.r, 14]} />
            <meshStandardMaterial color="#3a2208" roughness={1} />
          </mesh>
          {/* 파인 구덩이 */}
          <mesh position={[0, -m.depth / 2, 0]} receiveShadow>
            <cylinderGeometry args={[m.r * 0.75, m.r * 0.55, m.depth, 10]} />
            <meshStandardMaterial color="#261604" roughness={1} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ── 건설 현장 배경 ─────────────────────────────────────────────────────────────

function ConstructionSite({ bimElements }) {
  return (
    <>
      {/* 지면 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#7a6a4a" roughness={1.0} />
      </mesh>

      {/* 그리드 */}
      <Grid
        args={[150, 150]}
        cellSize={1}
        cellThickness={0.3}
        cellColor="#605848"
        sectionSize={10}
        sectionThickness={0.7}
        sectionColor="#8a7860"
        position={[0, 0.015, 0]}
        fadeDistance={100}
        fadeStrength={1.2}
      />

      {/* 굴착 구덩이 */}
      <mesh position={[16, -0.55, 6]} receiveShadow>
        <boxGeometry args={[12, 1.1, 10]} />
        <meshStandardMaterial color="#5a3a1a" roughness={1} />
      </mesh>
      {/* 굴착 구덩이 내부 바닥 */}
      <mesh position={[16, -1.05, 6]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11.8, 9.8]} />
        <meshStandardMaterial color="#4a2e10" roughness={1} />
      </mesh>

      {/* 토사 더미 */}
      <mesh position={[-12, 0.9, -10]} castShadow>
        <coneGeometry args={[3.2, 2.8, 10]} />
        <meshStandardMaterial color="#8a7050" roughness={0.95} />
      </mesh>
      <mesh position={[-14.5, 0.5, -7]} castShadow>
        <coneGeometry args={[2.0, 1.6, 8]} />
        <meshStandardMaterial color="#7a6040" roughness={0.95} />
      </mesh>

      {/* 공사 울타리 */}
      {Array.from({ length: 11 }, (_, i) => i - 5).map(i => (
        <group key={`fence_f${i}`} position={[i * 5, 0, -28]}>
          <mesh position={[0, 0.65, 0]} castShadow>
            <boxGeometry args={[0.1, 1.3, 0.1]} />
            <meshStandardMaterial color="#ff6600" />
          </mesh>
          {i < 10 && (
            <mesh position={[2.5, 0.9, 0]} castShadow>
              <boxGeometry args={[5, 0.06, 0.06]} />
              <meshStandardMaterial color="#ff6600" />
            </mesh>
          )}
        </group>
      ))}

      {/* 콘크리트 블록 (장애물) */}
      {[[8, 0.3, -8], [-6, 0.3, 12], [20, 0.3, -4]].map(([x, y, z], i) => (
        <mesh key={`block${i}`} position={[x, y, z]} castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.6, 1.2]} />
          <meshStandardMaterial color="#aaaaaa" roughness={0.7} />
        </mesh>
      ))}

      {/* BIM 프로젝트 부재 (반투명 표시) */}
      {bimElements && bimElements.map(el => {
        const px = (el.positionX || 0) * 0.1;
        const py = (el.positionY || 0) * 0.1 + (el.sizeY || 1) * 0.1 / 2;
        const pz = (el.positionZ || 0) * 0.1;
        const sx = (el.sizeX || 1) * 0.1;
        const sy = (el.sizeY || 1) * 0.1;
        const sz = (el.sizeZ || 1) * 0.1;
        const color = el.elementType === 'IfcWall' ? '#ccccaa'
          : el.elementType === 'IfcColumn' ? '#aaccaa' : '#aaaacc';
        return (
          <mesh key={el.elementId} position={[px - 25, py, pz - 15]} castShadow receiveShadow>
            <boxGeometry args={[sx, sy, sz]} />
            <meshStandardMaterial color={color} transparent opacity={0.55} />
          </mesh>
        );
      })}
    </>
  );
}

// ── 메인 대시보드 ──────────────────────────────────────────────────────────────

export default function SimulationDashboard({ selectedProject, modelData }) {

  const [state, setState] = useState({ ...DEFAULT_STATE });
  const keysRef = useRef(new Set());
  const [keysDisplay, setKeysDisplay] = useState(new Set()); // UI 반응용
  const animRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [kinematics, setKinematics] = useState(null);
  const [excavMarks, setExcavMarks] = useState([]); // 굴착 흔적 목록
  const lastMarkRef = useRef(null);  // 마지막 굴착 위치 (중복 제거용)
  const lastAutoSave = useRef(0);
  const stateRef = useRef(state);

  // stateRef는 항상 최신 state를 참조
  useEffect(() => { stateRef.current = state; }, [state]);

  // 서버에서 초기 상태 로드
  useEffect(() => {
    AxiosCustom.get('/api/simulation/excavator')
      .then(res => {
        if (res.data) setState(prev => ({ ...prev, ...res.data }));
      })
      .catch(() => {});
  }, []);

  // ── 키보드 이벤트 ──

  useEffect(() => {
    const CONTROLLED = new Set([
      'w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 't', 'g', 'y', 'h',
      'W', 'A', 'S', 'D', 'Q', 'E', 'R', 'F', 'T', 'G', 'Y', 'H',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);
    const onDown = e => {
      if (CONTROLLED.has(e.key)) e.preventDefault();
      keysRef.current.add(e.key);
      setKeysDisplay(new Set(keysRef.current));
    };
    const onUp = e => {
      keysRef.current.delete(e.key);
      setKeysDisplay(new Set(keysRef.current));
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // ── 제어 루프 (requestAnimationFrame, ~60fps) ──

  useEffect(() => {
    const MOVE_SPEED  = 0.07;
    const ROT_SPEED   = 1.0;
    const JOINT_SPEED = 0.6;

    const tick = () => {
      const keys = keysRef.current;
      if (keys.size === 0) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      setState(prev => {
        const s = { ...prev };
        const cos = Math.cos(s.bodyRotation * D2R);
        const sin = Math.sin(s.bodyRotation * D2R);

        // 전진 / 후진
        if (keys.has('w') || keys.has('W') || keys.has('ArrowUp')) {
          s.positionX += sin * MOVE_SPEED;
          s.positionZ += cos * MOVE_SPEED;
        }
        if (keys.has('s') || keys.has('S') || keys.has('ArrowDown')) {
          s.positionX -= sin * MOVE_SPEED;
          s.positionZ -= cos * MOVE_SPEED;
        }
        // 차체 회전
        if (keys.has('a') || keys.has('A') || keys.has('ArrowLeft')) {
          s.bodyRotation -= ROT_SPEED;
        }
        if (keys.has('d') || keys.has('D') || keys.has('ArrowRight')) {
          s.bodyRotation += ROT_SPEED;
        }

        // 선회 (Q / E)
        if (keys.has('q') || keys.has('Q')) s.swingAngle -= JOINT_SPEED * 1.8;
        if (keys.has('e') || keys.has('E')) s.swingAngle += JOINT_SPEED * 1.8;

        // 붐 (R / F)
        if (keys.has('r') || keys.has('R')) {
          s.boomAngle = clamp(s.boomAngle + JOINT_SPEED, JOINT_LIMITS.boomAngle.min, JOINT_LIMITS.boomAngle.max);
        }
        if (keys.has('f') || keys.has('F')) {
          s.boomAngle = clamp(s.boomAngle - JOINT_SPEED, JOINT_LIMITS.boomAngle.min, JOINT_LIMITS.boomAngle.max);
        }

        // 암 (T / G)
        if (keys.has('t') || keys.has('T')) {
          s.armAngle = clamp(s.armAngle + JOINT_SPEED, JOINT_LIMITS.armAngle.min, JOINT_LIMITS.armAngle.max);
        }
        if (keys.has('g') || keys.has('G')) {
          s.armAngle = clamp(s.armAngle - JOINT_SPEED, JOINT_LIMITS.armAngle.min, JOINT_LIMITS.armAngle.max);
        }

        // 버킷 (Y / H)
        if (keys.has('y') || keys.has('Y')) {
          s.bucketAngle = clamp(s.bucketAngle + JOINT_SPEED, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
        }
        if (keys.has('h') || keys.has('H')) {
          s.bucketAngle = clamp(s.bucketAngle - JOINT_SPEED, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
        }

        return s;
      });

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // ── 자동 서버 동기화 (2초마다) ──

  useEffect(() => {
    const id = setInterval(() => {
      setSyncStatus('syncing');
      AxiosCustom.put('/api/simulation/excavator', stateRef.current)
        .then(() => setSyncStatus('synced'))
        .catch(() => setSyncStatus('error'));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // ── 순기구학(Forward Kinematics) 계산 (로컬) ──

  const calcKinematics = useCallback((s) => {
    const boomRad    = s.boomAngle  * D2R;
    const armRad     = s.armAngle   * D2R;
    const bucketRad  = s.bucketAngle * D2R;
    const swingRad   = s.swingAngle  * D2R;

    const boomTipZ = BOOM_LEN * Math.cos(boomRad);
    const boomTipY = BOOM_LEN * Math.sin(boomRad);

    // 암 회전 +armAngle이므로: armTip_Y = boomTipY + ARM_LEN*sin(boomAngle - armAngle)
    const armAbsRad    = boomRad - armRad;
    const armTipZ      = boomTipZ + ARM_LEN * Math.cos(armAbsRad);
    const armTipY      = boomTipY + ARM_LEN * Math.sin(armAbsRad);

    // 버킷 회전 +bucketAngle이므로: bucketTip_Y = armTipY + 0.75*sin(boomAngle - armAngle - bucketAngle)
    const bucketAbsRad = armAbsRad - bucketRad;
    const bucketTipZ   = armTipZ   + 0.75 * Math.cos(bucketAbsRad);
    const bucketTipY   = armTipY   + 0.75 * Math.sin(bucketAbsRad);

    const cosSwing = Math.cos(swingRad);
    const sinSwing = Math.sin(swingRad);

    const worldX = s.positionX + sinSwing * bucketTipZ;
    const worldY = s.positionY + 2.1 + bucketTipY;
    const worldZ = s.positionZ + cosSwing * bucketTipZ;

    return {
      tipX: worldX.toFixed(2),
      tipY: worldY.toFixed(2),
      tipZ: worldZ.toFixed(2),
      reach: Math.abs(bucketTipZ).toFixed(2),
      depth: Math.max(0, -worldY).toFixed(2),
    };
  }, []);

  useEffect(() => {
    const km = calcKinematics(state);
    setKinematics(km);

    // 버킷이 지면 아래(depth > 0)면 굴착 흔적 추가
    const depth = parseFloat(km.depth);
    if (depth > 0.05) {
      const bx = parseFloat(km.tipX);
      const bz = parseFloat(km.tipZ);
      const last = lastMarkRef.current;
      // 이전 흔적과 1m 이상 떨어진 경우에만 새 흔적 추가
      if (!last || Math.hypot(bx - last.x, bz - last.z) > 1.0) {
        lastMarkRef.current = { x: bx, z: bz };
        setExcavMarks(prev => [
          ...prev.slice(-30), // 최대 30개 유지
          { x: bx, z: bz, depth: Math.min(depth, 2.0), r: 1.1 + depth * 0.3 },
        ]);
      }
    }
  }, [state, calcKinematics]);

  // ── UI 핸들러 ──

  const applyPreset = (name) => {
    setState(prev => ({
      ...prev,
      ...PRESETS[name],
      operationMode: name,
    }));
  };

  const setJoint = (key, value) => {
    const lim = JOINT_LIMITS[key];
    setState(prev => ({
      ...prev,
      [key]: lim ? clamp(value, lim.min, lim.max) : value,
    }));
  };

  const handleReset = () => {
    setState({ ...DEFAULT_STATE });
    setExcavMarks([]);
    lastMarkRef.current = null;
    AxiosCustom.post('/api/simulation/excavator/reset').catch(() => {});
  };

  const handleSave = () => {
    setSyncStatus('syncing');
    AxiosCustom.put('/api/simulation/excavator', state)
      .then(() => setSyncStatus('synced'))
      .catch(() => setSyncStatus('error'));
  };

  // 버튼 눌림 시뮬레이션 (UI 방향키)
  const pressKey  = (k) => { keysRef.current.add(k); setKeysDisplay(new Set(keysRef.current)); };
  const releaseKey = (k) => { keysRef.current.delete(k); setKeysDisplay(new Set(keysRef.current)); };

  // ── 스타일 변수 ──

  const panelBg    = '#0d1b2a';
  const panelBorder = '1px solid #253347';
  const secColor   = '#8896a4';
  const accentBlue = '#60a5fa';

  const syncColor = syncStatus === 'synced' ? '#4ade80'
    : syncStatus === 'error' ? '#f87171'
    : syncStatus === 'syncing' ? '#facc15'
    : '#8896a4';

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: 'calc(100vh - 130px)',
      gap: '10px',
    }}>

      {/* ── 왼쪽 상태 패널 ── */}
      <div style={{
        width: '210px',
        flexShrink: 0,
        background: panelBg,
        border: panelBorder,
        borderRadius: '12px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        overflowY: 'auto',
        fontSize: '12px',
      }}>
        {/* 헤더 */}
        <div style={{
          color: accentBlue,
          fontSize: '13px',
          fontWeight: 700,
          borderBottom: '1px solid #1e3a5f',
          paddingBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          🚧 장비 상태
          <span style={{
            marginLeft: 'auto',
            fontSize: '10px',
            color: syncColor,
          }}>
            {syncStatus === 'syncing' ? '⟳' : syncStatus === 'synced' ? '✓' : syncStatus === 'error' ? '✗' : '○'}
          </span>
        </div>

        {/* 작동 모드 + 굴착 중 표시 */}
        <div style={{
          background: kinematics && parseFloat(kinematics.depth) > 0.05 ? '#1a1200' : '#111e2e',
          border: kinematics && parseFloat(kinematics.depth) > 0.05 ? '1px solid #8a5a00' : '1px solid transparent',
          borderRadius: '8px', padding: '9px',
          transition: 'background 0.3s, border 0.3s',
        }}>
          <div style={{ color: secColor, marginBottom: '4px', fontSize: '10px' }}>작동 모드</div>
          <div style={{ color: '#f5a623', fontWeight: 700, fontSize: '13px' }}>
            ● {state.operationMode}
          </div>
          {kinematics && parseFloat(kinematics.depth) > 0.05 && (
            <div style={{
              marginTop: '6px',
              background: '#3a1a00',
              borderRadius: '5px',
              padding: '4px 8px',
              fontSize: '11px',
              color: '#fbbf24',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }}>
              ⛏ 굴착 중  ({kinematics.depth}m)
            </div>
          )}
        </div>

        {/* 위치 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
          <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px' }}>위치 (m)</div>
          {[['X', state.positionX], ['Y', state.positionY], ['Z', state.positionZ]].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{Number(v).toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* 관절 각도 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
          <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px' }}>관절 각도 (°)</div>
          {[
            ['차체 회전', state.bodyRotation, '#94a3b8'],
            ['선회',     state.swingAngle,    '#a78bfa'],
            ['붐',       state.boomAngle,     accentBlue],
            ['암',       state.armAngle,      '#34d399'],
            ['버킷',     state.bucketAngle,   '#fb923c'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: c, fontFamily: 'monospace', fontWeight: 600 }}>
                {Math.round(v)}°
              </span>
            </div>
          ))}
        </div>

        {/* 순기구학 결과 */}
        {kinematics && (
          <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
            <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px' }}>버킷 끝 위치</div>
            {[['X', kinematics.tipX], ['Y', kinematics.tipY], ['Z', kinematics.tipZ]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: secColor }}>{l}</span>
                <span style={{ color: '#fbbf24', fontFamily: 'monospace' }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #1e3a5f', marginTop: '6px', paddingTop: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: secColor }}>수평 도달</span>
                <span style={{ color: '#34d399', fontFamily: 'monospace' }}>{kinematics.reach}m</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: secColor }}>굴착 깊이</span>
                <span style={{ color: '#fb923c', fontFamily: 'monospace' }}>{kinematics.depth}m</span>
              </div>
            </div>
          </div>
        )}

        {/* 장비 정보 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '4px' }}>장비 ID</div>
          <div style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{state.excavatorId}</div>
          <div style={{ color: secColor, marginTop: '6px', marginBottom: '4px' }}>동기화</div>
          <div style={{ color: syncColor }}>
            {syncStatus === 'syncing' ? '동기화 중...'
              : syncStatus === 'synced' ? 'C# 서버 동기화됨'
              : syncStatus === 'error'  ? '동기화 실패'
              : '대기 중'}
          </div>
        </div>
      </div>

      {/* ── 중앙 3D 캔버스 ── */}
      <div style={{
        flex: 1,
        borderRadius: '12px',
        overflow: 'hidden',
        border: panelBorder,
        position: 'relative',
      }}>
        {/* 키보드 가이드 오버레이 */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: 10,
          background: 'rgba(13,27,42,0.88)',
          border: '1px solid #253347',
          borderRadius: '10px',
          padding: '10px 14px',
          fontSize: '11px',
          color: secColor,
          lineHeight: 1.7,
          pointerEvents: 'none',
        }}>
          <div style={{ color: accentBlue, fontWeight: 700, marginBottom: '4px', fontSize: '12px' }}>
            ⌨ 키보드 조작
          </div>
          {[
            ['W / S', '전진 / 후진'],
            ['A / D', '차체 회전'],
            ['Q / E', '선회 ±'],
            ['R / F', '붐 상 / 하'],
            ['T / G', '암 굴절'],
            ['Y / H', '버킷 회전'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: '6px' }}>
              <span style={{ color: '#e2e8f0', minWidth: '60px', fontFamily: 'monospace' }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>

        {/* 장비명 배지 */}
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 10,
          background: 'rgba(13,27,42,0.88)',
          border: '1px solid #253347',
          borderRadius: '8px',
          padding: '6px 12px',
          fontSize: '12px',
          color: '#f5a623',
          fontWeight: 700,
          pointerEvents: 'none',
        }}>
          🚜 굴착기 EX-001
        </div>

        <Canvas
          shadows
          camera={{ position: [22, 14, 28], fov: 52 }}
          style={{ background: '#1a2a3a' }}
        >
          <Sky
            sunPosition={[100, 40, 100]}
            turbidity={6}
            rayleigh={0.6}
            mieCoefficient={0.005}
            mieDirectionalG={0.8}
          />

          <ambientLight intensity={0.55} />
          <directionalLight
            position={[60, 70, 40]}
            intensity={1.3}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-far={200}
            shadow-camera-left={-70}
            shadow-camera-right={70}
            shadow-camera-top={70}
            shadow-camera-bottom={-70}
          />
          <pointLight position={[-20, 8, -20]} intensity={0.25} color="#ff9944" />
          <pointLight position={[25, 6, 25]}   intensity={0.2}  color="#4488ff" />

          <ConstructionSite bimElements={modelData} />
          <ExcavationMarks marks={excavMarks} />
          <ExcavatorModel state={state} />

          <OrbitControls
            enableDamping
            dampingFactor={0.06}
            minDistance={4}
            maxDistance={120}
            maxPolarAngle={Math.PI / 2 - 0.05}
          />
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport labelColor="white" axisHeadScale={0.85} />
          </GizmoHelper>
        </Canvas>
      </div>

      {/* ── 오른쪽 조작 패널 ── */}
      <div style={{
        width: '250px',
        flexShrink: 0,
        background: panelBg,
        border: panelBorder,
        borderRadius: '12px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        overflowY: 'auto',
        fontSize: '12px',
      }}>
        <div style={{
          color: accentBlue,
          fontSize: '13px',
          fontWeight: 700,
          borderBottom: '1px solid #1e3a5f',
          paddingBottom: '8px',
        }}>
          🎮 장비 조작
        </div>

        {/* 이동 방향키 패드 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>이동 / 회전</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gridTemplateRows: '1fr 1fr 1fr',
            gap: '4px',
            width: '130px',
            margin: '0 auto',
          }}>
            {/* 전진 */}
            <button
              style={dirBtnStyle('w', keysDisplay)}
              onMouseDown={() => pressKey('w')}
              onMouseUp={() => releaseKey('w')}
              onMouseLeave={() => releaseKey('w')}
              onTouchStart={() => pressKey('w')}
              onTouchEnd={() => releaseKey('w')}
            >↑</button>
            {/* 좌회전 */}
            <button
              style={{ ...dirBtnStyle('a', keysDisplay), gridColumn: 1, gridRow: 2 }}
              onMouseDown={() => pressKey('a')}
              onMouseUp={() => releaseKey('a')}
              onMouseLeave={() => releaseKey('a')}
              onTouchStart={() => pressKey('a')}
              onTouchEnd={() => releaseKey('a')}
            >↶</button>
            {/* 후진 */}
            <button
              style={{ ...dirBtnStyle('s', keysDisplay), gridColumn: 2, gridRow: 2 }}
              onMouseDown={() => pressKey('s')}
              onMouseUp={() => releaseKey('s')}
              onMouseLeave={() => releaseKey('s')}
              onTouchStart={() => pressKey('s')}
              onTouchEnd={() => releaseKey('s')}
            >↓</button>
            {/* 우회전 */}
            <button
              style={{ ...dirBtnStyle('d', keysDisplay), gridColumn: 3, gridRow: 2 }}
              onMouseDown={() => pressKey('d')}
              onMouseUp={() => releaseKey('d')}
              onMouseLeave={() => releaseKey('d')}
              onTouchStart={() => pressKey('d')}
              onTouchEnd={() => releaseKey('d')}
            >↷</button>
          </div>
          {/* 선회 버튼 */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'center' }}>
            {[['q', '↺ 선회 ←'], ['e', '선회 → ↻']].map(([k, label]) => (
              <button
                key={k}
                style={jointBtnStyle(k, keysDisplay, '#a78bfa')}
                onMouseDown={() => pressKey(k)}
                onMouseUp={() => releaseKey(k)}
                onMouseLeave={() => releaseKey(k)}
                onTouchStart={() => pressKey(k)}
                onTouchEnd={() => releaseKey(k)}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* 관절 슬라이더 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>관절 세부 제어</div>

          {[
            {
              label: '붐 (Boom)',
              key: 'boomAngle',
              min: JOINT_LIMITS.boomAngle.min,
              max: JOINT_LIMITS.boomAngle.max,
              color: accentBlue,
              keys: ['r', 'f'],
              keylabels: ['R↑', 'F↓'],
            },
            {
              label: '암 (Arm)',
              key: 'armAngle',
              min: JOINT_LIMITS.armAngle.min,
              max: JOINT_LIMITS.armAngle.max,
              color: '#34d399',
              keys: ['t', 'g'],
              keylabels: ['T↑', 'G↓'],
            },
            {
              label: '버킷 (Bucket)',
              key: 'bucketAngle',
              min: JOINT_LIMITS.bucketAngle.min,
              max: JOINT_LIMITS.bucketAngle.max,
              color: '#fb923c',
              keys: ['y', 'h'],
              keylabels: ['Y↑', 'H↓'],
            },
          ].map(({ label, key, min, max, color, keys: kk, keylabels }) => (
            <div key={key} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center' }}>
                <span style={{ color: secColor }}>{label}</span>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {kk.map((k, i) => (
                    <button
                      key={k}
                      style={{
                        background: keysDisplay.has(k) ? '#1e3a5f' : '#162032',
                        border: `1px solid ${keysDisplay.has(k) ? color : '#253347'}`,
                        borderRadius: '4px',
                        color: keysDisplay.has(k) ? color : '#8896a4',
                        padding: '1px 5px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                      onMouseDown={() => pressKey(k)}
                      onMouseUp={() => releaseKey(k)}
                      onMouseLeave={() => releaseKey(k)}
                      onTouchStart={() => pressKey(k)}
                      onTouchEnd={() => releaseKey(k)}
                    >{keylabels[i]}</button>
                  ))}
                  <span style={{ color, fontFamily: 'monospace', fontWeight: 700, minWidth: '36px', textAlign: 'right' }}>
                    {Math.round(state[key])}°
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={0.5}
                value={state[key]}
                onChange={e => setJoint(key, parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: color, cursor: 'pointer', height: '4px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3a4a5a', fontSize: '10px', marginTop: '2px' }}>
                <span>{min}°</span>
                <span>{max}°</span>
              </div>
            </div>
          ))}
        </div>

        {/* 작업 프리셋 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>작업 프리셋</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {Object.entries(PRESETS).map(([name]) => {
              const active = state.operationMode === name;
              return (
                <button
                  key={name}
                  onClick={() => applyPreset(name)}
                  style={{
                    background: active ? '#1e3a5f' : '#162032',
                    border: `1px solid ${active ? accentBlue : '#253347'}`,
                    borderRadius: '7px',
                    color: active ? accentBlue : secColor,
                    padding: '7px 6px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    transition: 'all 0.15s',
                  }}
                >
                  {PRESET_LABELS[name]}
                </button>
              );
            })}
          </div>
        </div>

        {/* 저장 / 초기화 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            onClick={handleSave}
            style={{
              background: '#0d2420',
              border: '1px solid #1a5040',
              borderRadius: '8px',
              color: '#4ade80',
              padding: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            💾 상태 저장 (C# 서버)
          </button>
          <button
            onClick={() => { setExcavMarks([]); lastMarkRef.current = null; }}
            style={{
              background: '#1a1200',
              border: '1px solid #4a3000',
              borderRadius: '8px',
              color: '#fbbf24',
              padding: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            🗑 굴착 흔적 지우기
          </button>
          <button
            onClick={handleReset}
            style={{
              background: '#2d1010',
              border: '1px solid #5a2020',
              borderRadius: '8px',
              color: '#f87171',
              padding: '8px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ↺ 전체 초기화
          </button>
        </div>

        {/* 장비 규격 정보 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '6px' }}>장비 규격</div>
          {[
            ['기종', '굴착기 EX-001'],
            ['붐 길이', `${BOOM_LEN}m`],
            ['암 길이', `${ARM_LEN}m`],
            ['최대 도달', `${(BOOM_LEN + ARM_LEN + 0.75).toFixed(1)}m`],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: '#e2e8f0' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 버튼 스타일 헬퍼 ───────────────────────────────────────────────────────────

function dirBtnStyle(key, keysDisplay) {
  const active = keysDisplay.has(key);
  return {
    gridColumn: key === 'w' ? 2 : undefined,
    background: active ? '#1e3a5f' : '#162032',
    border: `1px solid ${active ? '#60a5fa' : '#253347'}`,
    borderRadius: '6px',
    color: active ? '#60a5fa' : '#e2e8f0',
    cursor: 'pointer',
    padding: '8px',
    fontSize: '15px',
    lineHeight: 1,
    transition: 'all 0.1s',
    userSelect: 'none',
  };
}

function jointBtnStyle(key, keysDisplay, color) {
  const active = keysDisplay.has(key);
  return {
    flex: 1,
    background: active ? '#221840' : '#162032',
    border: `1px solid ${active ? color : '#253347'}`,
    borderRadius: '6px',
    color: active ? color : '#8896a4',
    cursor: 'pointer',
    padding: '5px 4px',
    fontSize: '10px',
    fontWeight: 600,
    transition: 'all 0.1s',
    userSelect: 'none',
  };
}
