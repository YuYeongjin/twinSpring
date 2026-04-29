import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import AxiosCustom, { WS_BASE } from '../../axios/AxiosCustom';

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

const PRESET_LABELS = { IDLE: '대기', DIG: '굴착', DUMP: '덤핑', TRAVEL: '이동' };

// ── 장비 사양 정의 ─────────────────────────────────────────────────────────────
// bodyScale: 차체 시각 스케일 (1.0 = 1W 기준)
// boomLen/armLen/bucketLen: 월드 공간 실제 길이(m)
// 붐 피벗은 항상 [0, 1.4, 1.9] × bodyScale
const MACHINE_CONFIGS = {
  '0.3W': {
    id: '0.3W', label: '0.3W 소형', subLabel: '소형 굴착기 (미니)', weight: '3~6톤급',
    bodyScale: 0.55,
    boomLen: 2.8,  armLen: 1.4,  bucketLen: 0.48,  bucketCapacity: 0.3,
    digRate: 0.038, digRadius: 1.7,
    fillRate: 0.08, fillRadius: 1.4,
  },
  '0.6W': {
    id: '0.6W', label: '0.6W 중형', subLabel: '중형 굴착기', weight: '12~20톤급',
    bodyScale: 0.78,
    boomLen: 4.8,  armLen: 2.8,  bucketLen: 0.68,  bucketCapacity: 0.6,
    digRate: 0.065, digRadius: 2.8,
    fillRate: 0.14, fillRadius: 2.2,
  },
  '1W': {
    id: '1W', label: '1W 대형', subLabel: '대형 굴착기', weight: '20~35톤급',
    bodyScale: 1.0,
    boomLen: 6.0,  armLen: 3.8,  bucketLen: 0.85,  bucketCapacity: 1.0,
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

// 높이값 → 버텍스 색상 (굴착 = 짙은 적갈색 점토, 성토 = 진한 황토)
function hToRGB(h) {
  if (h < 0) {
    const t = Math.min(1, -h / MAX_DIG);
    // 표면 황토 → 깊은 적갈색 생토 (굴착 깊을수록 진해짐)
    return [0.46 - t * 0.22, 0.34 - t * 0.22, 0.20 - t * 0.14];
  }
  const t = Math.min(1, h / MAX_FILL);
  // 황토 → 짙은 갈색 (성토 = 압축 안된 흙)
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

// ── 굴착기 3D 모델 (장비 사양 기반 스케일링) ────────────────────────────────────
// 차체 전체를 bodyScale로 균일 확대/축소.
// 붐/암은 scaled space 내에서 실제 길이/s 로 표현 → 월드 공간에서 실제 길이.
function ExcavatorModel({ state, soilInBucket, machine }) {
  const s   = machine.bodyScale;
  const BL  = machine.boomLen  / s;   // 스케일 공간의 붐 길이
  const AL  = machine.armLen   / s;   // 스케일 공간의 암 길이
  const buL = machine.bucketLen / s;  // 스케일 공간의 버킷 티스 도달
  const soilFill = Math.min(1, soilInBucket / machine.bucketCapacity);

  return (
    <group
      position={[state.positionX, 0, state.positionZ]}
      rotation={[0, state.bodyRotation * D2R, 0]}
    >
      {/* 전체 차체를 bodyScale로 스케일 */}
      <group scale={[s, s, s]}>

        {/* 하부 차체 */}
        <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.9, 0.72, 5.4]} />
          <meshStandardMaterial color="#3b4228" roughness={0.85} metalness={0.1} />
        </mesh>
        <mesh position={[-2.1, 0.37, 0]} castShadow>
          <boxGeometry args={[0.62, 0.60, 5.85]} />
          <meshStandardMaterial color="#191919" roughness={0.95} />
        </mesh>
        <mesh position={[2.1, 0.37, 0]} castShadow>
          <boxGeometry args={[0.62, 0.60, 5.85]} />
          <meshStandardMaterial color="#191919" roughness={0.95} />
        </mesh>
        <TrackRollers side="left" />
        <TrackRollers side="right" />
        {[-1, 1].map((sx, i) => (
          <mesh key={`idler${i}`} position={[sx * 2.1, 0.37, 2.75]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.55, 12]} />
            <meshStandardMaterial color="#2a2a2a" metalness={0.6} />
          </mesh>
        ))}
        {[-1, 1].map((sx, i) => (
          <mesh key={`sprocket${i}`} position={[sx * 2.1, 0.37, -2.75]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.34, 0.34, 0.55, 12]} />
            <meshStandardMaterial color="#333" metalness={0.7} />
          </mesh>
        ))}

        {/* 상부 선회체 */}
        <group position={[0, 0.72, 0]} rotation={[0, state.swingAngle * D2R, 0]}>
          <mesh position={[0, 0.72, 0.1]} castShadow receiveShadow>
            <boxGeometry args={[3.3, 1.44, 4.0]} />
            <meshStandardMaterial color="#f5a623" roughness={0.52} metalness={0.22} />
          </mesh>
          <mesh position={[-0.65, 1.92, -0.6]} castShadow>
            <boxGeometry args={[1.95, 1.85, 2.1]} />
            <meshStandardMaterial color="#f5a623" roughness={0.48} metalness={0.2} />
          </mesh>
          <mesh position={[-0.65, 2.05, 0.45]}>
            <boxGeometry args={[1.75, 0.85, 0.06]} />
            <meshStandardMaterial color="#88ccff" transparent opacity={0.42} />
          </mesh>
          <mesh position={[0.31, 2.05, -0.6]}>
            <boxGeometry args={[0.06, 0.7, 1.6]} />
            <meshStandardMaterial color="#88ccff" transparent opacity={0.38} />
          </mesh>
          <mesh position={[0.2, 0.7, -2.45]} castShadow>
            <boxGeometry args={[3.1, 0.95, 1.25]} />
            <meshStandardMaterial color="#282828" metalness={0.55} roughness={0.6} />
          </mesh>
          <mesh position={[0.5, 1.35, -1.2]} castShadow>
            <boxGeometry args={[2.2, 0.8, 1.6]} />
            <meshStandardMaterial color="#e09010" roughness={0.55} />
          </mesh>
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.4, 0.15, 8, 24]} />
            <meshStandardMaterial color="#444" metalness={0.8} />
          </mesh>

          {/* 붐 피벗 (스케일 공간 고정 좌표 [0,1.4,1.9]) */}
          <group position={[0, 1.4, 1.9]}>
            <group rotation={[-state.boomAngle * D2R, 0, 0]}>
              {/* 붐 — 길이를 BL(= boomLen/s)로 → 월드 공간에서 boomLen */}
              <mesh position={[0, 0, BL / 2]} castShadow>
                <boxGeometry args={[0.58, 0.58, BL]} />
                <meshStandardMaterial color="#d48810" roughness={0.48} metalness={0.38} />
              </mesh>
              <mesh position={[-0.35, -0.32, BL * 0.38]} rotation={[0.32, 0, 0]} castShadow>
                <cylinderGeometry args={[0.11, 0.11, BL * 0.72, 8]} />
                <meshStandardMaterial color="#888" metalness={0.85} roughness={0.2} />
              </mesh>

              {/* 암 피벗 */}
              <group position={[0, 0, BL]}>
                <group rotation={[state.armAngle * D2R, 0, 0]}>
                  <mesh position={[0, 0, AL / 2]} castShadow>
                    <boxGeometry args={[0.44, 0.44, AL]} />
                    <meshStandardMaterial color="#c07a0a" roughness={0.5} metalness={0.35} />
                  </mesh>
                  <mesh position={[-0.28, -0.3, AL * 0.35]} rotation={[0.18, 0, 0]} castShadow>
                    <cylinderGeometry args={[0.09, 0.09, AL * 0.75, 8]} />
                    <meshStandardMaterial color="#777" metalness={0.85} roughness={0.2} />
                  </mesh>

                  {/* 버킷 피벗 */}
                  <group position={[0, 0, AL]}>
                    <group rotation={[state.bucketAngle * D2R, 0, 0]}>
                      <mesh position={[0, -0.2, buL * 0.45]} castShadow>
                        <boxGeometry args={[1.38, 0.78, buL * 1.05]} />
                        <meshStandardMaterial color="#6a6a6a" metalness={0.68} roughness={0.38} />
                      </mesh>
                      <mesh position={[0, -0.06, -0.06]} castShadow>
                        <boxGeometry args={[1.38, 0.58, 0.13]} />
                        <meshStandardMaterial color="#5a5a5a" metalness={0.72} />
                      </mesh>
                      {[-0.52, -0.18, 0.18, 0.52].map((x, i) => (
                        <mesh key={i} position={[x, -0.52, buL * 0.88]} castShadow>
                          <boxGeometry args={[0.1, 0.14, buL * 0.35]} />
                          <meshStandardMaterial color="#3a3a3a" metalness={0.88} />
                        </mesh>
                      ))}
                      {soilFill > 0.04 && (
                        <mesh position={[0, -0.54 + soilFill * 0.32, buL * 0.42]}>
                          <boxGeometry args={[1.18, soilFill * 0.58 + 0.06, buL * 0.88]} />
                          <meshStandardMaterial color="#6b4416" roughness={0.95} metalness={0} />
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
function ConstructionOverlay({ bimElements }) {
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
      {/* BIM 부재 */}
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
  const heightMapRef   = useRef(new Float32Array(GRID_COLS * GRID_ROWS).fill(0));
  const terrainDirtyRef = useRef(false);

  // 버킷 내 흙
  const soilInBucketRef = useRef(0);
  const [soilDisplay, setSoilDisplay] = useState(0);

  // 장비 선택
  const [selectedMachineId, setSelectedMachineId] = useState(DEFAULT_MACHINE.id);
  const machineRef = useRef(DEFAULT_MACHINE);

  // 덤핑 상태 중복 방지
  const dumpingRef = useRef(false);

  // 흙 파티클 풀
  const particlesRef = useRef([]);

  // 서버 동기화
  const [syncStatus, setSyncStatus] = useState('idle');
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

  // stateRef 항상 최신 유지
  useEffect(() => { stateRef.current = state; }, [state]);

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
              triggered.push({ id: 'TEMP_HIGH', level: 'danger',  text: `온도 상한 초과: ${d.temperature}°C (허용 최대 ${t.tempMax}°C)`, ts });
            if (d.temperature < t.tempMin)
              triggered.push({ id: 'TEMP_LOW',  level: 'danger',  text: `온도 하한 이탈: ${d.temperature}°C (허용 최저 ${t.tempMin}°C)`, ts });
            if (d.humidity > t.humMax)
              triggered.push({ id: 'HUM_HIGH',  level: 'warning', text: `습도 상한 초과: ${d.humidity}% (허용 최대 ${t.humMax}%)`, ts });
            if (d.humidity < t.humMin)
              triggered.push({ id: 'HUM_LOW',   level: 'warning', text: `습도 하한 이탈: ${d.humidity}% (허용 최저 ${t.humMin}%)`, ts });
            setActiveAlerts(triggered);
            if (triggered.length > 0)
              setAlertHistory(prev => [...triggered.map(a => ({ ...a, uid: `${a.id}_${Date.now()}` })), ...prev].slice(0, 20));
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

  // 서버에서 초기 상태 로드 (지형 데이터 포함)
  useEffect(() => {
    AxiosCustom.get('/api/simulation/excavator')
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
      })
      .catch(() => {});
  }, []);

  // ── 키보드 이벤트 ──
  useEffect(() => {
    const CONTROLLED = new Set([
      'w','a','s','d','q','e','r','f','t','g','y','h',
      'W','A','S','D','Q','E','R','F','T','G','Y','H',
      'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
    ]);
    const onDown = e => { if (CONTROLLED.has(e.key)) e.preventDefault(); keysRef.current.add(e.key); setKeysDisplay(new Set(keysRef.current)); };
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

  // ── 자동 서버 동기화 (2초, 지형 데이터 포함) ──
  useEffect(() => {
    const id = setInterval(() => {
      setSyncStatus('syncing');
      const payload = {
        ...stateRef.current,
        soilInBucket: soilInBucketRef.current,
        heightMapData: serializeTerrain(heightMapRef.current),
      };
      AxiosCustom.put('/api/simulation/excavator', payload)
        .then(() => setSyncStatus('synced'))
        .catch(() => setSyncStatus('error'));
    }, 2000);
    return () => clearInterval(id);
  }, []);

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

    setKinematics({ ...km, depth: digDepth.toFixed(2), terrainH: terrH.toFixed(2) });

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
    // 장비 전환 시 초기 자세로 리셋
    setState(prev => ({ ...prev, ...PRESETS.IDLE, operationMode: 'IDLE' }));
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
    heightMapRef.current.fill(0);
    terrainDirtyRef.current = true;
  };

  const handleClearTerrain = () => {
    heightMapRef.current.fill(0);
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
    terrainDirtyRef.current = true;
  };

  const handleReset = () => {
    setState({ ...DEFAULT_STATE });
    heightMapRef.current.fill(0);
    soilInBucketRef.current = 0;
    setSoilDisplay(0);
    terrainDirtyRef.current = true;
    AxiosCustom.post('/api/simulation/excavator/reset').catch(() => {});
  };

  const handleSave = () => {
    setSyncStatus('syncing');
    const payload = {
      ...state,
      soilInBucket: soilInBucketRef.current,
      heightMapData: serializeTerrain(heightMapRef.current),
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
            ← 목록
          </button>
        )}
        <span style={{ color: '#f5a623', fontSize: '15px', fontWeight: 700 }}>
          🚜 {selectedProject?.projectName ?? '시뮬레이션'}
        </span>
        <span style={{
          fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
          backgroundColor: '#1a2a0a', color: '#f5a623', border: '1px solid #f5a62340',
        }}>
          Excavator
        </span>
      </div>

    <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 175px)', gap: '10px' }}>

      {/* ── 왼쪽 상태 패널 ── */}
      <div style={{
        width: '210px', flexShrink: 0, background: panelBg, border: panelBorder,
        borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column',
        gap: '10px', overflowY: 'auto', fontSize: '12px',
      }}>
        <div style={{ color: accentBlue, fontSize: '13px', fontWeight: 700, borderBottom: '1px solid #1e3a5f', paddingBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          🚧 장비 상태
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
          <div style={{ color: secColor, marginBottom: '4px', fontSize: '10px' }}>작동 모드</div>
          <div style={{ color: '#f5a623', fontWeight: 700, fontSize: '13px' }}>● {state.operationMode}</div>
          {isDigging && (
            <div style={{ marginTop: '6px', background: '#3a1a00', borderRadius: '5px', padding: '4px 8px', fontSize: '11px', color: '#fbbf24', fontWeight: 700 }}>
              ⛏ 굴착 중 ({kinematics.depth}m)
            </div>
          )}
          {isDumping && (
            <div style={{ marginTop: '6px', background: '#0d3020', borderRadius: '5px', padding: '4px 8px', fontSize: '11px', color: '#34d399', fontWeight: 700 }}>
              🪣 덤핑 중
            </div>
          )}
        </div>

        {/* 버킷 흙 게이지 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
          <div style={{ color: secColor, marginBottom: '6px', fontSize: '10px', display: 'flex', justifyContent: 'space-between' }}>
            <span>버킷 적재량</span>
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
              <span style={{ color: c, fontFamily: 'monospace', fontWeight: 600 }}>{Math.round(v)}°</span>
            </div>
          ))}
        </div>

        {/* 버킷 끝 위치 */}
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
                <span style={{ color: secColor }}>지형 높이</span>
                <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{kinematics.terrainH}m</span>
              </div>
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
            {syncStatus === 'syncing' ? '동기화 중...' : syncStatus === 'synced' ? 'C# 서버 동기화됨' : syncStatus === 'error' ? '동기화 실패' : '대기 중'}
          </div>
        </div>

        {/* IoT 센서 모니터링 */}
        <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
          <div style={{ color: secColor, marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🌡 IoT 센서</span>
            <span style={{ color: sensorWs === 'connected' ? '#4ade80' : sensorWs === 'error' ? '#f87171' : '#facc15', fontSize: '9px' }}>
              {sensorWs === 'connected' ? '● 연결' : sensorWs === 'connecting' ? '○ 연결 중' : sensorWs === 'error' ? '✗ 오류' : '○ 대기'}
            </span>
          </div>
          {sensor ? (
            <>
              {[
                ['온도', `${sensor.temperature}°C`, sensor.temperature > thresholds.tempMax || sensor.temperature < thresholds.tempMin ? '#f87171' : '#4ade80'],
                ['습도', `${sensor.humidity}%`,     sensor.humidity > thresholds.humMax || sensor.humidity < thresholds.humMin ? '#f87171' : '#4ade80'],
                ['위치', sensor.location,            '#e2e8f0'],
              ].map(([label, value, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ color: secColor }}>{label}</span>
                  <span style={{ color, fontFamily: 'monospace', fontWeight: 700 }}>{value}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: '#3a4a5a', textAlign: 'center', padding: '4px 0' }}>데이터 대기 중...</div>
          )}
        </div>

        {/* 알림 기록 */}
        {alertHistory.length > 0 && (
          <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
            <div style={{ color: secColor, marginBottom: '6px' }}>📋 알림 기록</div>
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
      <div style={{ flex: 1, borderRadius: '12px', overflow: 'hidden', border: panelBorder, position: 'relative' }}>
        {/* 키보드 가이드 */}
        <div style={{
          position: 'absolute', top: '12px', left: '12px', zIndex: 10,
          background: 'rgba(13,27,42,0.88)', border: '1px solid #253347',
          borderRadius: '10px', padding: '10px 14px', fontSize: '11px',
          color: secColor, lineHeight: 1.7, pointerEvents: 'none',
        }}>
          <div style={{ color: accentBlue, fontWeight: 700, marginBottom: '4px', fontSize: '12px' }}>⌨ 키보드 조작</div>
          {[['W / S','전진 / 후진'],['A / D','차체 회전'],['Q / E','선회 ±'],['R / F','붐 상/하'],['T / G','암 굴절'],['Y / H','버킷 회전']].map(([k,v]) => (
            <div key={k} style={{ display: 'flex', gap: '6px' }}>
              <span style={{ color: '#e2e8f0', minWidth: '60px', fontFamily: 'monospace' }}>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div style={{ marginTop: '6px', borderTop: '1px solid #253347', paddingTop: '6px', fontSize: '10px', color: '#fbbf24' }}>
            버킷을 지면에 대고 T/G로 암 조작 → 굴착<br/>
            Q/E로 선회 후 버킷 H로 열면 → 덤핑
          </div>
        </div>

        {/* 장비 배지 */}
        <div style={{
          position: 'absolute', top: '12px', right: '12px', zIndex: 10,
          background: 'rgba(13,27,42,0.88)', border: '1px solid #253347',
          borderRadius: '8px', padding: '6px 12px', fontSize: '12px',
          color: '#f5a623', fontWeight: 700, pointerEvents: 'none',
        }}>
          🚜 {MACHINE_CONFIGS[selectedMachineId].label} 굴착기
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
              ? `⛏ 굴착 중 — 깊이 ${kinematics.depth}m | 적재 ${soilDisplay.toFixed(1)} m³`
              : `🪣 덤핑 — (${kinematics?.tipX ?? 0}, ${kinematics?.tipZ ?? 0}) | 잔여 ${soilDisplay.toFixed(1)} m³`}
          </div>
        )}

        <Canvas shadows camera={{ position: [22, 14, 28], fov: 52 }} style={{ background: '#1a2a3a' }}>
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

          {/* 동적 지형 메시 */}
          <TerrainMesh heightMapRef={heightMapRef} dirtyRef={terrainDirtyRef} />
          <ConstructionOverlay bimElements={modelData} />
          <ExcavatorModel state={state} soilInBucket={soilDisplay} machine={MACHINE_CONFIGS[selectedMachineId]} />
          {/* 흙 파티클 */}
          <SoilParticles particlesRef={particlesRef} />

          <OrbitControls enableDamping dampingFactor={0.06} minDistance={4} maxDistance={120} maxPolarAngle={Math.PI / 2 - 0.02} />
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport labelColor="white" axisHeadScale={0.85} />
          </GizmoHelper>
        </Canvas>
      </div>

      {/* ── 오른쪽 조작 패널 ── */}
      <div style={{
        width: '250px', flexShrink: 0, background: panelBg, border: panelBorder,
        borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column',
        gap: '14px', overflowY: 'auto', fontSize: '12px',
      }}>
        <div style={{ color: accentBlue, fontSize: '13px', fontWeight: 700, borderBottom: '1px solid #1e3a5f', paddingBottom: '8px' }}>
          🎮 장비 조작
        </div>

        {/* 장비 선택 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px', letterSpacing: '0.04em' }}>⚙ 장비 선택</div>
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
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>이동 / 회전</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', width: '130px', margin: '0 auto' }}>
            <button style={dirBtnStyle('w', keysDisplay)} onMouseDown={() => pressKey('w')} onMouseUp={() => releaseKey('w')} onMouseLeave={() => releaseKey('w')} onTouchStart={() => pressKey('w')} onTouchEnd={() => releaseKey('w')}>↑</button>
            <button style={{ ...dirBtnStyle('a', keysDisplay), gridColumn: 1, gridRow: 2 }} onMouseDown={() => pressKey('a')} onMouseUp={() => releaseKey('a')} onMouseLeave={() => releaseKey('a')} onTouchStart={() => pressKey('a')} onTouchEnd={() => releaseKey('a')}>↶</button>
            <button style={{ ...dirBtnStyle('s', keysDisplay), gridColumn: 2, gridRow: 2 }} onMouseDown={() => pressKey('s')} onMouseUp={() => releaseKey('s')} onMouseLeave={() => releaseKey('s')} onTouchStart={() => pressKey('s')} onTouchEnd={() => releaseKey('s')}>↓</button>
            <button style={{ ...dirBtnStyle('d', keysDisplay), gridColumn: 3, gridRow: 2 }} onMouseDown={() => pressKey('d')} onMouseUp={() => releaseKey('d')} onMouseLeave={() => releaseKey('d')} onTouchStart={() => pressKey('d')} onTouchEnd={() => releaseKey('d')}>↷</button>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'center' }}>
            {[['q','↺ 선회←'],['e','선회→ ↻']].map(([k, label]) => (
              <button key={k} style={jointBtnStyle(k, keysDisplay, '#a78bfa')}
                onMouseDown={() => pressKey(k)} onMouseUp={() => releaseKey(k)} onMouseLeave={() => releaseKey(k)}
                onTouchStart={() => pressKey(k)} onTouchEnd={() => releaseKey(k)}>{label}</button>
            ))}
          </div>
        </div>

        {/* 관절 슬라이더 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>관절 세부 제어</div>
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
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px' }}>작업 프리셋</div>
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

        {/* 버튼 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button onClick={handleSave} style={{ background: '#0d2420', border: '1px solid #1a5040', borderRadius: '8px', color: '#4ade80', padding: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            💾 상태 저장 (C# 서버)
          </button>
          <button onClick={handleClearTerrain} style={{ background: '#1a1200', border: '1px solid #4a3000', borderRadius: '8px', color: '#fbbf24', padding: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            🗑 지형 초기화
          </button>
          <button onClick={handleReset} style={{ background: '#2d1010', border: '1px solid #5a2020', borderRadius: '8px', color: '#f87171', padding: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            ↺ 전체 초기화
          </button>
        </div>

        {/* 이상 감지 임계값 설정 */}
        <div>
          <div style={{ color: secColor, fontSize: '10px', marginBottom: '8px', letterSpacing: '0.04em' }}>
            🚨 이상 감지 임계값
            {activeAlerts.length > 0 && (
              <span style={{ marginLeft: '6px', color: activeAlerts.some(a => a.level === 'danger') ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
                ({activeAlerts.length}건 초과)
              </span>
            )}
          </div>

          {/* 온도 */}
          <div style={{ marginBottom: '10px' }}>
            <div style={{ color: '#fb923c', fontSize: '10px', marginBottom: '5px' }}>🌡 온도 허용 범위 (°C)</div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px' }}>최저</span>
              <input type="number" value={thresholds.tempMin}
                onChange={e => setThresholds(prev => ({ ...prev, tempMin: parseFloat(e.target.value) || 0 }))}
                style={{ width: '50px', background: '#0d1b2a', border: '1px solid #253347', borderRadius: '4px', color: '#e2e8f0', padding: '3px 4px', fontSize: '11px', textAlign: 'center' }} />
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px', textAlign: 'right' }}>최고</span>
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
            <div style={{ color: accentBlue, fontSize: '10px', marginBottom: '5px' }}>💧 습도 허용 범위 (%)</div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px' }}>최저</span>
              <input type="number" value={thresholds.humMin}
                onChange={e => setThresholds(prev => ({ ...prev, humMin: parseFloat(e.target.value) || 0 }))}
                style={{ width: '50px', background: '#0d1b2a', border: '1px solid #253347', borderRadius: '4px', color: '#e2e8f0', padding: '3px 4px', fontSize: '11px', textAlign: 'center' }} />
              <span style={{ color: secColor, fontSize: '10px', minWidth: '22px', textAlign: 'right' }}>최고</span>
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
            기본값 복원
          </button>
        </div>

        {/* 장비 규격 */}
        {(() => {
          const mc = MACHINE_CONFIGS[selectedMachineId];
          const maxReach = (mc.boomLen + mc.armLen + mc.bucketLen).toFixed(1);
          return (
            <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
              <div style={{ color: secColor, marginBottom: '6px' }}>장비 규격 — {mc.label}</div>
              {[
                ['분류',     mc.subLabel],
                ['무게급',   mc.weight],
                ['붐 길이',  `${mc.boomLen}m`],
                ['암 길이',  `${mc.armLen}m`],
                ['최대 도달', `${maxReach}m`],
                ['버킷 용량', `${mc.bucketCapacity} m³`],
                ['굴착 반경', `${mc.digRadius}m`],
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
          <div style={{ color: secColor, marginBottom: '6px' }}>지형 시스템</div>
          {[
            ['그리드', `${GRID_COLS}×${GRID_ROWS}셀`],
            ['해상도', `${CELL_M}m/셀`],
            ['최대 굴착', `${MAX_DIG}m`],
            ['최대 성토', `${MAX_FILL}m`],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ color: secColor }}>{l}</span>
              <span style={{ color: '#e2e8f0' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
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
