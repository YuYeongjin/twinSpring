import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import * as THREE from 'three';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import AxiosCustom, { WS_BASE } from '../../axios/AxiosCustom';
import {
  TerrainRapierCollider,
  ExcavatorCollider,
  usePhysicsEvaluation,
} from './component/ExcavationPhysics';

// ── 공통 상수 ──────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;

const JOINT_LIMITS = {
  boomAngle:   { min: 0,   max: 80  },
  armAngle:    { min: -20, max: 120 },
  bucketAngle: { min: -90, max: 30  },
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

const PRESETS = {
  IDLE:   { boomAngle: 35, armAngle: 60,  bucketAngle: -25, swingAngle: 0  },
  DIG:    { boomAngle: 5,  armAngle: 100, bucketAngle: 10,  swingAngle: 0  },
  DUMP:   { boomAngle: 65, armAngle: 20,  bucketAngle: -80, swingAngle: 90 },
  TRAVEL: { boomAngle: 20, armAngle: 60,  bucketAngle: -30, swingAngle: 0  },
};

const PRESET_LABELS = { IDLE: 'Idle', DIG: 'Dig', DUMP: 'Dump', TRAVEL: 'Travel' };

// ── 자동 시뮬레이션 사이클 페이즈 ────────────────────────────────────────────────
const AUTO_SIM_PHASES = [
  { name: 'Approach',  boomAngle: 15,  armAngle: 75,  bucketAngle: -70,   swingAngle: 0,   dㅈㅈㄴz:  -0.015, duration: 1600 },
  { name: 'Dig',       boomAngle: 0,   armAngle: 110, bucketAngle: 12,  swingAngle: 0,   dz:  0,    duration: 1800 },
  { name: 'Lift',      boomAngle: 55,  armAngle: 35,  bucketAngle: 5,   swingAngle: 0,   dz:  0,    duration: 1200 },
  { name: 'Swing',     boomAngle: 65,  armAngle: 25,  bucketAngle: 5,   swingAngle: 85,  dz:  0,    duration: 1000 },
  { name: 'Dump',      boomAngle: 65,  armAngle: 20,  bucketAngle: -90, swingAngle: 90,  dz:  0,    duration: 1200 },
  { name: 'Return',    boomAngle: 35,  armAngle: 60,  bucketAngle: -90, swingAngle: 0,   dz:  0,    duration: 1400 },
];

// ── 장비 사양 정의 ─────────────────────────────────────────────────────────────
// bodyScale: 차체 시각 스케일 (1.0 = 1W 기준)
// boomLen/armLen/bucketLen: 월드 공간 실제 길이(m)
// 붐 피벗은 항상 [0, 1.4, 1.9] × bodyScale
const MACHINE_CONFIGS = {
  '0.3W': {
    id: '0.3W', label: '0.3W Small', subLabel: 'Small Excavator (Mini)', weight: '3~6 ton class',
    bodyScale: 0.55,
    boomLen: 2.8,  armLen: 1.4,  bucketLen: 0.72,  bucketCapacity: 0.3,
    digRate: 0.038, digRadius: 1.7,
    fillRate: 0.08, fillRadius: 1.4,
  },
  '0.6W': {
    id: '0.6W', label: '0.6W Medium', subLabel: 'Medium Excavator', weight: '12~20 ton class',
    bodyScale: 0.78,
    boomLen: 4.8,  armLen: 2.8,  bucketLen: 1.05,  bucketCapacity: 0.6,
    digRate: 0.065, digRadius: 2.8,
    fillRate: 0.14, fillRadius: 2.2,
  },
  '1W': {
    id: '1W', label: '1W Large', subLabel: 'Large Excavator', weight: '20~35 ton class',
    bodyScale: 1.0,
    boomLen: 6.0,  armLen: 3.8,  bucketLen: 1.30,  bucketCapacity: 1.0,
    digRate: 0.10,  digRadius: 3.8,
    fillRate: 0.20, fillRadius: 2.6,
  },
};
const DEFAULT_MACHINE = MACHINE_CONFIGS['0.6W'];

// 온·습도 이상 감지 기본 임계값
const DEFAULT_THRESHOLDS = { tempMin: 5, tempMax: 40, humMin: 20, humMax: 85 };

// 알림 심각도별 색상
const ALERT_COLORS = {
  danger:  { bg: 'rgba(127,29,29,0.95)', border: '#ef4444', text: '#fca5a5', glow: '#ef444480' },
  warning: { bg: 'rgba(92,60,0,0.95)',   border: '#f59e0b', text: '#fde68a', glow: '#f59e0b60' },
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── 지형 그리드 시스템 ─────────────────────────────────────────────────────────
const GRID_COLS  = 80;
const GRID_ROWS  = 80;
const CELL_M     = 1.0;
const HALF_C     = GRID_COLS / 2;   // 40
const HALF_R     = GRID_ROWS / 2;   // 40
const MAX_DIG    = 5.0;
const MAX_FILL   = 5.0;
// MAX_BUCKET는 장비별 machine.bucketCapacity로 대체됨

// 월드 좌표 → 그리드 셀 인덱스
function worldToCell(wx, wz) {
  const col = Math.floor(wx + HALF_C);
  const row = Math.floor(wz + HALF_R);
  return { col, row, valid: col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS };
}

// 지형 높이 bilinear 샘플링
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

// 버텍스 높이: 인접 4개 셀 평균 (부드러운 표면)
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

// 높이값 → 버텍스 색상 (굴착 구멍은 어두운 갈색~거의 검정, 성토는 황토)
function hToRGB(h) {
  if (h < 0) {
    // 구멍: 표면에서 3m 이상 파면 거의 검정에 가까운 진흙색
    const t = Math.min(1, -h / 3.0);
    return [0.42 - t * 0.38, 0.30 - t * 0.28, 0.16 - t * 0.15];
  }
  const t = Math.min(1, h / MAX_FILL);
  return [0.50 - t * 0.10, 0.38 - t * 0.10, 0.22 - t * 0.06];
}

// 지형 BufferGeometry 초기 생성 (높이 = 0인 평탄 지형)
function buildTerrainGeo() {
  const vC = GRID_COLS + 1, vR = GRID_ROWS + 1;
  const N   = vC * vR;
  const pos = new Float32Array(N * 3);
  const clr = new Float32Array(N * 3);
  const nor = new Float32Array(N * 3);

  for (let r = 0; r <= GRID_ROWS; r++) {
    for (let c = 0; c <= GRID_COLS; c++) {
      const i = r * vC + c;
      pos[i*3]   = (c - HALF_C) * CELL_M;
      pos[i*3+1] = 0;
      pos[i*3+2] = (r - HALF_R) * CELL_M;
      const [cr, cg, cb] = hToRGB(0);
      clr[i*3] = cr; clr[i*3+1] = cg; clr[i*3+2] = cb;
      nor[i*3+1] = 1;
    }
  }

  const idx = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const tl = r * vC + c;
      const tr = tl + 1;
      const bl = (r + 1) * vC + c;
      const br = bl + 1;
      idx.push(tl, bl, tr, tr, bl, br);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(clr, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

// height map 변경분을 기존 지오메트리에 반영 (in-place mutation)
function updateTerrainGeo(geo, hm) {
  const vC  = GRID_COLS + 1;
  const pos = geo.attributes.position;
  const clr = geo.attributes.color;
  for (let r = 0; r <= GRID_ROWS; r++) {
    for (let c = 0; c <= GRID_COLS; c++) {
      const i = r * vC + c;
      const h = vertH(hm, c, r);
      pos.setY(i, h);
      const [cr, cg, cb] = hToRGB(h);
      clr.setXYZ(i, cr, cg, cb);
    }
  }
  pos.needsUpdate = true;
  clr.needsUpdate = true;
  geo.computeVertexNormals();
}

// // 굴착: 버킷 접촉 좌표 중심으로 Gaussian 분포로 흙 제거 (정규화 가중치, 실제 제거량 반환)
// function applyExcavation(hm, col, row, amount) {
//   const cells = [];
//   let totalW = 0;
//   for (let dr = -2; dr <= 2; dr++) {
//     for (let dc = -2; dc <= 2; dc++) {
// 굴착: 버킷 접촉 좌표 중심으로 Gaussian 분포로 흙 제거
function applyExcavation(hm, col, row, amount, R = 3.5) {
  const iR = Math.ceil(R) + 1;
  const cells = [];
  let totalW = 0;
  for (let dr = -iR; dr <= iR; dr++) {
    for (let dc = -iR; dc <= iR; dc++) {
      const d = Math.sqrt(dr * dr + dc * dc);
      if (d > R) continue;
      const c = col + dc, r = row + dr;
      if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) continue;
      const w = Math.exp(-d * d / (R * 0.72));
      totalW += w;
      cells.push({ c, r, w });
      hm[r * GRID_COLS + c] = Math.max(-MAX_DIG, hm[r * GRID_COLS + c] - amount * w);
    }
  }
  if (totalW < 0.001) return 0;
  let actualRemoved = 0;
  for (const { c, r, w } of cells) {
    const norm = w / totalW;
    const prev = hm[r * GRID_COLS + c];
    const next = Math.max(-MAX_DIG, prev - amount * norm);
    hm[r * GRID_COLS + c] = next;
    actualRemoved += prev - next;
  }
  return actualRemoved;
}

// 지형 데이터 직렬화/역직렬화 (Float32Array ↔ base64)
function serializeTerrain(hm) {
  const bytes = new Uint8Array(hm.buffer);
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    b64 += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(b64);
}

function deserializeTerrain(b64, hm) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const floats = new Float32Array(bytes.buffer);
  if (floats.length === hm.length) hm.set(floats);
}

// 덤핑: 버킷이 흙을 쏟을 때 해당 좌표에 첨예한 봉우리 형태로 흙 쌓기
function applyFill(hm, col, row, volume, R = 2.6) {
  let totalW = 0;
  const cells = [];
  for (let dr = -3; dr <= 3; dr++) {
    for (let dc = -3; dc <= 3; dc++) {
      const d = Math.sqrt(dr * dr + dc * dc);
      if (d > R) continue;
      const c = col + dc, r = row + dr;
      if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) continue;
      // 3제곱 감쇠 → 중심에 집중된 뾰족한 봉우리
      const w = Math.pow(1 - d / R, 3);
      totalW += w;
      cells.push({ c, r, w });
    }
  }
  if (totalW < 0.001) return;
  for (const { c, r, w } of cells) {
    hm[r * GRID_COLS + c] = Math.min(MAX_FILL, hm[r * GRID_COLS + c] + (volume * w) / totalW);
  }
}

// ── 파티클 시스템 ─────────────────────────────────────────────────────────────
const MAX_PARTICLES = 400;

function createParticle(x, y, z, type) {
  const speed = type === 'dump' ? 1.8 : 2.8;
  return {
    x, y: y + 0.15, z,
    vx: (Math.random() - 0.5) * speed,
    vy: type === 'dump'
      ? -(Math.random() * 1.2 + 0.3)   // 덤핑: 아래로 떨어짐
      : (Math.random() * 2.5 + 0.6),    // 굴착: 위로 튀어오름
    vz: (Math.random() - 0.5) * speed,
    life: 0.5 + Math.random() * 0.7,
    maxLife: 1.2,
    type,
  };
}

// ── TerrainMesh 컴포넌트 ───────────────────────────────────────────────────────
// useFrame 안에서 dirty 플래그를 감시하여 React 렌더링 없이 지형 업데이트
function TerrainMesh({ heightMapRef, dirtyRef }) {
  const geometry = useMemo(() => buildTerrainGeo(), []);

  useFrame(() => {
    if (dirtyRef.current) {
      updateTerrainGeo(geometry, heightMapRef.current);
      dirtyRef.current = false;
    }
  });

  return (
    <mesh receiveShadow>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial vertexColors roughness={1.0} metalness={0} />
    </mesh>
  );
}

// ── 트랙 롤러 ─────────────────────────────────────────────────────────────────
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

// ── 굴착기 3D 모델 (장비 사양 기반 스케일링 + 지형 추종 기울기) ──────────────────
// 차체 전체를 bodyScale로 균일 확대/축소.
// 붐/암은 scaled space 내에서 실제 길이/s 로 표현 → 월드 공간에서 실제 길이.
// useFrame으로 매 프레임 지형 높이·기울기를 계산해 그룹에 직접 반영.
function ExcavatorModel({ state, soilInBucket, machine, heightMapRef, wobbleRef }) {
  const s   = machine.bodyScale;
  const BL  = machine.boomLen  / s;
  const AL  = machine.armLen   / s;
  const buL = machine.bucketLen / s;
  const soilFill = Math.min(1, soilInBucket / machine.bucketCapacity);

  const groupRef = useRef();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 트랙 반-폭/반-길이 (월드 공간, bodyScale 반영)
  const tHX = 2.1  * s;   // 좌우 절반
  const tHZ = 2.75 * s;   // 전후 절반

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const cur    = stateRef.current;
    const px     = cur.positionX;
    const pz     = cur.positionZ;
    const bodyRad = cur.bodyRotation * D2R;
    const cosR   = Math.cos(bodyRad);
    const sinR   = Math.sin(bodyRad);

    const hm = heightMapRef?.current;
    if (hm) {
      // 차체 로컬 좌표 (lx, lz) → 월드 좌표로 변환해 지형 높이 샘플
      const sc = (lx, lz) =>
        sampleH(hm, px + sinR * lz + cosR * lx, pz + cosR * lz - sinR * lx);

      const hFL = sc(-tHX,  tHZ);  // 좌전
      const hFR = sc( tHX,  tHZ);  // 우전
      const hBL = sc(-tHX, -tHZ);  // 좌후
      const hBR = sc( tHX, -tHZ);  // 우후

      const centerH = (hFL + hFR + hBL + hBR) / 4;
      // pitch: 전후 기울기 (차체 X축 회전)
      const pitch = Math.atan2((hFL + hFR) / 2 - (hBL + hBR) / 2, tHZ * 2);
      // roll: 좌우 기울기 (차체 Z축 회전, 오른쪽이 높으면 양수)
      const roll  = Math.atan2((hFR + hBR) / 2 - (hFL + hBL) / 2, tHX * 2);

      groupRef.current.position.set(px, centerH, pz);

      // BEPUphysics2 평가 결과에 따른 진동 오프셋
      let finalPitch = -pitch;
      let finalRoll  = roll;
      const wb = wobbleRef?.current;
      if (wb && wb.amplitude > 0.001) {
        wb.time = (wb.time ?? 0) + delta;
        const wobble = wb.amplitude * Math.sin(wb.time * wb.frequency * Math.PI * 2);
        // 전도 방향(dirX, dirZ)으로 흔들림
        finalPitch += wobble * (wb.dirZ ?? 1);
        finalRoll  += wobble * (wb.dirX ?? 0);
      }

      groupRef.current.rotation.set(finalPitch, bodyRad, finalRoll, 'YXZ');
    } else {
      groupRef.current.position.set(px, 0, pz);

      let finalPitch = 0;
      let finalRoll  = 0;
      const wb = wobbleRef?.current;
      if (wb && wb.amplitude > 0.001) {
        wb.time = (wb.time ?? 0) + delta;
        const wobble = wb.amplitude * Math.sin(wb.time * wb.frequency * Math.PI * 2);
        finalPitch += wobble * (wb.dirZ ?? 1);
        finalRoll  += wobble * (wb.dirX ?? 0);
      }

      groupRef.current.rotation.set(finalPitch, bodyRad, finalRoll, 'YXZ');
    }
  });

  return (
    <group ref={groupRef}>
      <group scale={[s, s, s]}>

        {/* ── 하부 차체 (언더캐리지) ── */}
        {/* 센터 프레임 */}
        <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.6, 0.68, 5.2]} />
          <meshStandardMaterial color="#3a4126" roughness={0.88} metalness={0.12} />
        </mesh>
        {/* 트랙 프레임 좌우 */}
        {[-1, 1].map((sx, i) => (
          <group key={`trackframe${i}`}>
            <mesh position={[sx * 2.05, 0.38, 0]} castShadow>
              <boxGeometry args={[0.58, 0.62, 5.9]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.95} />
            </mesh>
            {/* 트랙 슈 (신발) 표현 */}
            {Array.from({ length: 10 }, (_, k) => k - 4.5).map(zOff => (
              <mesh key={zOff} position={[sx * 2.05, 0.04, zOff * 0.58]} castShadow>
                <boxGeometry args={[0.72, 0.1, 0.5]} />
                <meshStandardMaterial color="#111" metalness={0.5} roughness={0.8} />
              </mesh>
            ))}
          </group>
        ))}
        <TrackRollers side="left" />
        <TrackRollers side="right" />
        {/* 아이들러·스프로켓 */}
        {[-1, 1].map((sx, i) => (
          <mesh key={`idler${i}`} position={[sx * 2.05, 0.38, 2.75]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.6, 14]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.65} roughness={0.3} />
          </mesh>
        ))}
        {[-1, 1].map((sx, i) => (
          <mesh key={`sprocket${i}`} position={[sx * 2.05, 0.38, -2.75]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.36, 0.36, 0.6, 10]} />
            <meshStandardMaterial color="#303030" metalness={0.72} roughness={0.25} />
          </mesh>
        ))}

        {/* ── 상부 선회체 ── */}
        <group position={[0, 0.72, 0]} rotation={[0, state.swingAngle * D2R, 0]}>
          {/* 선회링 */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.35, 0.16, 10, 28]} />
            <meshStandardMaterial color="#444" metalness={0.85} roughness={0.2} />
          </mesh>
          {/* 메인 카운터웨이트 포함 상부 프레임 */}
          <mesh position={[0, 0.74, 0.1]} castShadow receiveShadow>
            <boxGeometry args={[3.2, 1.38, 3.8]} />
            <meshStandardMaterial color="#f5a623" roughness={0.5} metalness={0.22} />
          </mesh>
          {/* 운전석 캡 */}
          <mesh position={[-0.62, 2.0, 0.45]} castShadow>
            <boxGeometry args={[1.82, 1.72, 1.95]} />
            <meshStandardMaterial color="#f5a623" roughness={0.46} metalness={0.2} />
          </mesh>
          {/* 앞 유리 */}
          <mesh position={[-0.62, 2.02, 1.4]}>
            <boxGeometry args={[1.7, 1.25, 0.07]} />
            <meshStandardMaterial color="#9dd8ff" transparent opacity={0.38} roughness={0.05} metalness={0.1} />
          </mesh>
          {/* 측면 유리 */}
          <mesh position={[0.3, 2.02, 0.45]}>
            <boxGeometry args={[0.07, 1.0, 1.5]} />
            <meshStandardMaterial color="#9dd8ff" transparent opacity={0.32} roughness={0.05} metalness={0.1} />
          </mesh>
          {/* 엔진 커버 */}
          <mesh position={[0.4, 1.38, -1.15]} castShadow>
            <boxGeometry args={[2.1, 0.78, 1.55]} />
            <meshStandardMaterial color="#e09010" roughness={0.52} metalness={0.28} />
          </mesh>
          {/* 카운터웨이트 */}
          <mesh position={[0.2, 0.72, -2.4]} castShadow>
            <boxGeometry args={[3.0, 0.9, 1.2]} />
            <meshStandardMaterial color="#252525" metalness={0.58} roughness={0.6} />
          </mesh>
          {/* 배기관 */}
          <mesh position={[-1.3, 2.85, -0.3]} castShadow>
            <cylinderGeometry args={[0.1, 0.12, 0.95, 8]} />
            <meshStandardMaterial color="#333" metalness={0.88} roughness={0.3} />
          </mesh>
          <mesh position={[-1.3, 3.35, -0.3]}>
            <cylinderGeometry args={[0.12, 0.09, 0.15, 8]} />
            <meshStandardMaterial color="#222" metalness={0.9} />
          </mesh>

          {/* ── 붐 (BOOM) ── */}
          <group position={[0, 1.4, 1.9]}>
            <group rotation={[-state.boomAngle * D2R, 0, 0]}>
              {/* 붐 좌측 박스 빔 */}
              <mesh position={[-0.18, 0, BL / 2]} castShadow>
                <boxGeometry args={[0.22, 0.52, BL]} />
                <meshStandardMaterial color="#d48810" roughness={0.45} metalness={0.40} />
              </mesh>
              {/* 붐 우측 박스 빔 */}
              <mesh position={[0.18, 0, BL / 2]} castShadow>
                <boxGeometry args={[0.22, 0.52, BL]} />
                <meshStandardMaterial color="#d48810" roughness={0.45} metalness={0.40} />
              </mesh>
              {/* 붐 웹 플레이트 (중간 연결판) */}
              {[BL * 0.25, BL * 0.55, BL * 0.82].map((z, i) => (
                <mesh key={i} position={[0, -0.04, z]} castShadow>
                  <boxGeometry args={[0.42, 0.42, 0.06]} />
                  <meshStandardMaterial color="#c07808" roughness={0.5} metalness={0.35} />
                </mesh>
              ))}
              {/* 붐 유압실린더 (메인) */}
              <mesh position={[0, -0.38, BL * 0.32]} rotation={[0.34, 0, 0]} castShadow>
                <cylinderGeometry args={[0.13, 0.13, BL * 0.68, 10]} />
                <meshStandardMaterial color="#999" metalness={0.88} roughness={0.18} />
              </mesh>
              {/* 피스톤 로드 */}
              <mesh position={[0, -0.22, BL * 0.18]} rotation={[0.34, 0, 0]} castShadow>
                <cylinderGeometry args={[0.07, 0.07, BL * 0.28, 8]} />
                <meshStandardMaterial color="#ccc" metalness={0.95} roughness={0.08} />
              </mesh>

              {/* ── 암 (ARM / STICK) ── */}
              <group position={[0, 0, BL]}>
                {/* 암 피벗 핀 */}
                <mesh rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.14, 0.14, 0.7, 10]} />
                  <meshStandardMaterial color="#555" metalness={0.9} />
                </mesh>
                <group rotation={[state.armAngle * D2R, 0, 0]}>
                  {/* 암 좌측 빔 */}
                  <mesh position={[-0.16, 0, AL / 2]} castShadow>
                    <boxGeometry args={[0.18, 0.40, AL]} />
                    <meshStandardMaterial color="#c07a0a" roughness={0.48} metalness={0.36} />
                  </mesh>
                  {/* 암 우측 빔 */}
                  <mesh position={[0.16, 0, AL / 2]} castShadow>
                    <boxGeometry args={[0.18, 0.40, AL]} />
                    <meshStandardMaterial color="#c07a0a" roughness={0.48} metalness={0.36} />
                  </mesh>
                  {/* 암 유압실린더 */}
                  <mesh position={[0, -0.26, AL * 0.36]} rotation={[0.22, 0, 0]} castShadow>
                    <cylinderGeometry args={[0.10, 0.10, AL * 0.72, 10]} />
                    <meshStandardMaterial color="#999" metalness={0.88} roughness={0.18} />
                  </mesh>
                  {/* 암 피스톤 로드 */}
                  <mesh position={[0, -0.18, AL * 0.18]} rotation={[0.22, 0, 0]} castShadow>
                    <cylinderGeometry args={[0.055, 0.055, AL * 0.30, 8]} />
                    <meshStandardMaterial color="#ccc" metalness={0.95} roughness={0.08} />
                  </mesh>

                  {/* ── 버킷 (BUCKET) ── */}
                  <group position={[0, 0, AL]}>
                    {/* 암-버킷 연결 핀 */}
                    <mesh rotation={[0, 0, Math.PI / 2]}>
                      <cylinderGeometry args={[0.12, 0.12, 2.10, 10]} />
                      <meshStandardMaterial color="#666" metalness={0.9} roughness={0.2} />
                    </mesh>
                    {/* 버킷 유압실린더 */}
                    <mesh position={[0, 0.22, -buL * 0.28]} rotation={[0.28, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.100, 0.100, buL * 0.72, 8]} />
                      <meshStandardMaterial color="#999" metalness={0.88} roughness={0.18} />
                    </mesh>
                    <mesh position={[0, 0.13, -buL * 0.12]} rotation={[0.28, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.058, 0.058, buL * 0.26, 8]} />
                      <meshStandardMaterial color="#ccc" metalness={0.95} roughness={0.08} />
                    </mesh>

                    <group rotation={[state.bucketAngle * D2R, 0, 0]}>
                      {/* ── 버킷 브라켓 (암과 버킷 연결 링크) ── */}
                      {[-0.58, 0.58].map((x, i) => (
                        <mesh key={`bkt_brk${i}`} position={[x, -0.12, -0.22]} castShadow>
                          <boxGeometry args={[0.16, 0.32, 0.46]} />
                          <meshStandardMaterial color="#4a4a4a" metalness={0.82} roughness={0.3} />
                        </mesh>
                      ))}

                      {/* ── 버킷 백플레이트 (뒷판) ── */}
                      <mesh position={[0, -0.42, -0.10]} castShadow>
                        <boxGeometry args={[2.10, 1.00, 0.16]} />
                        <meshStandardMaterial color="#5c5c5c" metalness={0.76} roughness={0.28} />
                      </mesh>

                      {/* ── 버킷 좌·우 사이드플레이트 ── */}
                      {[-0.97, 0.97].map((x, i) => (
                        <mesh key={`side${i}`} position={[x, -0.42, -buL * 0.50]} castShadow>
                          <boxGeometry args={[0.14, 1.00, buL * 1.02]} />
                          <meshStandardMaterial color="#585858" metalness={0.76} roughness={0.28} />
                        </mesh>
                      ))}

                      {/* ── 버킷 바닥판 ── */}
                      <mesh position={[0, -0.88, -buL * 0.50]} castShadow>
                        <boxGeometry args={[2.10, 0.14, buL * 1.02]} />
                        <meshStandardMaterial color="#525252" metalness={0.80} roughness={0.25} />
                      </mesh>

                      {/* ── 커팅 엣지 (절삭날) ── */}
                      <mesh position={[0, -0.92, -(buL * 0.97 + 0.06)]} castShadow>
                        <boxGeometry args={[2.12, 0.18, 0.14]} />
                        <meshStandardMaterial color="#aaa" metalness={0.96} roughness={0.07} />
                      </mesh>

                      {/* ── 버킷 투스 5개 (굴착 이빨) ── */}
                      {[-0.76, -0.38, 0, 0.38, 0.76].map((x, i) => (
                        <group key={`tooth${i}`} position={[x, -1.06, -(buL * 0.97 + 0.10)]}>
                          {/* 투스 베이스 */}
                          <mesh castShadow>
                            <boxGeometry args={[0.14, 0.18, 0.18]} />
                            <meshStandardMaterial color="#888" metalness={0.90} roughness={0.15} />
                          </mesh>
                          {/* 투스 팁 (뾰족한 끝) */}
                          <mesh position={[0, -0.04, -0.20]} rotation={[-0.4, 0, 0]} castShadow>
                            <coneGeometry args={[0.065, 0.32, 6]} />
                            <meshStandardMaterial color="#777" metalness={0.93} roughness={0.10} />
                          </mesh>
                        </group>
                      ))}

                      {/* ── 버킷 내 흙 ── */}
                      {soilFill > 0.04 && (
                        <mesh position={[0, -0.80 + soilFill * 0.22, -buL * 0.44]}>
                          <boxGeometry args={[1.74, soilFill * 0.60 + 0.08, buL * 0.84]} />
                          <meshStandardMaterial color="#7a5025" roughness={0.96} metalness={0} />
                        </mesh>
                      )}
                    </group>
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

// ── 건설 현장 오버레이 (지면은 TerrainMesh가 담당, 여기선 시설물만) ─────────────
function ConstructionOverlay() {
  return (
    <>
      {/* 공사 울타리 */}
      {Array.from({ length: 11 }, (_, i) => i - 5).map(i => (
        <group key={`fence${i}`} position={[i * 5, 0, -28]}>
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
      {/* 콘크리트 블록 */}
      {[[8, 0.3, -8], [-6, 0.3, 12], [20, 0.3, -4]].map(([x, y, z], i) => (
        <mesh key={`block${i}`} position={[x, y, z]} castShadow receiveShadow>
          <boxGeometry args={[2.5, 0.6, 1.2]} />
          <meshStandardMaterial color="#aaaaaa" roughness={0.7} />
        </mesh>
      ))}
    </>
  );
}

// ── 흙 파티클 3D 렌더러 ────────────────────────────────────────────────────────
function SoilParticles({ particlesRef }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const col = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < MAX_PARTICLES; i++) pos[i * 3 + 1] = -9999;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    return g;
  }, []);

  useFrame((_, delta) => {
    const ps = particlesRef.current;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= delta;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x  += p.vx * delta;
      p.y  += p.vy * delta;
      p.z  += p.vz * delta;
      p.vy -= 13.0 * delta; // 중력
      if (p.y < 0.05) p.y = 0.05; // 지면에서 멈춤
    }

    const posA = geo.attributes.position;
    const colA = geo.attributes.color;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (i < ps.length) {
        const p = ps[i];
        posA.setXYZ(i, p.x, p.y, p.z);
        const t = p.life / p.maxLife;
        if (p.type === 'dump') {
          // 덤핑: 진한 갈색
          colA.setXYZ(i, 0.52 + t * 0.06, 0.32 + t * 0.04, 0.14);
        } else {
          // 굴착: 황토 먼지
          colA.setXYZ(i, 0.68 + t * 0.10, 0.50 + t * 0.06, 0.26);
        }
      } else {
        posA.setXYZ(i, 0, -9999, 0);
        colA.setXYZ(i, 0, 0, 0);
      }
    }
    posA.needsUpdate = true;
    colA.needsUpdate = true;
  });

  return (
    <points>
      <primitive object={geo} attach="geometry" />
      <pointsMaterial size={0.26} vertexColors sizeAttenuation transparent opacity={0.88} />
    </points>
  );
}

// ── 메인 대시보드 ──────────────────────────────────────────────────────────────
export default function SimulationDashboard({ selectedProject, modelData, setViceComponent }) {

  const [state, setState] = useState({ ...DEFAULT_STATE });
  const keysRef    = useRef(new Set());
  const [keysDisplay, setKeysDisplay] = useState(new Set());
  const animRef    = useRef(null);
  const stateRef   = useRef(state);

  // 지형 시스템
  const heightMapRef    = useRef(new Float32Array(GRID_COLS * GRID_ROWS).fill(0));
  const terrainDirtyRef = useRef(false);

  // BEPUphysics2 / rapier 물리 시스템
  // wobbleRef: ExcavatorModel이 직접 읽어 진동 애니메이션에 적용
  const wobbleRef = useRef({ amplitude: 0, frequency: 2.5, dirX: 0, dirZ: 1, time: 0, dangerLevel: 'SAFE' });
  // kinematicsRef: usePhysicsEvaluation 훅이 버킷 반력 계산에 사용
  const kinematicsRef = useRef(null);
  // 지형 변경 시 rapier HeightfieldCollider 재빌드 트리거
  const [terrainPhysicsVersion, setTerrainPhysicsVersion] = useState(0);

  // 버킷 내 흙
  const soilInBucketRef = useRef(0);
  const [soilDisplay, setSoilDisplay] = useState(0);

  // 장비 선택
  const [selectedMachineId, setSelectedMachineId] = useState(DEFAULT_MACHINE.id);
  const machineRef = useRef(DEFAULT_MACHINE);
  const selectedMachineIdRef = useRef(DEFAULT_MACHINE.id);
  useEffect(() => { selectedMachineIdRef.current = selectedMachineId; }, [selectedMachineId]);

  // 덤핑 상태 중복 방지
  const dumpingRef = useRef(false);

  // 흙 파티클 풀
  const particlesRef = useRef([]);

  // 자동 시뮬레이션
  const [autoSim, setAutoSim] = useState(false);
  const autoSimRef   = useRef(false);
  const autoPhaseRef = useRef(0);
  const [autoPhaseLabel, setAutoPhaseLabel] = useState('');

  // 서버 동기화
  const [syncStatus, setSyncStatus] = useState('idle');

  // 모바일 감지 (width < 768px)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  const [kinematics, setKinematics] = useState(null);

  // IoT 센서 모니터링
  const [sensor, setSensor]           = useState(null);
  const [sensorWs, setSensorWs]       = useState('idle'); // 'idle'|'connecting'|'connected'|'disconnected'|'error'
  const [thresholds, setThresholds]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('sim_thresholds')) || DEFAULT_THRESHOLDS; }
    catch { return DEFAULT_THRESHOLDS; }
  });
  const [activeAlerts, setActiveAlerts]   = useState([]);  // 현재 임계값 초과 중인 항목
  const [alertHistory, setAlertHistory]   = useState([]);  // 최근 알림 기록 (최대 20건)
  const [alertPulse, setAlertPulse]       = useState(true);
  const stompClientRef  = useRef(null);
  const thresholdsRef   = useRef(thresholds);
  const wasAlertingRef  = useRef(false);

  // stateRef 항상 최신 유지
  useEffect(() => { stateRef.current = state; }, [state]);

  // 지형이 변경된 후 3초마다 rapier HeightfieldCollider 갱신
  useEffect(() => {
    const id = setInterval(() => {
      if (terrainDirtyRef.current) setTerrainPhysicsVersion(v => v + 1);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // BEPUphysics2 물리 평가 훅 (C# 서버 폴링)
  const physicsResult = usePhysicsEvaluation(
    stateRef, machineRef, kinematicsRef, heightMapRef, wobbleRef);

  // 임계값 ref 동기화 + localStorage 저장
  useEffect(() => {
    thresholdsRef.current = thresholds;
    try { localStorage.setItem('sim_thresholds', JSON.stringify(thresholds)); } catch {}
  }, [thresholds]);

  // 활성 알림이 있을 때 펄스 토글 (0.8초 간격)
  useEffect(() => {
    if (activeAlerts.length === 0) return;
    const id = setInterval(() => setAlertPulse(p => !p), 800);
    return () => clearInterval(id);
  }, [activeAlerts.length]);

  // WebSocket: IoT 센서 데이터 구독 및 이상 감지
  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(`${WS_BASE}/ws/sensor`),
      reconnectDelay: 5000,
      onConnect: () => {
        setSensorWs('connected');
        client.subscribe('/topic/sensor', (msg) => {
          try {
            const d = JSON.parse(msg.body);
            setSensor(d);
            const t = thresholdsRef.current;
            const ts = new Date().toLocaleTimeString('ko-KR');
            const triggered = [];
            if (d.temperature > t.tempMax)
              triggered.push({ id: 'TEMP_HIGH', level: 'danger',  text: `High Temp Alert: ${d.temperature}°C (Max allowed ${t.tempMax}°C)`, ts });
            if (d.temperature < t.tempMin)
              triggered.push({ id: 'TEMP_LOW',  level: 'danger',  text: `Low Temp Alert: ${d.temperature}°C (Min allowed ${t.tempMin}°C)`, ts });
            if (d.humidity > t.humMax)
              triggered.push({ id: 'HUM_HIGH',  level: 'warning', text: `High Humidity Alert: ${d.humidity}% (Max allowed ${t.humMax}%)`, ts });
            if (d.humidity < t.humMin)
              triggered.push({ id: 'HUM_LOW',   level: 'warning', text: `Low Humidity Alert: ${d.humidity}% (Min allowed ${t.humMin}%)`, ts });
            setActiveAlerts(triggered);
            if (triggered.length > 0) {
              setAlertHistory(prev => [...triggered.map(a => ({ ...a, uid: `${a.id}_${Date.now()}` })), ...prev].slice(0, 20));
              if (!wasAlertingRef.current) {
                wasAlertingRef.current = true;
                AxiosCustom.post('/api/alert/led/on').catch(() => {});
              }
            } else if (wasAlertingRef.current) {
              wasAlertingRef.current = false;
              AxiosCustom.post('/api/alert/led/off').catch(() => {});
            }
          } catch {}
        });
      },
      onDisconnect:     () => setSensorWs('disconnected'),
      onStompError:     () => setSensorWs('error'),
      onWebSocketClose: () => setSensorWs('disconnected'),
    });
    setSensorWs('connecting');
    client.activate();
    stompClientRef.current = client;
    return () => client.deactivate();
  }, []);

  // 서버에서 초기 상태 로드 (지형 + 장비 선택 포함) — 프로젝트별 분리
  useEffect(() => {
    const excavatorId = selectedProject?.projectId || 'EX-001';
    // 프로젝트 전환 시 지형·버킷 초기화
    heightMapRef.current.fill(0);
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
    terrainDirtyRef.current = true;
    setState({ ...DEFAULT_STATE, excavatorId });

    AxiosCustom.get(`/api/simulation/excavator?excavatorId=${excavatorId}`)
      .then(res => {
        if (!res.data) return;
        setState(prev => ({ ...prev, ...res.data }));
        if (res.data.heightMapData) {
          deserializeTerrain(res.data.heightMapData, heightMapRef.current);
          terrainDirtyRef.current = true;
        }
        if (res.data.soilInBucket != null) {
          soilInBucketRef.current = res.data.soilInBucket;
          setSoilDisplay(res.data.soilInBucket);
        }
        if (res.data.selectedMachineId && MACHINE_CONFIGS[res.data.selectedMachineId]) {
          const m = MACHINE_CONFIGS[res.data.selectedMachineId];
          setSelectedMachineId(res.data.selectedMachineId);
          selectedMachineIdRef.current = res.data.selectedMachineId;
          machineRef.current = m;
        }
      })
      .catch(() => {});
  }, [selectedProject?.projectId]);

  // ── 키보드 이벤트 ──
  useEffect(() => {
    const CONTROLLED = new Set([
      'w','a','s','d','q','e','r','f','t','g','y','h',
      'W','A','S','D','Q','E','R','F','T','G','Y','H',
      'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
    ]);
    const onDown = e => {
      if (CONTROLLED.has(e.key)) {
        e.preventDefault();
        // 키 입력 시 자동 시뮬레이션 중지
        if (autoSimRef.current) { autoSimRef.current = false; setAutoSim(false); }
      }
      keysRef.current.add(e.key);
      setKeysDisplay(new Set(keysRef.current));
    };
    const onUp   = e => { keysRef.current.delete(e.key); setKeysDisplay(new Set(keysRef.current)); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);

  // ── 제어 루프 (~60fps) ──
  useEffect(() => {
    const MOVE_SPEED  = 0.07;
    const ROT_SPEED   = 1.0;
    const JOINT_SPEED = 0.6;

    const tick = () => {
      const keys = keysRef.current;
      if (keys.size > 0) {
        setState(prev => {
          const s = { ...prev };
          const cos = Math.cos(s.bodyRotation * D2R);
          const sin = Math.sin(s.bodyRotation * D2R);
          if (keys.has('w') || keys.has('W') || keys.has('ArrowUp'))    { s.positionX += sin * MOVE_SPEED; s.positionZ += cos * MOVE_SPEED; }
          if (keys.has('s') || keys.has('S') || keys.has('ArrowDown'))  { s.positionX -= sin * MOVE_SPEED; s.positionZ -= cos * MOVE_SPEED; }
          if (keys.has('a') || keys.has('A') || keys.has('ArrowLeft'))  s.bodyRotation -= ROT_SPEED;
          if (keys.has('d') || keys.has('D') || keys.has('ArrowRight')) s.bodyRotation += ROT_SPEED;
          if (keys.has('q') || keys.has('Q')) s.swingAngle -= JOINT_SPEED * 1.8;
          if (keys.has('e') || keys.has('E')) s.swingAngle += JOINT_SPEED * 1.8;
          if (keys.has('r') || keys.has('R')) s.boomAngle = clamp(s.boomAngle + JOINT_SPEED, JOINT_LIMITS.boomAngle.min, JOINT_LIMITS.boomAngle.max);
          if (keys.has('f') || keys.has('F')) s.boomAngle = clamp(s.boomAngle - JOINT_SPEED, JOINT_LIMITS.boomAngle.min, JOINT_LIMITS.boomAngle.max);
          if (keys.has('t') || keys.has('T')) s.armAngle = clamp(s.armAngle + JOINT_SPEED, JOINT_LIMITS.armAngle.min, JOINT_LIMITS.armAngle.max);
          if (keys.has('g') || keys.has('G')) s.armAngle = clamp(s.armAngle - JOINT_SPEED, JOINT_LIMITS.armAngle.min, JOINT_LIMITS.armAngle.max);
          if (keys.has('y') || keys.has('Y')) s.bucketAngle = clamp(s.bucketAngle + JOINT_SPEED, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
          if (keys.has('h') || keys.has('H')) s.bucketAngle = clamp(s.bucketAngle - JOINT_SPEED, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
          return s;
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  // ── 자동 시뮬레이션 사이클 ──
  useEffect(() => {
    if (!autoSim) { setAutoPhaseLabel(''); return; }
    autoPhaseRef.current = 0;
    let rafId = null;
    const LERP = 0.028;

    const animTick = () => {
      const phase = AUTO_SIM_PHASES[autoPhaseRef.current];
      setState(prev => {
        const s = { ...prev };
        s.boomAngle   = s.boomAngle   + (phase.boomAngle   - s.boomAngle)   * LERP;
        s.armAngle    = s.armAngle    + (phase.armAngle    - s.armAngle)    * LERP;
        s.bucketAngle = s.bucketAngle + (phase.bucketAngle - s.bucketAngle) * LERP;
        s.swingAngle  = s.swingAngle  + (phase.swingAngle  - s.swingAngle)  * LERP;
        if (phase.dz) {
          const cos = Math.cos(s.bodyRotation * D2R);
          const sin = Math.sin(s.bodyRotation * D2R);
          s.positionX += sin * phase.dz;
          s.positionZ += cos * phase.dz;
        }
        return s;
      });
      rafId = requestAnimationFrame(animTick);
    };
    rafId = requestAnimationFrame(animTick);
    setAutoPhaseLabel(AUTO_SIM_PHASES[0].name);

    const phaseInterval = setInterval(() => {
      autoPhaseRef.current = (autoPhaseRef.current + 1) % AUTO_SIM_PHASES.length;
      setAutoPhaseLabel(AUTO_SIM_PHASES[autoPhaseRef.current].name);
    }, AUTO_SIM_PHASES[autoPhaseRef.current]?.duration ?? 1500);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      clearInterval(phaseInterval);
    };
  }, [autoSim]);

  // ── 자동 서버 동기화 (2초, 지형 + 장비 선택 포함) ──
  useEffect(() => {
    const id = setInterval(() => {
      setSyncStatus('syncing');
      const excavatorId = selectedProject?.projectId || 'EX-001';
      const payload = {
        ...stateRef.current,
        excavatorId,
        soilInBucket: soilInBucketRef.current,
        heightMapData: serializeTerrain(heightMapRef.current),
        selectedMachineId: selectedMachineIdRef.current,
      };
      AxiosCustom.put('/api/simulation/excavator', payload)
        .then(() => setSyncStatus('synced'))
        .catch(() => setSyncStatus('error'));
    }, 2000);
    return () => clearInterval(id);
  }, [selectedProject?.projectId]);

  // ── 순기구학 계산 (장비 사양 반영, 차체+선회 합산) ──
  const calcKinematics = useCallback((s, machine) => {
    const boomRad      = s.boomAngle   * D2R;
    const armRad       = s.armAngle    * D2R;
    const bucketRad    = s.bucketAngle * D2R;
    const totalRad     = (s.bodyRotation + s.swingAngle) * D2R;
    const armAbsRad    = boomRad - armRad;
    const bucketAbsRad = armAbsRad - bucketRad;
    const ms           = machine.bodyScale;

    // 붐 피벗 월드 오프셋 = [0, 1.4*ms, 1.9*ms] (스케일 그룹 기준)
    const localZ = 1.9 * ms
                 + machine.boomLen * Math.cos(boomRad)
                 + machine.armLen  * Math.cos(armAbsRad)
                 + machine.bucketLen * Math.cos(bucketAbsRad);
    const localY = 1.4 * ms
                 + machine.boomLen * Math.sin(boomRad)
                 + machine.armLen  * Math.sin(armAbsRad)
                 + machine.bucketLen * Math.sin(bucketAbsRad);

    const worldX = s.positionX + Math.sin(totalRad) * localZ;
    const worldY = s.positionY + 0.72 * ms + localY;
    const worldZ = s.positionZ + Math.cos(totalRad) * localZ;

    return {
      tipX:  worldX.toFixed(2),
      tipY:  worldY.toFixed(2),
      tipZ:  worldZ.toFixed(2),
      reach: Math.abs(localZ).toFixed(2),
    };
  }, []);

  // ── 굴착 & 덤핑 로직 ──
  useEffect(() => {
    const machine = machineRef.current;
    const km      = calcKinematics(state, machine);
    const tipX    = parseFloat(km.tipX);
    const tipY    = parseFloat(km.tipY);
    const tipZ    = parseFloat(km.tipZ);

    const terrH    = sampleH(heightMapRef.current, tipX, tipZ);
    const digDepth = Math.max(0, terrH - tipY);

    const kmFull = { ...km, depth: digDepth.toFixed(2), terrainH: terrH.toFixed(2) };
    setKinematics(kmFull);
    kinematicsRef.current = kmFull;

    // ── 굴착: 버킷이 지형 아래에 있을 때 흙 제거 ──
    const maxBucket = machine.bucketCapacity;
    if (digDepth > 0.05 && soilInBucketRef.current < maxBucket) {
      const cell = worldToCell(tipX, tipZ);
      if (cell.valid) {
        const rate = Math.min(machine.digRate, digDepth * 0.055);
        applyExcavation(heightMapRef.current, cell.col, cell.row, rate, machine.digRadius);
        soilInBucketRef.current = Math.min(maxBucket, soilInBucketRef.current + rate * 0.9);
        terrainDirtyRef.current = true;
        setSoilDisplay(soilInBucketRef.current);
        if (particlesRef.current.length < MAX_PARTICLES) {
          const emit = Math.min(5, MAX_PARTICLES - particlesRef.current.length);
          for (let i = 0; i < emit; i++)
            particlesRef.current.push(createParticle(tipX, Math.max(tipY, 0.1), tipZ, 'dig'));
        }
      }
    }

    // ── 덤핑: 버킷 각도 < -65° (열린 상태) + 지면 위 0.4m 이상 + 흙 있음 ──
    if (state.bucketAngle < -65 && tipY > 0.4 && soilInBucketRef.current > 0.01) {
      const cell = worldToCell(tipX, tipZ);
      if (cell.valid) {
        const dumpRate = 0.05;
        // const amount   = Math.min(dumpRate, soilInBucketRef.current);
        // applyFill(heightMapRef.current, cell.col, cell.row, amount);
        const amount = Math.min(machine.fillRate, soilInBucketRef.current);
        applyFill(heightMapRef.current, cell.col, cell.row, amount * 0.92, machine.fillRadius);
        soilInBucketRef.current = Math.max(0, soilInBucketRef.current - amount);
        terrainDirtyRef.current = true;
        setSoilDisplay(soilInBucketRef.current);
        if (particlesRef.current.length < MAX_PARTICLES) {
          const emit = Math.min(7, MAX_PARTICLES - particlesRef.current.length);
          for (let i = 0; i < emit; i++)
            particlesRef.current.push(createParticle(tipX, tipY, tipZ, 'dump'));
        }
      }
    }
  }, [state, calcKinematics]);

  // ── UI 핸들러 ──
  const applyPreset = (name) => setState(prev => ({ ...prev, ...PRESETS[name], operationMode: name }));
  const setJoint    = (key, value) => { const lim = JOINT_LIMITS[key]; setState(prev => ({ ...prev, [key]: lim ? clamp(value, lim.min, lim.max) : value })); };

  const handleMachineChange = (machineId) => {
    const m = MACHINE_CONFIGS[machineId];
    setSelectedMachineId(machineId);
    machineRef.current = m;
    setState(prev => ({ ...prev, ...PRESETS.IDLE, operationMode: 'IDLE' }));
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
  };

  const handleClearTerrain = () => {
    heightMapRef.current.fill(0);
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
    terrainDirtyRef.current = true;
  };

  const handleReset = () => {
    const excavatorId = selectedProject?.projectId || 'EX-001';
    setState({ ...DEFAULT_STATE, excavatorId });
    heightMapRef.current.fill(0);
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
    terrainDirtyRef.current = true;
    AxiosCustom.post(`/api/simulation/excavator/reset?excavatorId=${excavatorId}`).catch(() => {});
  };

  const handleSave = () => {
    const excavatorId = selectedProject?.projectId || 'EX-001';
    setSyncStatus('syncing');
    const payload = {
      ...state,
      excavatorId,
      soilInBucket: soilInBucketRef.current,
      heightMapData: serializeTerrain(heightMapRef.current),
      selectedMachineId,
    };
    AxiosCustom.put('/api/simulation/excavator', payload)
      .then(() => setSyncStatus('synced'))
      .catch(() => setSyncStatus('error'));
  };

  const pressKey   = (k) => { keysRef.current.add(k);    setKeysDisplay(new Set(keysRef.current)); };
  const releaseKey = (k) => { keysRef.current.delete(k); setKeysDisplay(new Set(keysRef.current)); };

  // ── 스타일 ──
  const panelBg    = '#0d1b2a';
  const panelBorder = '1px solid #253347';
  const secColor   = '#8896a4';
  const accentBlue = '#60a5fa';
  const syncColor  = syncStatus === 'synced' ? '#4ade80' : syncStatus === 'error' ? '#f87171' : syncStatus === 'syncing' ? '#facc15' : '#8896a4';

  const isDigging = kinematics && parseFloat(kinematics.depth) > 0.05;
  const isDumping = state.bucketAngle < -65 && soilDisplay > 0.02;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>

      {/* ── 프로젝트 헤더 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '8px 4px 12px', borderBottom: '1px solid #1e3a5f', marginBottom: '10px',
      }}>
        {setViceComponent && (
          <button
            onClick={() => setViceComponent('simulation-projects')}
            style={{ color: '#8896a4', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ← List
          </button>
        )}
        <span style={{ color: '#f5a623', fontSize: '15px', fontWeight: 700 }}>
          🚜 {selectedProject?.projectName ?? 'Simulation'}
        </span>
        <span style={{
          fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
          backgroundColor: '#1a2a0a', color: '#f5a623', border: '1px solid #f5a62340',
        }}>
          Excavator
        </span>
      </div>

    {!isMobile && <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 175px)', gap: '10px' }}>

      {/* ── 왼쪽 상태 패널 ── */}
      <div style={{
        width: '210px', flexShrink: 0, background: panelBg, border: panelBorder,
        borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column',
        gap: '10px', overflowY: 'auto', fontSize: '12px',
      }}>
        <div style={{ color: accentBlue, fontSize: '13px', fontWeight: 700, borderBottom: '1px solid #1e3a5f', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🚧 Equipment Status
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: syncColor }}>
            {syncStatus === 'syncing' ? '⟳' : syncStatus === 'synced' ? '✓' : syncStatus === 'error' ? '✗' : '○'}
          </span>
        </div>

        {/* 작동 모드 */}
        <div style={{
          background: isDigging ? '#1a1200' : isDumping ? '#0d1a12' : '#111e2e',
          border: isDigging ? '1px solid #8a5a00' : isDumping ? '1px solid #1a6040' : '1px solid transparent',
          borderRadius: '8px', padding: '9px', transition: 'all 0.3s',
        }}>
          <div style={{ color: secColor, marginBottom: '4px', fontSize: '10px' }}>Operation Mode</div>
          <div style={{ color: '#f5a623', fontWeight: 700, fontSize: '13px' }}>● {state.operationMode}</div>
          {isDigging && (
            <div style={{ marginTop: '6px', background: '#3a1a00', borderRadius: '5px', padding: '4px 8px', fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>
              ⛏ Digging ({kinematics.depth}m)
            </div>
          )}
          {isDumping && (
            <div style={{ marginTop: '6px', background: '#0d3020', borderRadius: '5px', padding: '4px 8px', fontSize: '11px', color: '#34d399', fontWeight: 700 }}>
              🪣 Dumping
            </div>
          )}
        </div>

        {/* 버킷 흙 게이지 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
          <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
            <span>Bucket Load</span>
            <span style={{ color: '#fb923c', fontFamily: 'monospace' }}>{soilDisplay.toFixed(2)} / {MACHINE_CONFIGS[selectedMachineId].bucketCapacity} m³</span>
          </div>
          <div style={{ background: '#1e2e3e', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
            <div style={{
              width: `${(soilDisplay / MACHINE_CONFIGS[selectedMachineId].bucketCapacity) * 100}%`,
              height: '100%',
              background: soilDisplay > MACHINE_CONFIGS[selectedMachineId].bucketCapacity * 0.8 ? '#f87171' : soilDisplay > MACHINE_CONFIGS[selectedMachineId].bucketCapacity * 0.4 ? '#fb923c' : '#6b4416',
              transition: 'width 0.1s, background 0.3s',
              borderRadius: '4px',
            }} />
          </div>
        </div>

        {/* 위치 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
          <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px' }}>Position (m)</div>
          {[['X', state.positionX], ['Y', state.positionY], ['Z', state.positionZ]].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{Number(v).toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* 관절 각도 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
          <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px' }}>Joint Angles (°)</div>
          {[
            ['Body Rotation', state.bodyRotation, '#94a3b8'],
            ['Swing',        state.swingAngle,    '#a78bfa'],
            ['Boom',         state.boomAngle,     accentBlue],
            ['Arm',          state.armAngle,      '#34d399'],
            ['Bucket',       state.bucketAngle,   '#fb923c'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: c, fontFamily: 'monospace', fontWeight: 600 }}>{Math.round(v)}°</span>
            </div>
          ))}
        </div>

        {/* 버킷 끝 위치 */}
        {kinematics && (
          <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
            <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px' }}>Bucket Tip Position</div>
            {[['X', kinematics.tipX], ['Y', kinematics.tipY], ['Z', kinematics.tipZ]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: secColor }}>{l}</span>
                <span style={{ color: '#fbbf24', fontFamily: 'monospace' }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid #1e3a5f', marginTop: '6px', paddingTop: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: secColor }}>Terrain Height</span>
                <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{kinematics.terrainH}m</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: secColor }}>Horizontal Reach</span>
                <span style={{ color: '#34d399', fontFamily: 'monospace' }}>{kinematics.reach}m</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: secColor }}>Dig Depth</span>
                <span style={{ color: '#fb923c', fontFamily: 'monospace' }}>{kinematics.depth}m</span>
              </div>
            </div>
          </div>
        )}

        {/* 장비 정보 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '4px' }}>Equipment ID</div>
          <div style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{state.excavatorId}</div>
          <div style={{ color: secColor, marginTop: '6px', marginBottom: '4px' }}>Sync</div>
          <div style={{ color: syncColor }}>
            {syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'synced' ? 'C# Server Synced' : syncStatus === 'error' ? 'Sync Failed' : 'Standby'}
          </div>
        </div>

        {/* BEPUphysics2 물리 안정도 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
            <span>⚖ Physics Stability</span>
            {physicsResult && (
              <span style={{
                color: physicsResult.dangerLevel === 'DANGER' ? '#ef4444'
                     : physicsResult.dangerLevel === 'WARNING' ? '#f59e0b' : '#4ade80',
                fontWeight: 700,
              }}>
                {physicsResult.dangerLevel}
              </span>
            )}
          </div>
          {physicsResult ? (
            <>
              {/* 안정도 막대 */}
              <div style={{ background: '#1e2e3e', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '6px' }}>
                <div style={{
                  width: `${Math.max(0, physicsResult.stabilityMargin * 100)}%`,
                  height: '100%',
                  background: physicsResult.dangerLevel === 'DANGER' ? '#ef4444'
                            : physicsResult.dangerLevel === 'WARNING' ? '#f59e0b' : '#4ade80',
                  transition: 'width 0.3s, background 0.3s',
                  borderRadius: '4px',
                }} />
              </div>
              {[
                ['Stability Margin', `${(physicsResult.stabilityMargin * 100).toFixed(0)}%`],
                ['CoM X / Y', `${physicsResult.comX?.toFixed(2)} / ${physicsResult.comY?.toFixed(2)}`],
                ['Vibration Amplitude', `${(physicsResult.wobbleAmplitude * 1000).toFixed(1)} mrad`],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ color: secColor }}>{l}</span>
                  <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{v}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: '#3a4a5a', textAlign: 'center', padding: '4px 0' }}>
              Connecting to C# Physics Server...
            </div>
          )}
        </div>

        {/* IoT 센서 모니터링 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🌡 IoT Sensor</span>
            <span style={{ color: sensorWs === 'connected' ? '#4ade80' : sensorWs === 'error' ? '#f87171' : '#facc15', fontSize: '9px' }}>
              {sensorWs === 'connected' ? '● Connected' : sensorWs === 'connecting' ? '○ Connecting' : sensorWs === 'error' ? '✗ Error' : '○ Standby'}
            </span>
          </div>
          {sensor ? (
            <>
              {[
                ['Temperature', `${sensor.temperature}°C`, sensor.temperature > thresholds.tempMax || sensor.temperature < thresholds.tempMin ? '#f87171' : '#4ade80'],
                ['Humidity',    `${sensor.humidity}%`,     sensor.humidity > thresholds.humMax || sensor.humidity < thresholds.humMin ? '#f87171' : '#4ade80'],
                ['Location',    sensor.location,            '#e2e8f0'],
              ].map(([label, value, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ color: secColor }}>{label}</span>
                  <span style={{ color, fontFamily: 'monospace', fontWeight: 700 }}>{value}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: '#3a4a5a', textAlign: 'center', padding: '4px 0' }}>Waiting for data...</div>
          )}
        </div>

        {/* 알림 기록 */}
        {alertHistory.length > 0 && (
          <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
            <div style={{ color: secColor, marginBottom: '6px' }}>📋 Alert Log</div>
            <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {alertHistory.map((a) => (
                <div key={a.uid} style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                  <span style={{ color: a.level === 'danger' ? '#f87171' : '#fbbf24', flexShrink: 0 }}>
                    {a.level === 'danger' ? '🚨' : '⚠️'}
                  </span>
                  <div>
                    <div style={{ color: a.level === 'danger' ? '#fca5a5' : '#fde68a', lineHeight: 1.4 }}>{a.text}</div>
                    <div style={{ color: '#3a4a5a' }}>{a.ts}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 중앙 3D 캔버스 ── */}
      <div style={{ flex: 1, height: '100%', borderRadius: '12px', overflow: 'hidden', border: panelBorder, position: 'relative' }}>
        {/* 키보드 가이드 */}
        <div style={{
          position: 'absolute', top: '12px', left: '12px', zIndex: 10,
          background: 'rgba(13,27,42,0.88)', border: '1px solid #253347',
          borderRadius: '10px', padding: '10px 14px', fontSize: '11px',
          color: secColor, lineHeight: 1.7, pointerEvents: 'none',
        }}>
          <div style={{ color: accentBlue, fontWeight: 700, marginBottom: '4px', fontSize: '12px' }}>⌨ Keyboard Controls</div>
          {[['W / S','Forward / Backward'],['A / D','Body Rotation'],['Q / E','Swing ±'],['R / F','Boom Up/Down'],['T / G','Arm Bend'],['Y / H','Bucket Rotate']].map(([k,v]) => (
            <div key={k} style={{ display: 'flex', gap: '6px' }}>
              <span style={{ color: '#e2e8f0', minWidth: '60px', fontFamily: 'monospace' }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: '6px', borderTop: '1px solid #253347', paddingTop: '6px', fontSize: '10px', color: '#fbbf24' }}>
            Press T/G with bucket on ground → Dig<br/>
            Swing with Q/E then open bucket with H → Dump
          </div>
        </div>

        {/* 장비 배지 */}
        <div style={{
          position: 'absolute', top: '12px', right: '12px', zIndex: 10,
          background: 'rgba(13,27,42,0.88)', border: '1px solid #253347',
          borderRadius: '8px', padding: '6px 12px', fontSize: '12px',
          color: '#f5a623', fontWeight: 700, pointerEvents: 'none',
        }}>
          🚜 {MACHINE_CONFIGS[selectedMachineId].label} Excavator
        </div>

        {/* 이상 감지 알림 오버레이 */}
        {activeAlerts.length > 0 && (
          <div style={{
            position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 20, display: 'flex', flexDirection: 'column', gap: '5px',
            maxWidth: '460px', width: 'calc(100% - 48px)',
          }}>
            {activeAlerts.map(alert => {
              const c = ALERT_COLORS[alert.level];
              return (
                <div key={alert.id} style={{
                  background: c.bg,
                  border: `${alertPulse ? 2 : 1}px solid ${c.border}`,
                  borderRadius: '9px', padding: '8px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  color: c.text, fontSize: '12px', fontWeight: 700,
                  boxShadow: alertPulse ? `0 0 16px ${c.glow}` : 'none',
                  transition: 'box-shadow 0.3s, border-width 0.3s',
                }}>
                  <span>{alert.level === 'danger' ? '🚨' : '⚠️'} {alert.text}</span>
                  <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '10px', flexShrink: 0 }}>{alert.ts}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 굴착/덤핑 상태 HUD */}
        {(isDigging || isDumping) && (
          <div style={{
            position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, background: isDigging ? 'rgba(58,26,0,0.92)' : 'rgba(13,48,32,0.92)',
            border: `1px solid ${isDigging ? '#8a5a00' : '#1a6040'}`,
            borderRadius: '10px', padding: '8px 20px', fontSize: '13px',
            color: isDigging ? '#fbbf24' : '#34d399', fontWeight: 700, pointerEvents: 'none',
          }}>
            {isDigging
              ? `⛏ Digging — depth ${kinematics.depth}m | load ${soilDisplay.toFixed(1)} m³`
              : `🪣 Dump — (${kinematics?.tipX ?? 0}, ${kinematics?.tipZ ?? 0}) | remaining ${soilDisplay.toFixed(1)} m³`}
          </div>
        )}

        {/* BEPUphysics2 안정성 경고 오버레이 */}
        {physicsResult && physicsResult.dangerLevel !== 'SAFE' && (
          <div style={{
            position: 'absolute', bottom: '60px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 15, maxWidth: '480px', width: 'calc(100% - 48px)',
            display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'none',
          }}>
            <div style={{
              background: physicsResult.dangerLevel === 'DANGER'
                ? 'rgba(127,29,29,0.96)' : 'rgba(92,60,0,0.96)',
              border: `2px solid ${physicsResult.dangerLevel === 'DANGER' ? '#ef4444' : '#f59e0b'}`,
              borderRadius: '10px', padding: '8px 16px',
              color: physicsResult.dangerLevel === 'DANGER' ? '#fca5a5' : '#fde68a',
              fontSize: '13px', fontWeight: 700,
              boxShadow: `0 0 16px ${physicsResult.dangerLevel === 'DANGER' ? '#ef444840' : '#f59e0b40'}`,
            }}>
              {physicsResult.dangerLevel === 'DANGER' ? '⚠ Tip-Over Risk' : '⚠ Stability Warning'}
              {' — '}Stability {(physicsResult.stabilityMargin * 100).toFixed(0)}%
              {' | '}CoM ({physicsResult.comX?.toFixed(1)}, {physicsResult.comY?.toFixed(1)})
            </div>
            {physicsResult.alerts?.map((a, i) => (
              <div key={i} style={{
                background: 'rgba(30,10,10,0.88)', border: '1px solid #7f1d1d',
                borderRadius: '7px', padding: '5px 14px', color: '#fca5a5', fontSize: '11px',
              }}>{a}</div>
            ))}
          </div>
        )}

        <Canvas shadows camera={{ position: [22, 14, 28], fov: 52 }} style={{ background: '#1a2a3a', width: '100%', height: '100%' }}>
          {/* @react-three/rapier Physics 컨텍스트: 지형 콜라이더 + 굴착기 충돌 프록시 */}
          <Physics gravity={[0, -9.81, 0]} colliders={false}>
            <Sky sunPosition={[100, 40, 100]} turbidity={6} rayleigh={0.6} mieCoefficient={0.005} mieDirectionalG={0.8} />
            <ambientLight intensity={0.55} />
            <directionalLight
              position={[60, 70, 40]} intensity={1.3} castShadow
              shadow-mapSize-width={2048} shadow-mapSize-height={2048}
              shadow-camera-far={200} shadow-camera-left={-70}
              shadow-camera-right={70} shadow-camera-top={70} shadow-camera-bottom={-70}
            />
            <pointLight position={[-20, 8, -20]} intensity={0.25} color="#ff9944" />
            <pointLight position={[25, 6, 25]}   intensity={0.2}  color="#4488ff" />

            {/* rapier 지형 Heightfield 콜라이더 (3초마다 갱신) */}
            <TerrainRapierCollider heightMapRef={heightMapRef} version={terrainPhysicsVersion} />
            {/* rapier 굴착기 충돌 프록시 */}
            <ExcavatorCollider stateRef={stateRef} machine={MACHINE_CONFIGS[selectedMachineId]} />

            {/* 동적 지형 메시 */}
            <TerrainMesh heightMapRef={heightMapRef} dirtyRef={terrainDirtyRef} />
            <ConstructionOverlay />
            {/* wobbleRef 전달 → BEPUphysics2 진동 파라미터로 실시간 흔들림 적용 */}
            <ExcavatorModel
              state={state}
              soilInBucket={soilDisplay}
              machine={MACHINE_CONFIGS[selectedMachineId]}
              heightMapRef={heightMapRef}
              wobbleRef={wobbleRef}
            />
            {/* 흙 파티클 */}
            <SoilParticles particlesRef={particlesRef} />

            <OrbitControls enableDamping dampingFactor={0.06} minDistance={4} maxDistance={120} maxPolarAngle={Math.PI / 2 - 0.02} />
            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport labelColor="white" axisHeadScale={0.85} />
            </GizmoHelper>
          </Physics>
        </Canvas>
      </div>

      {/* ── 오른쪽 조작 패널 ── */}
      <div style={{
        width: '250px', flexShrink: 0, background: panelBg, border: panelBorder,
        borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column',
        gap: '14px', overflowY: 'auto', fontSize: '12px',
      }}>
        <div style={{ color: accentBlue, fontSize: '13px', fontWeight: 700, borderBottom: '1px solid #1e3a5f', paddingBottom: '8px' }}>
          🎮 Manual Control
        </div>

        {/* 장비 선택 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px', letterSpacing: '0.04em' }}>⚙ Equipment Select</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {Object.values(MACHINE_CONFIGS).map(mc => {
              const active = selectedMachineId === mc.id;
              return (
                <button
                  key={mc.id}
                  onClick={() => handleMachineChange(mc.id)}
                  style={{
                    background: active ? '#0f2a18' : '#162032',
                    border: `1px solid ${active ? '#22c55e' : '#253347'}`,
                    borderRadius: '8px', padding: '7px 10px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: 'pointer', transition: 'all 0.15s', width: '100%',
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: active ? '#4ade80' : '#e2e8f0', fontWeight: 700, fontSize: '12px' }}>{mc.label}</div>
                    <div style={{ color: active ? '#86efac' : secColor, fontSize: '10px', marginTop: '1px' }}>{mc.subLabel}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: active ? '#86efac' : '#3a4a5a', fontSize: '10px' }}>{mc.weight}</div>
                    <div style={{ color: active ? '#4ade80' : '#253347', fontSize: '10px', fontFamily: 'monospace' }}>
                      {mc.bucketCapacity} m³
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 방향키 패드 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>Travel / Rotate</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', width: '130px', margin: '0 auto' }}>
            <button style={dirBtnStyle('w', keysDisplay)} onMouseDown={() => pressKey('w')} onMouseUp={() => releaseKey('w')} onMouseLeave={() => releaseKey('w')} onTouchStart={() => pressKey('w')} onTouchEnd={() => releaseKey('w')}>↑</button>
            <button style={{ ...dirBtnStyle('a', keysDisplay), gridColumn: 1, gridRow: 2 }} onMouseDown={() => pressKey('a')} onMouseUp={() => releaseKey('a')} onMouseLeave={() => releaseKey('a')} onTouchStart={() => pressKey('a')} onTouchEnd={() => releaseKey('a')}>↶</button>
            <button style={{ ...dirBtnStyle('s', keysDisplay), gridColumn: 2, gridRow: 2 }} onMouseDown={() => pressKey('s')} onMouseUp={() => releaseKey('s')} onMouseLeave={() => releaseKey('s')} onTouchStart={() => pressKey('s')} onTouchEnd={() => releaseKey('s')}>↓</button>
            <button style={{ ...dirBtnStyle('d', keysDisplay), gridColumn: 3, gridRow: 2 }} onMouseDown={() => pressKey('d')} onMouseUp={() => releaseKey('d')} onMouseLeave={() => releaseKey('d')} onTouchStart={() => pressKey('d')} onTouchEnd={() => releaseKey('d')}>↷</button>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'center' }}>
            {[['q','↺ Swing←'],['e','Swing→ ↻']].map(([k, label]) => (
              <button key={k} style={jointBtnStyle(k, keysDisplay, '#a78bfa')}
                onMouseDown={() => pressKey(k)} onMouseUp={() => releaseKey(k)} onMouseLeave={() => releaseKey(k)}
                onTouchStart={() => pressKey(k)} onTouchEnd={() => releaseKey(k)}>{label}</button>
            ))}
          </div>
        </div>

        {/* 관절 슬라이더 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>Joint Detail Control</div>
          {[
            { label: '붐 (Boom)',   key: 'boomAngle',   ...JOINT_LIMITS.boomAngle,   color: accentBlue,  keys: ['r','f'], keylabels: ['R↑','F↓'] },
            { label: '암 (Arm)',    key: 'armAngle',    ...JOINT_LIMITS.armAngle,    color: '#34d399',   keys: ['t','g'], keylabels: ['T↑','G↓'] },
            { label: '버킷 (Bucket)', key: 'bucketAngle', ...JOINT_LIMITS.bucketAngle, color: '#fb923c', keys: ['y','h'], keylabels: ['Y↑','H↓'] },
          ].map(({ label, key, min, max, color, keys: kk, keylabels }) => (
            <div key={key} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center' }}>
                <span style={{ color: secColor }}>{label}</span>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {kk.map((k, i) => (
                    <button key={k} style={{ background: keysDisplay.has(k) ? '#1e3a5f' : '#162032', border: `1px solid ${keysDisplay.has(k) ? color : '#253347'}`, borderRadius: '4px', color: keysDisplay.has(k) ? color : '#8896a4', padding: '1px 5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                      onMouseDown={() => pressKey(k)} onMouseUp={() => releaseKey(k)} onMouseLeave={() => releaseKey(k)}
                      onTouchStart={() => pressKey(k)} onTouchEnd={() => releaseKey(k)}>{keylabels[i]}</button>
                  ))}
                  <span style={{ color, fontFamily: 'monospace', fontWeight: 700, minWidth: '36px', textAlign: 'right' }}>{Math.round(state[key])}°</span>
                </div>
              </div>
              <input type="range" min={min} max={max} step={0.5} value={state[key]}
                onChange={e => setJoint(key, parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: color, cursor: 'pointer', height: '4px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3a4a5a', fontSize: '10px', marginTop: '2px' }}>
                <span>{min}°</span><span>{max}°</span>
              </div>
            </div>
          ))}
        </div>

        {/* 작업 프리셋 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>Preset</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {Object.entries(PRESETS).map(([name]) => {
              const active = state.operationMode === name;
              return (
                <button key={name} onClick={() => applyPreset(name)} style={{
                  background: active ? '#1e3a5f' : '#162032',
                  border: `1px solid ${active ? accentBlue : '#253347'}`,
                  borderRadius: '7px', color: active ? accentBlue : secColor,
                  padding: '7px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
                }}>{PRESET_LABELS[name]}</button>
              );
            })}
          </div>
        </div>

        {/* 자동 시뮬레이션 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px', letterSpacing: '0.04em' }}>🤖 Auto Simulation</div>
          <button
            onClick={() => {
              const next = !autoSim;
              setAutoSim(next);
              autoSimRef.current = next;
              if (!next) setAutoPhaseLabel('');
            }}
            style={{
              width: '100%',
              background: autoSim ? '#0f2a18' : '#162032',
              border: `1px solid ${autoSim ? '#22c55e' : '#253347'}`,
              borderRadius: '8px', padding: '9px 10px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            <span style={{ color: autoSim ? '#4ade80' : secColor, fontWeight: 700, fontSize: '12px' }}>
              {autoSim ? '⏹ Stop Auto' : '▶ Start Auto'}
            </span>
            {autoSim && autoPhaseLabel && (
              <span style={{
                background: '#0d3820', border: '1px solid #22c55e44',
                borderRadius: '6px', padding: '2px 8px',
                color: '#86efac', fontSize: '10px', fontWeight: 600,
              }}>
                {autoPhaseLabel}
              </span>
            )}
          </button>
          {autoSim && (
            <div style={{ marginTop: '6px', display: 'flex', gap: '3px' }}>
              {AUTO_SIM_PHASES.map((ph, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1, height: '4px', borderRadius: '2px',
                    background: autoPhaseRef.current === i ? '#4ade80' : '#1e2e3e',
                    transition: 'background 0.3s',
                  }}
                />
              ))}
            </div>
          )}
          {autoSim && (
            <div style={{ marginTop: '5px', fontSize: '10px', color: '#3a5a3a', textAlign: 'center' }}>
              Press any key to stop
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button onClick={handleSave} style={{ background: '#0d2420', border: '1px solid #1a5040', borderRadius: '8px', color: '#4ade80', padding: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            💾 Save State (C# Server)
          </button>
          <button onClick={handleClearTerrain} style={{ background: '#1a1200', border: '1px solid #4a3000', borderRadius: '8px', color: '#fbbf24', padding: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            🗑 Clear Terrain
          </button>
          <button onClick={handleReset} style={{ background: '#2d1010', border: '1px solid #5a2020', borderRadius: '8px', color: '#f87171', padding: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            ↺ Full Reset
          </button>
        </div>

        {/* 이상 감지 임계값 설정 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px', letterSpacing: '0.04em' }}>
            🚨 Alert Thresholds
            {activeAlerts.length > 0 && (
              <span style={{ marginLeft: '6px', color: activeAlerts.some(a => a.level === 'danger') ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
                ({activeAlerts.length}건 초과)
              </span>
            )}
          </div>

          {/* 온도 */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ color: '#fb923c', fontSize: '10px', marginBottom: '5px' }}>🌡 Temperature Range (°C)</div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px' }}>Min</span>
              <input type="number" value={thresholds.tempMin}
                onChange={e => setThresholds(prev => ({ ...prev, tempMin: parseFloat(e.target.value) || 0 }))}
                style={{ width: '50px', background: '#0d1b2a', border: '1px solid #253347', borderRadius: '4px', color: '#e2e8f0', padding: '3px 4px', fontSize: '11px', textAlign: 'center' }} />
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px', textAlign: 'right' }}>Max</span>
              <input type="number" value={thresholds.tempMax}
                onChange={e => setThresholds(prev => ({ ...prev, tempMax: parseFloat(e.target.value) || 0 }))}
                style={{ width: '50px', background: '#0d1b2a', border: '1px solid #253347', borderRadius: '4px', color: '#e2e8f0', padding: '3px 4px', fontSize: '11px', textAlign: 'center' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px', fontSize: '9px', color: '#3a4a5a' }}>
              <span>현재: {sensor ? `${sensor.temperature}°C` : '--'}</span>
              <span>범위: {thresholds.tempMin}° ~ {thresholds.tempMax}°</span>
            </div>
          </div>

          {/* 습도 */}
          <div>
            <div style={{ color: accentBlue, fontSize: '10px', marginBottom: '5px' }}>💧 Humidity Range (%)</div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px' }}>Min</span>
              <input type="number" value={thresholds.humMin}
                onChange={e => setThresholds(prev => ({ ...prev, humMin: parseFloat(e.target.value) || 0 }))}
                style={{ width: '50px', background: '#0d1b2a', border: '1px solid #253347', borderRadius: '4px', color: '#e2e8f0', padding: '3px 4px', fontSize: '11px', textAlign: 'center' }} />
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px', textAlign: 'right' }}>Max</span>
              <input type="number" value={thresholds.humMax}
                onChange={e => setThresholds(prev => ({ ...prev, humMax: parseFloat(e.target.value) || 0 }))}
                style={{ width: '50px', background: '#0d1b2a', border: '1px solid #253347', borderRadius: '4px', color: '#e2e8f0', padding: '3px 4px', fontSize: '11px', textAlign: 'center' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px', fontSize: '9px', color: '#3a4a5a' }}>
              <span>현재: {sensor ? `${sensor.humidity}%` : '--'}</span>
              <span>범위: {thresholds.humMin}% ~ {thresholds.humMax}%</span>
            </div>
          </div>

          <button
            onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
            style={{ marginTop: '8px', width: '100%', background: '#162032', border: '1px solid #253347', borderRadius: '6px', color: '#8896a4', fontSize: '10px', padding: '5px', cursor: 'pointer' }}
          >
            Restore Defaults
          </button>
        </div>

        {/* 장비 규격 */}
        {(() => {
          const mc = MACHINE_CONFIGS[selectedMachineId];
          const maxReach = (mc.boomLen + mc.armLen + mc.bucketLen).toFixed(1);
          return (
            <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
              <div style={{ color: secColor, marginBottom: '6px' }}>Equipment Specs — {mc.label}</div>
              {[
                ['Class',       mc.subLabel],
                ['Weight',      mc.weight],
                ['Boom Length', `${mc.boomLen}m`],
                ['Arm Length',  `${mc.armLen}m`],
                ['Max Reach',   `${maxReach}m`],
                ['Bucket Cap',  `${mc.bucketCapacity} m³`],
                ['Dig Radius',  `${mc.digRadius}m`],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ color: secColor }}>{l}</span>
                  <span style={{ color: '#e2e8f0' }}>{v}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* 지형 정보 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '6px' }}>Terrain System</div>
          {[
            ['Grid',      `${GRID_COLS}×${GRID_ROWS} cells`],
            ['Resolution',`${CELL_M}m/cell`],
            ['Max Dig',   `${MAX_DIG}m`],
            ['Max Fill',  `${MAX_FILL}m`],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: '#e2e8f0' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>}

    {/* ── 모바일 컨트롤 대시보드 ── */}
    {isMobile && (
      <div style={{ padding: '4px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* 이상 감지 알림 */}
        {activeAlerts.map(alert => {
          const c = ALERT_COLORS[alert.level];
          return (
            <div key={alert.id} style={{ background: c.bg, border: `2px solid ${c.border}`, borderRadius: '10px', padding: '10px 14px', color: c.text, fontSize: '12px', fontWeight: 700, boxShadow: `0 0 12px ${c.glow}` }}>
              {alert.level === 'danger' ? '🚨' : '⚠️'} {alert.text}
            </div>
          );
        })}

        {/* 상태 헤더 */}
        <div style={{ background: '#111e2e', borderRadius: '12px', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #253347' }}>
          <div>
            <div style={{ color: '#8896a4', fontSize: '10px', marginBottom: '3px' }}>Operation Mode</div>
            <div style={{ color: '#f5a623', fontWeight: 700, fontSize: '18px' }}>● {state.operationMode}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#8896a4', fontSize: '10px', marginBottom: '3px' }}>Bucket Load</div>
            <div style={{ color: '#fb923c', fontFamily: 'monospace', fontSize: '14px', fontWeight: 700 }}>
              {soilDisplay.toFixed(2)} / {MACHINE_CONFIGS[selectedMachineId].bucketCapacity} m³
            </div>
            <div style={{ color: syncStatus === 'synced' ? '#4ade80' : syncStatus === 'error' ? '#f87171' : '#8896a4', fontSize: '10px', marginTop: '2px' }}>
              {syncStatus === 'synced' ? '✓ Synced' : syncStatus === 'syncing' ? '⟳ Syncing' : syncStatus === 'error' ? '✗ Error' : '○ Standby'}
            </div>
          </div>
        </div>
        <Canvas shadows camera={{ position: [22, 14, 28], fov: 52 }} style={{ background: '#1a2a3a', width: '100%', height: 'clamp(300px, 25vh, 500px)', borderRadius: '12px' }}>
          <Physics gravity={[0, -9.81, 0]} colliders={false}>
            <Sky sunPosition={[100, 40, 100]} turbidity={6} rayleigh={0.6} mieCoefficient={0.005} mieDirectionalG={0.8} />
            <ambientLight intensity={0.55} />
            <directionalLight
                position={[60, 70, 40]} intensity={1.3} castShadow
                shadow-mapSize-width={2048} shadow-mapSize-height={2048}
                shadow-camera-far={200} shadow-camera-left={-70}
                shadow-camera-right={70} shadow-camera-top={70} shadow-camera-bottom={-70}
            />
            <pointLight position={[-20, 8, -20]} intensity={0.25} color="#ff9944" />
            <pointLight position={[25, 6, 25]}   intensity={0.2}  color="#4488ff" />

            <TerrainRapierCollider heightMapRef={heightMapRef} version={terrainPhysicsVersion} />
            <ExcavatorCollider stateRef={stateRef} machine={MACHINE_CONFIGS[selectedMachineId]} />

            {/* 동적 지형 메시 */}
            <TerrainMesh heightMapRef={heightMapRef} dirtyRef={terrainDirtyRef} />
            <ConstructionOverlay />
            <ExcavatorModel
              state={state}
              soilInBucket={soilDisplay}
              machine={MACHINE_CONFIGS[selectedMachineId]}
              heightMapRef={heightMapRef}
              wobbleRef={wobbleRef}
            />
            {/* 흙 파티클 */}
            <SoilParticles particlesRef={particlesRef} />

            <OrbitControls enableDamping dampingFactor={0.06} minDistance={4} maxDistance={120} maxPolarAngle={Math.PI / 2 - 0.02} />
            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport labelColor="white" axisHeadScale={0.85} />
            </GizmoHelper>
          </Physics>
        </Canvas>
        {/* 작업 프리셋 */}
        {/* <div style={{ background: '#111e2e', borderRadius: '12px', padding: '14px', border: '1px solid #253347' }}>
          <div style={{ color: '#8896a4', fontSize: '11px', marginBottom: '10px', fontWeight: 600 }}>🎮 작업 프리셋</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {Object.entries(PRESETS).map(([name]) => {
              const active = state.operationMode === name;
              const icons = { IDLE: '⏸', DIG: '⛏', DUMP: '🪣', TRAVEL: '🚗' };
              return (
                <button key={name} onClick={() => applyPreset(name)} style={{ background: active ? '#1e3a5f' : '#162032', border: `2px solid ${active ? '#60a5fa' : '#253347'}`, borderRadius: '10px', color: active ? '#60a5fa' : '#8896a4', padding: '12px 8px', fontSize: '13px', cursor: 'pointer', fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: 'all 0.15s' }}>
                  <span style={{ fontSize: '22px' }}>{icons[name]}</span>
                  {PRESET_LABELS[name]}
                </button>
              );
            })}
          </div>
        </div> */}

        {/* 관절 슬라이더 */}
        <div style={{ background: '#111e2e', borderRadius: '12px', padding: '14px', border: '1px solid #253347' }}>
          <div style={{ color: '#8896a4', fontSize: '11px', marginBottom: '12px', fontWeight: 600 }}>🦾 Joint Detail Control</div>
          {[
            { label: 'Boom',          key: 'boomAngle',    ...JOINT_LIMITS.boomAngle,   color: '#60a5fa' },
            { label: 'Arm',           key: 'armAngle',     ...JOINT_LIMITS.armAngle,    color: '#34d399' },
            { label: 'Bucket',        key: 'bucketAngle',  ...JOINT_LIMITS.bucketAngle, color: '#fb923c' },
            { label: 'Swing',         key: 'swingAngle',   min: -180, max: 180,          color: '#a78bfa' },
            { label: 'Body Rotation', key: 'bodyRotation', min: -180, max: 180,          color: '#94a3b8' },
          ].map(({ label, key, min, max, color }) => (
            <div key={key} style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ color: '#8896a4', fontSize: '12px' }}>{label}</span>
                <span style={{ color, fontFamily: 'monospace', fontWeight: 700, fontSize: '13px' }}>{Math.round(state[key])}°</span>
              </div>
              <input type="range" min={min} max={max} step={0.5} value={state[key]}
                onChange={e => setJoint(key, parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: color, cursor: 'pointer', height: '6px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#3a4a5a', fontSize: '10px', marginTop: '2px' }}>
                <span>{min}°</span><span>{max}°</span>
              </div>
            </div>
          ))}
        </div>

        {/* 버킷 게이지 + 키네마틱스 */}
        <div style={{ background: '#111e2e', borderRadius: '12px', padding: '14px', border: '1px solid #253347' }}>
          <div style={{ color: '#8896a4', fontSize: '11px', marginBottom: '8px', fontWeight: 600 }}>🪣 Bucket Load Status</div>
          <div style={{ background: '#1e2e3e', borderRadius: '6px', height: '12px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{ width: `${(soilDisplay / MACHINE_CONFIGS[selectedMachineId].bucketCapacity) * 100}%`, height: '100%', background: soilDisplay > MACHINE_CONFIGS[selectedMachineId].bucketCapacity * 0.8 ? '#f87171' : soilDisplay > MACHINE_CONFIGS[selectedMachineId].bucketCapacity * 0.4 ? '#fb923c' : '#6b4416', transition: 'width 0.1s', borderRadius: '6px' }} />
          </div>
          {kinematics && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', fontSize: '11px' }}>
              {[['Horizontal Reach', `${kinematics.reach}m`, '#34d399'], ['Dig Depth', `${kinematics.depth}m`, '#fb923c'], ['Terrain Height', `${kinematics.terrainH}m`, '#94a3b8']].map(([l, v, c]) => (
                <div key={l} style={{ background: '#162032', borderRadius: '6px', padding: '6px', textAlign: 'center' }}>
                  <div style={{ color: '#4a5a6a', marginBottom: '2px', fontSize: '9px' }}>{l}</div>
                  <div style={{ color: c, fontFamily: 'monospace', fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 위치 + IoT 센서 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ background: '#111e2e', borderRadius: '12px', padding: '12px', border: '1px solid #253347', fontSize: '11px' }}>
            <div style={{ color: '#8896a4', marginBottom: '6px', fontWeight: 600 }}>📍 Position (m)</div>
            {[['X', state.positionX], ['Y', state.positionY], ['Z', state.positionZ]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ color: '#8896a4' }}>{l}</span>
                <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{Number(v).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ background: '#111e2e', borderRadius: '12px', padding: '12px', border: '1px solid #253347', fontSize: '11px' }}>
            <div style={{ color: '#8896a4', marginBottom: '6px', fontWeight: 600 }}>🌡 IoT Sensor</div>
            {[
              ['Temperature', sensor ? `${sensor.temperature}°C` : '--', sensor && (sensor.temperature > thresholds.tempMax || sensor.temperature < thresholds.tempMin) ? '#f87171' : '#4ade80'],
              ['Humidity',    sensor ? `${sensor.humidity}%` : '--',     sensor && (sensor.humidity > thresholds.humMax    || sensor.humidity < thresholds.humMin)    ? '#f87171' : '#4ade80'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#8896a4' }}>{l}</span>
                <span style={{ color: sensor ? c : '#3a4a5a', fontFamily: 'monospace', fontWeight: 700 }}>{v}</span>
              </div>
            ))}
            <div style={{ fontSize: '9px', color: sensorWs === 'connected' ? '#4ade80' : '#8896a4', marginTop: '4px' }}>
              {sensorWs === 'connected' ? '● Connected' : sensorWs === 'connecting' ? '○ Connecting' : '○ Standby'}
            </div>
          </div>
        </div>

        {/* 장비 선택 */}
        <div style={{ background: '#111e2e', borderRadius: '12px', padding: '14px', border: '1px solid #253347' }}>
          <div style={{ color: '#8896a4', fontSize: '11px', marginBottom: '10px', fontWeight: 600 }}>⚙ Equipment Select</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.values(MACHINE_CONFIGS).map(mc => {
              const active = selectedMachineId === mc.id;
              return (
                <button key={mc.id} onClick={() => handleMachineChange(mc.id)} style={{ background: active ? '#0f2a18' : '#162032', border: `1px solid ${active ? '#22c55e' : '#253347'}`, borderRadius: '10px', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', width: '100%' }}>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: active ? '#4ade80' : '#e2e8f0', fontWeight: 700, fontSize: '13px' }}>{mc.label}</div>
                    <div style={{ color: active ? '#86efac' : '#8896a4', fontSize: '11px' }}>{mc.subLabel} — {mc.weight}</div>
                  </div>
                  <div style={{ color: active ? '#4ade80' : '#3a4a5a', fontSize: '12px', fontFamily: 'monospace', fontWeight: 700 }}>
                    {mc.bucketCapacity} m³
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={handleSave} style={{ background: '#0d2420', border: '1px solid #1a5040', borderRadius: '10px', color: '#4ade80', padding: '14px', fontSize: '14px', cursor: 'pointer', fontWeight: 600 }}>
            💾 Save State (C# Server)
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button onClick={handleClearTerrain} style={{ background: '#1a1200', border: '1px solid #4a3000', borderRadius: '10px', color: '#fbbf24', padding: '12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>🗑 Clear Terrain</button>
            <button onClick={handleReset} style={{ background: '#2d1010', border: '1px solid #5a2020', borderRadius: '10px', color: '#f87171', padding: '12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>↺ Full Reset</button>
          </div>
        </div>

        {/* 안내 */}
        <div style={{ background: '#0a1520', border: '1px solid #1a3040', borderRadius: '10px', padding: '12px 14px', fontSize: '11px', color: '#4a6a5a', lineHeight: 1.6 }}>
          💡 <strong style={{ color: '#6a9a7a' }}>3D Excavation Simulation</strong> is controlled via keyboard on PC.<br/>
          On mobile, use sliders and presets to control posture and save to server.
        </div>
      </div>
    )}
    </div>
  );
}

// ── 버튼 스타일 ────────────────────────────────────────────────────────────────
function dirBtnStyle(key, keysDisplay) {
  const active = keysDisplay.has(key);
  return {
    gridColumn: key === 'w' ? 2 : undefined,
    background: active ? '#1e3a5f' : '#162032',
    border: `1px solid ${active ? '#60a5fa' : '#253347'}`,
    borderRadius: '6px', color: active ? '#60a5fa' : '#e2e8f0',
    cursor: 'pointer', padding: '8px', fontSize: '15px', lineHeight: 1,
    transition: 'all 0.1s', userSelect: 'none',
  };
}

function jointBtnStyle(key, keysDisplay, color) {
  const active = keysDisplay.has(key);
  return {
    flex: 1,
    background: active ? '#221840' : '#162032',
    border: `1px solid ${active ? color : '#253347'}`,
    borderRadius: '6px', color: active ? color : '#8896a4',
    cursor: 'pointer', padding: '5px 4px', fontSize: '10px', fontWeight: 600,
    transition: 'all 0.1s', userSelect: 'none',
  };
}
