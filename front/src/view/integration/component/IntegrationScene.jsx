import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useIntegration, useIntegrationDispatch, computeStructureBounds } from '../IntegrationStore';
import { BimElement, getBaseColor } from '../../bim/element/BimElement';
import { useT } from '../../../i18n/LanguageContext';
import { TASK_RULES, calcProgressRate, RECALC_INTERVAL_MS } from '../progressEngine';
import {
  detectFloors, getFloorLabel, getElementFloorIndex, getFloorProgress,
  getFloorStatus, getFloorStatusColor,
} from '../floorUtils';

// ── 선택된 엔티티의 실시간 좌표 툴팁 ──────────────────────────
// groupRef: Three.js Group ref (position이 매 프레임 업데이트됨)
// surveyOriginRef: surveyOrigin의 ref (stale-closure 방지)
// labelY: Html position Y
function LiveCoordLabel({ groupRef, surveyOriginRef, labelY }) {
  const t = useT('integrationProject');
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const divRef = useRef(null);

  useFrame(() => {
    if (!groupRef.current || !divRef.current) return;
    const p = groupRef.current.position;
    const o = surveyOriginRef.current;
    const x = o ? p.x + o.x : p.x;
    const y = o ? p.y + o.y : p.y;
    const z = o ? p.z + o.z : p.z;
    const badge = o ? tRef.current('surveyCoordBadge') : tRef.current('currentPosLabel');
    divRef.current.textContent = `📍 ${badge}  X:${x.toFixed(1)}  Y:${y.toFixed(1)}  Z:${z.toFixed(1)}`;
  });

  return (
    <Html center distanceFactor={30} position={[0, 0, labelY]}>
      <div ref={divRef} style={{
        background: '#12100add',
        color: '#facc15',
        padding: '2px 8px',
        borderRadius: 3,
        fontSize: 8,
        fontWeight: 700,
        border: '1px solid #facc1540',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        letterSpacing: '0.03em',
      }} />
    </Html>
  );
}

// ── 상수 ────────────────────────────────────────────────────────
const STATUS_COLOR = {
  normal:         '#22c55e',
  danger_zone:    '#f59e0b',
  collision_risk: '#ef4444',
  no_gear:        '#a855f7',
};
const EQUIP_COLOR = { excavator: '#f97316', dump: '#3b82f6', crane: '#eab308', vehicle: '#22c55e', other: '#a855f7' };
const EQUIP_ICON  = { excavator: '🚜',      dump: '🚛',       crane: '🏗',     vehicle: '🚗',      other: '🔧'  };
const ZONE_COLOR  = { excavation: '#ef4444', restricted: '#f97316', dump_site: '#22d3ee' };

// ── 헬퍼 ─────────────────────────────────────────────────────────
function inZone(pos, zone) {
  if (!zone.active) return false;
  const [cx, cy] = zone.center;    // Z-up: cx=east, cy=north
  const [hx, hy] = zone.halfSize;  // Z-up: hx=east half, hy=north half
  // pos는 Y-up 포맷 [east, 0, north] — pos[0]=east, pos[2]=north
  return Math.abs(pos[0] - cx) < hx && Math.abs(pos[2] - cy) < hy;
}

function throttledCall(map, key, ms, fn) {
  const now = Date.now();
  if (!map[key] || now - map[key] > ms) { map[key] = now; fn(); }
}

// ── 드론 지형 레이어 (z-up: PlaneGeometry = XY 평면 = 지면) ────────
function TerrainLayer() {
  const { terrain } = useIntegration();
  const [texture, setTexture] = useState(null);
  const prevUrl = useRef(null);

  useEffect(() => {
    if (!terrain?.imageDataUrl) {
      setTexture(prev => { prev?.dispose(); return null; });
      return;
    }
    if (terrain.imageDataUrl === prevUrl.current) return;
    prevUrl.current = terrain.imageDataUrl;

    // TextureLoader 대신 Image → THREE.Texture 직접 생성 (DataURL 신뢰성 향상)
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setTexture(prev => { prev?.dispose(); return tex; });
    };
    img.onerror = () => console.error('[Terrain] 텍스처 이미지 로드 실패');
    img.src = terrain.imageDataUrl;
  }, [terrain?.imageDataUrl]);

  if (!terrain || !texture) return null;

  const w = terrain.width  || 80;
  const h = terrain.height || 80;

  // z-up 씬: PlaneGeometry 기본 XY 평면 → 지면과 일치, 별도 회전 불필요
  // position Z=-0.015: 그리드(Z=0)와 z-fighting 방지
  return (
    <mesh position={[0, 0, -0.015]} receiveShadow>
      <planeGeometry args={[w, h, 1, 1]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} side={2} />
    </mesh>
  );
}

// Z-up 직접 매핑: posX→X, posY→Y, posZ→Z(높이) — 변환 없음
function toIntegrationCoords(el) {
  return el;
}

// ── CPM 공종 → 건설 phase 매핑 ───────────────────────────────────
// IfcSlab = 기초공사(FOUND) 완료 기준
// IfcColumn/Beam/Pier = 지하구조(UNDER) 완료 기준
// IfcWall/Member = 지상구조(ABOVE) 완료 기준
// TEMP/EARTH 는 BIM 부재 미매핑 → 자동 100% 처리
const ELEM_TYPE_TO_SIM_PHASE = {
  IfcSlab:   'FOUND',
  IfcPier:   'UNDER',
  IfcColumn: 'UNDER',
  IfcBeam:   'UNDER',
  IfcWall:   'ABOVE',
  IfcMember: 'ABOVE',
};
const SIM_PHASE_ORDER = ['TEMP', 'EARTH', 'FOUND', 'UNDER', 'ABOVE'];

/**
 * wbsTasks (General WBS 시뮬)에서 특정 BIM 프로젝트의 phase 진도를 계산.
 * ELEM_TYPE_TO_SIM_PHASE 매핑으로 공종 진도를 phase 진도로 변환하고
 * 활성 phase 인덱스(activePhaseIdx)를 반환 — cascade 적용에 사용.
 */
function computeSimPhaseProgress(wbsTasks, bimProjectId) {
  // ── IfcType 태스크 기반 (BIM:<id>:IfcSlab 등) ──────────────────
  const typeProgress = {};
  wbsTasks.forEach(t => {
    const m = (t.notes || '').match(/^BIM:([^:]+):([^:]+)$/);
    if (m && m[1] === bimProjectId && m[2] !== 'ROOT')
      typeProgress[m[2]] = Math.min(100, Math.max(0, t.progress || 0));
  });

  const hasElemTasks = Object.keys(typeProgress).length > 0;

  // ── PLAN 태스크 기반 (BIM:<id>:PLAN:<i>, generateBimWbsTasks 구조) ──
  if (!hasElemTasks) {
    const planTasks = wbsTasks
      .filter(t => /^BIM:[^:]+:PLAN:\d+/.test(t.notes || '') && (t.notes || '').split(':')[1] === bimProjectId)
      .sort((a, b) => parseInt((a.notes || '').split(':')[3] || '0') - parseInt((b.notes || '').split(':')[3] || '0'));

    if (planTasks.length > 0) {
      const n = planTasks.length;
      const avg = (arr) => arr.length ? arr.reduce((s, t) => s + (t.progress || 0), 0) / arr.length : 0;

      // PLAN:0 → EARTH, PLAN:1 → FOUND, PLAN:2..n-3 → UNDER, PLAN:n-2..n-1 → ABOVE
      const p0 = avg(planTasks.slice(0, 1));
      const p1 = avg(planTasks.slice(1, 2));
      const pUnder = avg(planTasks.slice(2, Math.max(2, n - 2)));
      const pAbove = avg(planTasks.slice(Math.max(2, n - 2)));

      const phaseProgress = {
        TEMP:  100,
        EARTH: p0,
        FOUND: p0 >= 100 ? p1    : 0,
        UNDER: p1 >= 100 ? pUnder : 0,
        ABOVE: (pUnder >= 100 || n <= 4) ? pAbove : 0,
      };

      let activePhaseIdx = SIM_PHASE_ORDER.length;
      for (let i = 0; i < SIM_PHASE_ORDER.length; i++) {
        if (phaseProgress[SIM_PHASE_ORDER[i]] < 100) { activePhaseIdx = i; break; }
      }
      return { phaseProgress, activePhaseIdx };
    }
  }

  // ── IfcType 기반 기존 로직 ──────────────────────────────────────
  const accum = {}, counts = {};
  Object.entries(ELEM_TYPE_TO_SIM_PHASE).forEach(([type, phase]) => {
    if (type in typeProgress) {
      accum[phase]  = (accum[phase]  || 0) + typeProgress[type];
      counts[phase] = (counts[phase] || 0) + 1;
    }
  });

  const phaseProgress = {};
  SIM_PHASE_ORDER.forEach(ph => {
    phaseProgress[ph] = counts[ph]
      ? accum[ph] / counts[ph]
      : (ph === 'TEMP' || ph === 'EARTH') ? 100 : 0;
  });

  let activePhaseIdx = SIM_PHASE_ORDER.length;
  for (let i = 0; i < SIM_PHASE_ORDER.length; i++) {
    if (phaseProgress[SIM_PHASE_ORDER[i]] < 100) { activePhaseIdx = i; break; }
  }
  return { phaseProgress, activePhaseIdx };
}

// ── WBS 태스크에서 BIM 공정율 맵 빌드 ────────────────────────────
// 반환: { "bimId:IfcColumn": 42, "bimId:floor:0:FRAME": 100, ... }
function buildProgressMap(wbsTasks) {
  const map = {};
  wbsTasks.forEach(t => {
    if (!t.notes) return;
    // 층별 포맷: BIM:{id}:FLOOR:{n}:FRAME|SLAB
    const fm = t.notes.match(/^BIM:([^:]+):FLOOR:(\d+):(FRAME|SLAB)$/);
    if (fm) {
      map[`${fm[1]}:floor:${fm[2]}:${fm[3]}`] = Math.min(100, Math.max(0, t.progress || 0));
      return;
    }
    // 기존 포맷: BIM:{id}:{type}
    const m = t.notes.match(/^BIM:([^:]+):([^:]+)/);
    if (m) map[`${m[1]}:${m[2]}`] = Math.min(100, Math.max(0, t.progress || 0));
  });
  return map;
}

const FLOOR_FRAME_TYPES = new Set(['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcPier', 'IfcMember']);
const FLOOR_SLAB_TYPES  = new Set(['IfcSlab']);

function hasFloorTasks(progressMap, bimId) {
  if (!bimId) return false;
  return Object.keys(progressMap).some(k => k.startsWith(`${bimId}:floor:`));
}

function getFloorElemProgress(progressMap, bimId, floorIdx, elementType, fallback) {
  if (FLOOR_FRAME_TYPES.has(elementType)) {
    const key = `${bimId}:floor:${floorIdx}:FRAME`;
    if (key in progressMap) return progressMap[key];
  }
  if (FLOOR_SLAB_TYPES.has(elementType)) {
    const key = `${bimId}:floor:${floorIdx}:SLAB`;
    if (key in progressMap) return progressMap[key];
  }
  return fallback;
}

// ── 아래→위 공정율 채우기 렌더러 ──────────────────────────────────
// localPosition: Three.js Z-up 로컬 좌표 [x, y, z] (그룹 내 위치, z = 높이 중심)
// size:          Three.js Z-up [width, depth, height]
// progress:      0-100 (WBS 공정율)
// offsetZ:       소속 <group>의 world Z 오프셋 (clip plane은 world 좌표계)
const NEON_COLOR = '#aaff44';

function BimProgressFill({ localPosition, size, elementType, progress, offsetZ = 0, isSelected = false }) {
  const worldZBottom = localPosition[2] - size[2] / 2 + offsetZ;
  const worldHeight  = size[2];

  const planeRef    = useRef(null);
  const currentPRef = useRef(progress);
  const targetPRef  = useRef(progress);
  const wYBRef      = useRef(worldZBottom);

  if (!planeRef.current) {
    const initLevel = worldZBottom + (progress / 100) * worldHeight;
    planeRef.current = new THREE.Plane(new THREE.Vector3(0, 0, -1), initLevel);
  }

  useEffect(() => { targetPRef.current  = progress;     }, [progress]);
  useEffect(() => { wYBRef.current      = worldZBottom; }, [worldZBottom]);

  useFrame((_, delta) => {
    const diff = targetPRef.current - currentPRef.current;
    if (Math.abs(diff) < 0.01) return;
    currentPRef.current += diff * Math.min(1, delta * 2.0);
    planeRef.current.constant = wYBRef.current + (currentPRef.current / 100) * worldHeight;
  });

  const baseColor = isSelected ? NEON_COLOR : (getBaseColor(elementType) || '#334155');
  const p = progress;
  const fillColor = isSelected ? NEON_COLOR
    : p >= 100 ? '#60a5fa'
    : p >= 75  ? '#22c55e'
    : p >= 40  ? '#eab308'
    : p >  0   ? '#f97316'
    : '#334155';

  return (
    <group>
      {/* 고스트: 선택 시 형광으로 전체를 채움, 비선택 시 반투명 윤곽 */}
      <mesh position={localPosition} castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={baseColor}
          transparent
          opacity={isSelected ? 0.62 : 0.07}
          depthWrite={false}
          emissive={isSelected ? NEON_COLOR : '#000000'}
          emissiveIntensity={isSelected ? 0.55 : 0}
        />
      </mesh>
      {/* 외곽선 */}
      <lineSegments position={localPosition}>
        <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
        <lineBasicMaterial color={baseColor} transparent opacity={isSelected ? 0.95 : 0.28} />
      </lineSegments>
      {/* 채움: clip plane이 진도에 따라 아래→위로 이동 (비선택 시만 의미 있음) */}
      {!isSelected && (
        <mesh position={localPosition}>
          <boxGeometry args={size} />
          <meshStandardMaterial
            color={fillColor}
            clippingPlanes={[planeRef.current]}
            clipShadows
            transparent
            opacity={0.80}
            emissive={fillColor}
            emissiveIntensity={0.08}
          />
        </mesh>
      )}
    </group>
  );
}

// ── BIM 구조물 선택 하이라이트 박스 (맥동 아웃라인) ─────────────────
function StructureSelectionBox({ elements }) {
  const meshRef = useRef(null);
  const edgeRef = useRef(null);
  const tPulse  = useRef(0);

  const bounds = useMemo(() => {
    if (!elements?.length) return null;
    let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity, mnZ=Infinity, mxZ=-Infinity;
    elements.forEach(el => {
      const cv = toIntegrationCoords(el);
      const px=Number(cv.positionX)||0, py=Number(cv.positionY)||0, pz=Number(cv.positionZ)||0;
      const sx=Math.abs(Number(cv.sizeX))||0.1, sy=Math.abs(Number(cv.sizeY))||0.1, sz=Math.abs(Number(cv.sizeZ))||0.1;
      mnX=Math.min(mnX,px-sx/2); mxX=Math.max(mxX,px+sx/2);
      mnY=Math.min(mnY,py-sy/2); mxY=Math.max(mxY,py+sy/2);  // Z-up: Y=north 범위
      mnZ=Math.min(mnZ,pz);       mxZ=Math.max(mxZ,pz+sz);   // Z-up: Z=height 범위
    });
    if (!isFinite(mnX)) return null;
    return {
      cx:(mnX+mxX)/2, cy:(mnY+mxY)/2, cz:(mnZ+mxZ)/2,
      sw:mxX-mnX+0.8, sh:mxY-mnY+0.8, sd:mxZ-mnZ+0.8,
    };
  }, [elements]);

  const boxGeo = useMemo(
    () => bounds ? new THREE.BoxGeometry(bounds.sw, bounds.sh, bounds.sd) : null,
    [bounds]
  );

  useFrame((_, delta) => {
    tPulse.current += delta;
    const pulse = 0.7 + 0.25 * Math.sin(tPulse.current * 2.8);
    if (edgeRef.current?.material)  edgeRef.current.material.opacity  = pulse;
    if (meshRef.current?.material)  meshRef.current.material.opacity  = 0.28 + 0.1 * Math.sin(tPulse.current * 2);
  });

  if (!bounds || !boxGeo) return null;

  return (
    <group position={[bounds.cx, bounds.cy, bounds.cz]}>
      <mesh ref={meshRef}>
        <boxGeometry args={[bounds.sw, bounds.sh, bounds.sd]} />
        <meshStandardMaterial
          color={NEON_COLOR} transparent opacity={0.28}
          depthWrite={false} emissive={NEON_COLOR} emissiveIntensity={0.8}
        />
      </mesh>
      <lineSegments ref={edgeRef}>
        <edgesGeometry args={[boxGeo]} />
        <lineBasicMaterial color={NEON_COLOR} transparent opacity={0.9} />
      </lineSegments>
    </group>
  );
}

// ── 구조물 레이어 (여러 BIM/IFC 구조물) ──────────────────────────
function StructuresLayer() {
  const t = useT('integrationProject');
  const { structures, wbsTasks, surveyOrigin, bimWbsProgress } = useIntegration();
  const [selectedStructId, setSelectedStructId] = useState(null);

  // WBS notes 형식(BIM:<id>:<type>) 기반 공종별 진도 맵
  const progressMap = useMemo(() => buildProgressMap(wbsTasks), [wbsTasks]);

  // WBS 전체 평균 (notes 없는 태스크 기준)
  const overallWbsProgress = useMemo(() => {
    if (wbsTasks.length === 0) return 0;
    return wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / wbsTasks.length;
  }, [wbsTasks]);

  // BIM 프로젝트별 평균 진행률 — notes BIM:<id>:* 태스크가 있으면 해당 태스크만, 없으면 전체 평균 fallback
  const perProjectProgress = useMemo(() => {
    const result = {};
    structures.forEach(s => {
      if (s.type !== 'bim' || !s.bimProjectId || s.bimProjectId in result) return;
      const matching = wbsTasks.filter(t =>
        typeof t.notes === 'string' && t.notes.startsWith(`BIM:${s.bimProjectId}:`)
      );
      result[s.bimProjectId] = matching.length > 0
        ? matching.reduce((acc, t) => acc + (t.progress || 0), 0) / matching.length
        : overallWbsProgress;
    });
    return result;
  }, [structures, wbsTasks, overallWbsProgress]);

  // BIM 프로젝트별 시뮬 phase 진도 (CPM → phase 매핑, cascade용)
  const simPhaseProgressPerStruct = useMemo(() => {
    const result = {};
    structures.forEach(s => {
      if (s.type !== 'bim' || !s.bimProjectId) return;
      result[s.bimProjectId] = computeSimPhaseProgress(wbsTasks, s.bimProjectId);
    });
    return result;
  }, [structures, wbsTasks]);

  // BIM 구조물별 층 데이터 — raw positionY 기준 grouping
  const floorsPerStruct = useMemo(() => {
    const map = {};
    structures.forEach(s => {
      if (s.type === 'bim' && s.elements?.length) {
        map[s.id] = detectFloors(s.elements);
      }
    });
    return map;
  }, [structures]);

  const progressColor = p =>
    p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#374151';

  if (!structures?.length) return null;

  return (
    <>
      {structures.filter(s => s.visible !== false).map(s => {
        const elems = s.elements;
        if (!elems || elems.length === 0) return null;
        const offset  = s.offset || [0, 0, 0];
        const offsetZ = offset[2];  // Z-up: offset[2]=height 오프셋 → clip plane 기준
        const isBim   = s.type === 'bim';
        const isStructSelected = selectedStructId === s.id;

        const dispX = surveyOrigin ? offset[0] + surveyOrigin.x : offset[0];
        const dispY = surveyOrigin ? offset[1] + surveyOrigin.y : offset[1];
        const dispZ = surveyOrigin ? offset[2] + surveyOrigin.z : offset[2];
        const coordBadge = surveyOrigin ? t('surveyCoordBadge') : t('currentPosLabel');

        // 이 구조물 전용 진행률 (프로젝트별 분리)
        const projectAvgRaw = isBim
          ? (perProjectProgress[s.bimProjectId] ?? overallWbsProgress)
          : overallWbsProgress;
        const overall = Math.round(projectAvgRaw * 10) / 10;
        const overallCol = progressColor(overall);

        // 이 프로젝트에 해당하는 WBS 태스크만 필터 (notes BIM:<id>:* 또는 notes 없는 공통 태스크)
        const projectTasks = isBim
          ? wbsTasks.filter(t =>
              !t.notes ||
              !t.notes.match(/^BIM:[^:]+:/) ||
              t.notes.startsWith(`BIM:${s.bimProjectId}:`)
            )
          : wbsTasks;

        return (
          <group key={s.id} position={offset}>
            {/* 구조물 클릭 레이블 */}
            <Html center position={[0, 0, 0.4]} distanceFactor={40}>
              <div
                onClick={() => setSelectedStructId(isStructSelected ? null : s.id)}
                style={{
                  background: isStructSelected ? '#0a1e3aee' : '#0d1b2acc',
                  color: isStructSelected ? '#93c5fd' : '#60a5fa',
                  padding: '2px 7px', borderRadius: 3, fontSize: 8, fontWeight: 700,
                  border: `1px solid ${isStructSelected ? '#60a5fa' : '#1e3a5f'}`,
                  boxShadow: isStructSelected ? '0 0 8px #3b82f688' : 'none',
                  whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                  lineHeight: 1.6,
                  minWidth: isStructSelected ? 170 : 'auto',
                }}
              >
                🏗 {s.name}
                {isStructSelected && (
                  <>
                    <br />
                    <span style={{ fontSize: 7, color: '#60a5fa' }}>
                      📍 {coordBadge}  X:{dispX.toFixed(1)}  Y:{dispY.toFixed(1)}  Z:{dispZ.toFixed(1)}
                    </span>
                    {isBim && (
                      <div style={{ marginTop: 5, borderTop: '1px solid #facc1530', paddingTop: 4 }}>
                        {/* 전체 WBS 진행률 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 7, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            WBS 전체 진행률
                          </span>
                          <span style={{ fontSize: 10, color: overallCol, fontWeight: 800 }}>{overall.toFixed(1)}%</span>
                        </div>
                        <div style={{ background: '#0a1525', borderRadius: 3, height: 5, overflow: 'hidden', marginBottom: 6 }}>
                          <div style={{ height: '100%', width: `${overall}%`, background: overallCol, borderRadius: 3, transition: 'width 0.8s ease' }} />
                        </div>
                        {/* WBS 태스크 목록 (이 프로젝트 관련 태스크만) */}
                        {projectTasks.length === 0 ? (
                          <div style={{ fontSize: 7, color: '#4b5563' }}>WBS 태스크 없음</div>
                        ) : (
                          projectTasks.slice(0, 6).map(tk => {
                            const p = Math.round((tk.progress || 0) * 10) / 10;
                            const col = progressColor(p);
                            return (
                              <div key={tk.taskId} style={{ marginBottom: 3 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 7, color: '#c8d8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                                    {tk.taskName}
                                  </span>
                                  <span style={{ fontSize: 7, color: col, fontWeight: 800, flexShrink: 0 }}>{p.toFixed(1)}%</span>
                                </div>
                                <div style={{ background: '#0a1525', borderRadius: 2, height: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${p}%`, background: col, borderRadius: 2 }} />
                                </div>
                              </div>
                            );
                          })
                        )}
                        {projectTasks.length > 6 && (
                          <div style={{ fontSize: 6, color: '#374151', marginTop: 2 }}>+{projectTasks.length - 6}개 태스크 더 있음</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Html>
            {/* BIM 선택 하이라이트: 맥동하는 바운딩 박스 */}
            {isBim && isStructSelected && <StructureSelectionBox elements={elems} />}
            {/* 3D 층 레이블 (BIM + 층 2개 이상) */}
            {isBim && (() => {
              const floors = floorsPerStruct[s.id] || [];
              if (floors.length < 2) return null;
              return floors.map((floor, fi) => {
                const label     = getFloorLabel(fi, floors, t);
                const projectFallback = perProjectProgress[s.bimProjectId] ?? overallWbsProgress;
                const wbsData   = bimWbsProgress?.[s.bimProjectId];
                const simPhase  = simPhaseProgressPerStruct[s.bimProjectId]
                  || { phaseProgress: {}, activePhaseIdx: SIM_PHASE_ORDER.length };
                // 층 평균 진행률: BIM WBS 부재별 우선, 없으면 시뮬 phase cascade
                const floorPcts = floor.elements.map(el => {
                  const wbsEl = wbsData?.elements?.[el.elementId];
                  if (wbsEl != null) return wbsEl.progress ?? 0;
                  const ph  = ELEM_TYPE_TO_SIM_PHASE[el.elementType] ?? 'ABOVE';
                  const idx = SIM_PHASE_ORDER.indexOf(ph);
                  if (idx > simPhase.activePhaseIdx) return 0;
                  return progressMap[`${s.bimProjectId}:${el.elementType}`] ?? projectFallback;
                });
                const avgPct    = floorPcts.length ? floorPcts.reduce((a, b) => a + b) / floorPcts.length : 0;
                const cascade   = getFloorProgress(fi, floors.length, avgPct);
                const status    = getFloorStatus(cascade);
                const color     = getFloorStatusColor(status);
                // 3D 위치: floor.avgY 는 이제 미터 단위 (detectFloors 스케일 보정)
                const worldZ = floor.avgY;
                return (
                  <Html
                    key={`fl_${fi}`}
                    center
                    position={[-1.5, 0, worldZ + 0.5]}
                    distanceFactor={35}
                  >
                    <div style={{
                      background: '#071018cc', border: `1px solid ${color}55`,
                      borderLeft: `2px solid ${color}`,
                      padding: '1px 5px', borderRadius: 3,
                      fontSize: 7, color, fontWeight: 700,
                      whiteSpace: 'nowrap', userSelect: 'none',
                      lineHeight: 1.7,
                    }}>
                      {label}  {cascade.toFixed(0)}%
                    </div>
                  </Html>
                );
              });
            })()}
            {elems.map(el => {
              if (isBim) {
                const cv = toIntegrationCoords(el);
                const pX = Number(cv.positionX) || 0;
                const pY = Number(cv.positionY) || 0;
                const pZ = Number(cv.positionZ) || 0;
                const sX = Number(cv.sizeX)     || 0.1;
                const sY = Number(cv.sizeY)     || 0.1;
                const sZ = Number(cv.sizeZ)     || 0.1;
                // BIM WBS 부재별(DB) 우선 → 없으면 시뮬 phase cascade 적용
                const projectFallback = perProjectProgress[s.bimProjectId] ?? overallWbsProgress;
                const wbsData         = bimWbsProgress?.[s.bimProjectId];
                const wbsElemData     = wbsData?.elements?.[el.elementId];
                const simPhase        = simPhaseProgressPerStruct[s.bimProjectId]
                  || { phaseProgress: {}, activePhaseIdx: SIM_PHASE_ORDER.length };
                const elemPhaseKey    = ELEM_TYPE_TO_SIM_PHASE[el.elementType] ?? 'ABOVE';
                const elemPhaseIdx    = SIM_PHASE_ORDER.indexOf(elemPhaseKey);
                const floors          = floorsPerStruct[s.id] || [];
                const floorIdx        = getElementFloorIndex(el, floors);
                const useFloor        = hasFloorTasks(progressMap, s.bimProjectId);
                const baseProgress    = wbsElemData != null
                  ? wbsElemData.progress ?? 0
                  : useFloor
                    ? getFloorElemProgress(progressMap, s.bimProjectId, floorIdx, el.elementType, projectFallback)
                    : elemPhaseIdx > simPhase.activePhaseIdx
                      ? 0
                      : (progressMap[`${s.bimProjectId}:${el.elementType}`] ?? projectFallback);
                const elemProgress    = (!useFloor && floors.length >= 2)
                  ? getFloorProgress(floorIdx, floors.length, baseProgress)
                  : baseProgress;
                return (
                  <BimProgressFill
                    key={el.elementId}
                    localPosition={[pX, pY, pZ + sZ / 2]}
                    size={[sX, sY, sZ]}
                    elementType={el.elementType}
                    progress={elemProgress}
                    offsetZ={offsetZ}
                    isSelected={isStructSelected}
                  />
                );
              }
              return <BimElement key={el.elementId} element={toIntegrationCoords(el)} />;
            })}
          </group>
        );
      })}
    </>
  );
}

// ── 기존 BIM 연결 부재 (공정율 채우기 적용) ─────────────────────
function LinkedBimElements() {
  const { bimElements, projectMeta, wbsTasks } = useIntegration();

  const progressMap  = useMemo(() => buildProgressMap(wbsTasks), [wbsTasks]);
  const bimProjectId = projectMeta?.bimProjectId;

  const overallWbsProgress = useMemo(() => {
    if (wbsTasks.length === 0) return 0;
    return wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / wbsTasks.length;
  }, [wbsTasks]);

  const floors   = useMemo(() => detectFloors(bimElements || []), [bimElements]);
  const useFloor = useMemo(() => hasFloorTasks(progressMap, bimProjectId), [progressMap, bimProjectId]);

  if (!bimElements?.length) return null;
  return (
    <>
      {bimElements.map(el => {
        // DB Z-up: positionZ=Height, positionY=North, sizeZ=HeightSize, sizeY=NorthDepth
        const pZ = Number(el.positionZ) || 0;
        const sZ = Number(el.sizeZ) || 3;
        const floorIdx   = useFloor ? getElementFloorIndex(el, floors) : -1;
        const elemProgress = useFloor
          ? getFloorElemProgress(progressMap, bimProjectId, floorIdx, el.elementType, overallWbsProgress)
          : (progressMap[`${bimProjectId}:${el.elementType}`] ?? overallWbsProgress);
        return (
          <BimProgressFill
            key={el.elementId}
            localPosition={[el.positionX || 0, el.positionY || 0, pZ + sZ / 2]}
            size={[el.sizeX || 1, el.sizeY || 1, sZ]}
            elementType={el.elementType}
            progress={elemProgress}
            offsetZ={0}
          />
        );
      })}
    </>
  );
}

// ── 위험구역 마커 ────────────────────────────────────────────────
function DangerZoneMarker({ zone, isSelected, onSelect, surveyOrigin }) {
  const t = useT('integrationProject');
  const [hx, hy, hz] = zone.halfSize;
  const color = ZONE_COLOR[zone.type] || '#ef4444';
  const boxGeo = useMemo(() => new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), [hx, hy, hz]);
  if (!zone.active) return null;

  const cx = zone.center[0], cy = zone.center[1], cz = zone.center[2];
  const dispX = surveyOrigin ? cx + surveyOrigin.x : cx;
  const dispY = surveyOrigin ? cy + surveyOrigin.y : cy;
  const dispZ = surveyOrigin ? cz + surveyOrigin.z : cz;
  const coordBadge = surveyOrigin ? t('surveyCoordBadge') : t('currentPosLabel');

  return (
    <group position={zone.center}>
      <mesh
        onClick={e => { e.stopPropagation(); onSelect(zone.id); }}
        onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        <boxGeometry args={[hx * 2, hy * 2, hz * 2]} />
        <meshStandardMaterial
          color={color} transparent opacity={isSelected ? 0.22 : 0.10}
          side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[boxGeo]} />
        <lineBasicMaterial color={isSelected ? '#ffffff' : color} transparent opacity={isSelected ? 1 : 0.8} />
      </lineSegments>
      <Html center position={[0, 0, hz + 0.6]} distanceFactor={35}>
        <div style={{
          background: '#1a0000cc', color: isSelected ? '#ffffff' : color,
          padding: '2px 8px', borderRadius: 4, fontSize: 10,
          border: `1px solid ${isSelected ? '#ffffff' : color}`,
          whiteSpace: 'nowrap', pointerEvents: 'none', fontWeight: 700,
          boxShadow: isSelected ? `0 0 8px ${color}` : 'none',
        }}>
          ⚠ {zone.name}
        </div>
      </Html>
      {isSelected && (
        <Html center position={[0, 0, hz + 1.5]} distanceFactor={35}>
          <div style={{
            background: '#12100add', color: '#facc15',
            padding: '2px 8px', borderRadius: 3, fontSize: 8, fontWeight: 700,
            border: '1px solid #facc1540', whiteSpace: 'nowrap', pointerEvents: 'none',
            letterSpacing: '0.03em',
          }}>
            📍 {coordBadge}  X:{dispX.toFixed(1)}  Y:{dispY.toFixed(1)}  Z:{dispZ.toFixed(1)}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── 장비 모드 색 (정적 상수 — 렌더마다 새 객체 생성 방지) ────────
const EQUIP_MODE_COLOR = { auto: '#22c55e', standby: '#f59e0b', gps: '#a78bfa' };

// ── 작업자 메시 ─────────────────────────────────────────────────
// statusKey·isSelected가 바뀔 때만 리렌더
const WorkerItem = memo(function WorkerItem({ worker, statusKey, statusLabel, workerMeshes, isSelected, onSelect, surveyOriginRef }) {
  const groupRef = useRef(null);

  useLayoutEffect(() => {
    workerMeshes.current[worker.id] = groupRef.current;
    if (groupRef.current) {
      const ip = worker.initialPos || [0, 0, 0];
      // Z-up: Y-up 포맷 [east, 0, north] → Three.js [east, north, 0]
      groupRef.current.position.set(ip[0], ip[2], 0);
    }
    return () => { workerMeshes.current[worker.id] = null; };
  }, []); // eslint-disable-line

  const color    = STATUS_COLOR[statusKey] || STATUS_COLOR.normal;
  const emissive = isSelected ? '#ffffff' : '#000000';
  const emissiveI = isSelected ? 0.22 : 0;
  const hatColor = worker.gear ? '#fbbf24' : '#6b7280';

  return (
    <group ref={groupRef}>
      {/* Y-up 로컬 좌표 → Z-up 씬 변환 래퍼 */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        {/* 투명 히트박스 (전체 클릭 수신) */}
        <mesh
          position={[0, 1.1, 0]}
          onClick={e => { e.stopPropagation(); onSelect(worker.id); }}
          onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'auto'; }}
        >
          <cylinderGeometry args={[0.45, 0.45, 2.4, 8]} />
          <meshStandardMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* 다리 + 하체 (캡슐) */}
        <mesh position={[0, 0.62, 0]} castShadow>
          <capsuleGeometry args={[0.27, 0.7, 4, 8]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveI} />
        </mesh>

        {/* 상체 (박스 — 어깨 표현) */}
        <mesh position={[0, 1.2, 0]} castShadow>
          <boxGeometry args={[0.56, 0.46, 0.32]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveI} />
        </mesh>

        {/* 머리 (구) */}
        <mesh position={[0, 1.6, 0]} castShadow>
          <sphereGeometry args={[0.2, 10, 10]} />
          <meshStandardMaterial color="#f5c89a" />
        </mesh>

        {/* 헬멧 (챙 + 돔) */}
        <mesh position={[0, 1.77, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.24, 0.14, 10]} />
          <meshStandardMaterial color={hatColor} emissive={hatColor} emissiveIntensity={0.15} />
        </mesh>
        <mesh position={[0, 1.72, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.26, 0.06, 10]} />
          <meshStandardMaterial color={hatColor} emissive={hatColor} emissiveIntensity={0.1} />
        </mesh>

        {/* 선택 와이어프레임 */}
        {isSelected && (
          <mesh position={[0, 1.0, 0]}>
            <cylinderGeometry args={[0.52, 0.52, 2.2, 10]} />
            <meshStandardMaterial color={color} transparent opacity={0.15} wireframe />
          </mesh>
        )}
      </group>

      <Html center distanceFactor={30} position={[0, 0, 2.15]}>
        <div style={{
          background: '#0d1b2acc', color,
          padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
          border: `1px solid ${isSelected ? '#ffffff' : color}`,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: isSelected ? `0 0 6px ${color}` : 'none',
        }}>
          👷 {worker.name} · {statusLabel[statusKey] || ''}
        </div>
      </Html>
      {isSelected && surveyOriginRef && (
        <LiveCoordLabel groupRef={groupRef} surveyOriginRef={surveyOriginRef} labelY={2.75} />
      )}
    </group>
  );
});

// ── 장비 형상 서브컴포넌트 ──────────────────────────────────────────
const MAT_DARK   = '#1e1e1e';
const MAT_TRACK  = '#2a2520';
const MAT_STEEL  = '#555566';
const MAT_WIRE   = '#8888aa';

function ExcavatorShape({ bw, bh, bd, color, em, emI }) {
  const tw = bw * 0.2, th = 0.32, td = bd * 1.1; // 무한궤도
  const bodyH = bh * 0.52, bodyY = th + bodyH / 2;
  const cabH  = bh * 0.44, cabY  = bodyY + bodyH / 2 + cabH / 2;
  const armL  = bh * 0.72;
  const stickL = bh * 0.55;
  return (
    <>
      {/* 무한궤도 좌/우 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * (bw / 2 - tw / 2 + 0.05), th / 2, 0]} castShadow>
          <boxGeometry args={[tw, th, td]} />
          <meshStandardMaterial color={MAT_TRACK} roughness={0.9} />
        </mesh>
      ))}
      {/* 하부 회전체 */}
      <mesh position={[0, th + 0.18, 0]} castShadow>
        <cylinderGeometry args={[bw * 0.42, bw * 0.42, 0.36, 12]} />
        <meshStandardMaterial color={MAT_DARK} />
      </mesh>
      {/* 상부 차체 본체 */}
      <mesh position={[0, bodyY, 0]} castShadow>
        <boxGeometry args={[bw * 0.85, bodyH, bd * 0.82]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI} metalness={0.25} roughness={0.6} />
      </mesh>
      {/* 운전석 캡 */}
      <mesh position={[-bw * 0.18, cabY, -bd * 0.18]} castShadow>
        <boxGeometry args={[bw * 0.48, cabH, bd * 0.45]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI + 0.05} metalness={0.3} />
      </mesh>
      {/* 캡 유리 */}
      <mesh position={[-bw * 0.18, cabY, -bd * 0.41]}>
        <boxGeometry args={[bw * 0.36, cabH * 0.6, 0.06]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.45} metalness={0.5} />
      </mesh>
      {/* 붐 암 */}
      <mesh position={[bw * 0.18, bodyY + bodyH * 0.3 + armL * 0.35, bd * 0.28]}
            rotation={[-Math.PI * 0.28, 0, 0]} castShadow>
        <boxGeometry args={[0.28, armL, 0.28]} />
        <meshStandardMaterial color={MAT_STEEL} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* 스틱 암 */}
      <mesh position={[bw * 0.18, bodyY + bodyH * 0.3 + armL * 0.62 + stickL * 0.18, bd * 0.7]}
            rotation={[Math.PI * 0.08, 0, 0]} castShadow>
        <boxGeometry args={[0.2, stickL, 0.2]} />
        <meshStandardMaterial color={MAT_STEEL} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* 버킷 (작은 박스) */}
      <mesh position={[bw * 0.18, bodyY + bodyH * 0.3 + armL * 0.62 + stickL * 0.58, bd * 0.88]} castShadow>
        <boxGeometry args={[0.45, 0.28, 0.38]} />
        <meshStandardMaterial color={MAT_DARK} metalness={0.6} />
      </mesh>
    </>
  );
}

function DumpTruckShape({ bw, bh, bd, color, em, emI }) {
  const frameH = 0.28;
  const cabH = bh, cabD = bd * 0.38;
  const bedH = bh * 0.62, bedD = bd * 0.62;
  const wr = 0.32, wt = 0.22; // 바퀴 반지름/두께
  const wheelY = frameH + wr * 0.85;
  const wheelPositions = [
    [-bw * 0.4, -cabD * 0.35], [bw * 0.4, -cabD * 0.35],
    [-bw * 0.4,  bedD * 0.28], [bw * 0.4,  bedD * 0.28],
    [-bw * 0.4,  bedD * 0.55], [bw * 0.4,  bedD * 0.55],
  ];
  return (
    <>
      {/* 프레임 */}
      <mesh position={[0, frameH / 2, 0]} castShadow>
        <boxGeometry args={[bw, frameH, bd]} />
        <meshStandardMaterial color={MAT_DARK} />
      </mesh>
      {/* 바퀴 */}
      {wheelPositions.map(([x, z], i) => (
        <mesh key={i} position={[x, wheelY, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wr, wr, wt, 12]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      ))}
      {/* 바퀴 허브 */}
      {wheelPositions.map(([x, z], i) => (
        <mesh key={`h${i}`} position={[x, wheelY, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[wr * 0.45, wr * 0.45, wt + 0.04, 8]} />
          <meshStandardMaterial color={MAT_STEEL} metalness={0.7} />
        </mesh>
      ))}
      {/* 운전석 캡 */}
      <mesh position={[0, frameH + cabH / 2, -(bedD / 2 + cabD / 2 + 0.04)]} castShadow>
        <boxGeometry args={[bw, cabH, cabD]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI} metalness={0.2} roughness={0.6} />
      </mesh>
      {/* 캡 유리 (앞) */}
      <mesh position={[0, frameH + cabH * 0.62, -(bedD / 2 + cabD + 0.04)]}>
        <boxGeometry args={[bw * 0.7, cabH * 0.35, 0.06]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.5} metalness={0.4} />
      </mesh>
      {/* 적재함 */}
      <mesh position={[0, frameH + bedH / 2, bedD / 2 - cabD * 0.05]} castShadow>
        <boxGeometry args={[bw, bedH, bedD]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI + 0.04} metalness={0.15} roughness={0.7} />
      </mesh>
      {/* 적재함 앞벽 */}
      <mesh position={[0, frameH + bedH * 0.55, -(bedD * 0.5 - cabD * 0.05 + 0.08)]}>
        <boxGeometry args={[bw, bedH * 1.05, 0.1]} />
        <meshStandardMaterial color={MAT_DARK} />
      </mesh>
    </>
  );
}

function CraneShape({ bw, bh, bd, color, em, emI }) {
  const baseH = 0.9, towerW = 0.42, towerH = bh;
  const boomL = bw * 1.3, cjibL = bw * 0.5;
  const wireH = bh * 0.85;
  return (
    <>
      {/* 베이스 / 차체 */}
      <mesh position={[0, baseH / 2, 0]} castShadow>
        <boxGeometry args={[bw, baseH, bd]} />
        <meshStandardMaterial color={MAT_DARK} roughness={0.8} />
      </mesh>
      {/* 차체 색 패널 */}
      <mesh position={[0, baseH * 0.52, 0]}>
        <boxGeometry args={[bw * 0.85, baseH * 0.45, bd * 0.9]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI} />
      </mesh>
      {/* 아웃트리거 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * bw * 0.62, 0.1, 0]} castShadow>
          <boxGeometry args={[bw * 0.24, 0.2, bd * 0.22]} />
          <meshStandardMaterial color={MAT_DARK} />
        </mesh>
      ))}
      {/* 타워 / 마스트 */}
      <mesh position={[0, baseH + towerH / 2, 0]} castShadow>
        <boxGeometry args={[towerW, towerH, towerW]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI} metalness={0.35} roughness={0.55} />
      </mesh>
      {/* 타워 대각 보강재 */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * towerW * 0.15, baseH + towerH * 0.5, 0]}
              rotation={[0, 0, s * Math.PI * 0.12]} castShadow>
          <boxGeometry args={[0.08, towerH * 0.9, towerW * 0.8]} />
          <meshStandardMaterial color={MAT_STEEL} metalness={0.5} />
        </mesh>
      ))}
      {/* 주 지브 (붐 — 수평) */}
      <mesh position={[boomL * 0.3, baseH + towerH + 0.14, 0]} castShadow>
        <boxGeometry args={[boomL, 0.22, 0.22]} />
        <meshStandardMaterial color={MAT_WIRE} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* 카운터 지브 */}
      <mesh position={[-cjibL * 0.35, baseH + towerH + 0.14, 0]} castShadow>
        <boxGeometry args={[cjibL, 0.18, 0.18]} />
        <meshStandardMaterial color={MAT_STEEL} metalness={0.5} />
      </mesh>
      {/* 카운터웨이트 */}
      <mesh position={[-cjibL * 0.68, baseH + towerH, 0]} castShadow>
        <boxGeometry args={[0.55, 0.42, 0.42]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      {/* 훅 와이어 */}
      <mesh position={[boomL * 0.58, baseH + towerH / 2 + 0.14, 0]}>
        <cylinderGeometry args={[0.04, 0.04, wireH, 4]} />
        <meshStandardMaterial color={MAT_WIRE} metalness={0.6} />
      </mesh>
      {/* 훅 */}
      <mesh position={[boomL * 0.58, baseH + 0.14 + (towerH - wireH) / 2, 0]}>
        <sphereGeometry args={[0.14, 6, 6]} />
        <meshStandardMaterial color={MAT_DARK} metalness={0.8} />
      </mesh>
    </>
  );
}

function VehicleShape({ bw, bh, bd, color, em, emI }) {
  const frameH = 0.22, bodyH = bh * 0.52, roofH = bh * 0.38;
  const wr = 0.28, wt = 0.2;
  return (
    <>
      {/* 프레임 */}
      <mesh position={[0, frameH / 2, 0]} castShadow>
        <boxGeometry args={[bw, frameH, bd]} />
        <meshStandardMaterial color={MAT_DARK} />
      </mesh>
      {/* 바퀴 */}
      {[[-bw * 0.38, -bd * 0.32], [bw * 0.38, -bd * 0.32],
        [-bw * 0.38,  bd * 0.32], [bw * 0.38,  bd * 0.32]].map(([x, z], i) => (
        <mesh key={i} position={[x, frameH + wr * 0.8, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wr, wr, wt, 10]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      ))}
      {/* 차체 */}
      <mesh position={[0, frameH + bodyH / 2, 0]} castShadow>
        <boxGeometry args={[bw, bodyH, bd]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI} metalness={0.2} roughness={0.6} />
      </mesh>
      {/* 루프 (캐빈) */}
      <mesh position={[0, frameH + bodyH + roofH / 2, -bd * 0.05]} castShadow>
        <boxGeometry args={[bw * 0.82, roofH, bd * 0.55]} />
        <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI + 0.04} metalness={0.25} />
      </mesh>
      {/* 앞 유리 */}
      <mesh position={[0, frameH + bodyH + roofH * 0.5, -bd * 0.32]}>
        <boxGeometry args={[bw * 0.6, roofH * 0.65, 0.07]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.5} metalness={0.4} />
      </mesh>
    </>
  );
}

function GenericEquipShape({ bw, bh, bd, color, em, emI }) {
  return (
    <mesh position={[0, bh / 2, 0]} castShadow>
      <boxGeometry args={[bw, bh, bd]} />
      <meshStandardMaterial color={color} emissive={em} emissiveIntensity={emI} metalness={0.2} roughness={0.7} />
    </mesh>
  );
}

// ── 장비 메시 ────────────────────────────────────────────────────
// 작업자 상태 변화와 완전히 독립 — isSelected·modeLabel 바뀔 때만 리렌더
const EquipItem = memo(function EquipItem({ equip, isSelected, modeLabel, equipStateRef, equipMeshes, onSelect, surveyOriginRef }) {
  const groupRef = useRef(null);

  useLayoutEffect(() => {
    equipMeshes.current[equip.id] = groupRef.current;
    if (groupRef.current) {
      const pos = equipStateRef.current[equip.id]?.pos || equip.initialPos || [0, 0, 0];
      // Z-up: Y-up 포맷 [east, 0, north] → Three.js [east, north, 0]
      groupRef.current.position.set(pos[0], pos[2], 0);
    }
    return () => { equipMeshes.current[equip.id] = null; };
  }, []); // eslint-disable-line

  const [bw, bh, bd] = equip.size || [2.8, 2.5, 3.5];
  const color  = EQUIP_COLOR[equip.type] || '#888888';
  const em     = isSelected ? '#ffffff' : '#000000';
  const emI    = isSelected ? 0.18 : 0;
  const labelY = equip.type === 'crane' ? bh + 1.4 : bh + 1.1;

  const shapeProps = { bw, bh, bd, color, em, emI };

  return (
    <group ref={groupRef}>
      {/* Y-up 로컬 좌표 → Z-up 씬 변환 래퍼 */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        {/* 투명 히트박스 */}
        <mesh
          position={[0, bh / 2, 0]}
          onClick={e => { e.stopPropagation(); onSelect(equip.id); }}
          onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = 'auto'; }}
        >
          <boxGeometry args={[Math.max(bw, 1.4) + 0.5, bh + 0.6, Math.max(bd, 1.4) + 0.5]} />
          <meshStandardMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* 타입별 형상 */}
        {equip.type === 'excavator' && <ExcavatorShape {...shapeProps} />}
        {equip.type === 'dump'      && <DumpTruckShape {...shapeProps} />}
        {equip.type === 'crane'     && <CraneShape     {...shapeProps} />}
        {equip.type === 'vehicle'   && <VehicleShape   {...shapeProps} />}
        {equip.type !== 'excavator' && equip.type !== 'dump' &&
         equip.type !== 'crane'     && equip.type !== 'vehicle' &&
          <GenericEquipShape {...shapeProps} />}

        {/* 선택 바운딩 박스 */}
        {isSelected && (
          <mesh position={[0, bh / 2, 0]}>
            <boxGeometry args={[bw + 0.5, bh + 0.8, bd + 0.5]} />
            <meshStandardMaterial color="#60a5fa" transparent opacity={0.16} wireframe />
          </mesh>
        )}
      </group>

      <Html center distanceFactor={30} position={[0, 0, labelY]}>
        <div style={{
          background: '#0d1b2acc', color,
          padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
          border: `1px solid ${isSelected ? '#60a5fa' : color}`,
          whiteSpace: 'nowrap', pointerEvents: 'none',
          boxShadow: isSelected ? `0 0 8px ${color}` : 'none',
        }}>
          {EQUIP_ICON[equip.type] || '🔧'} {equip.name}
          <span style={{ color: EQUIP_MODE_COLOR[equip.mode] || '#6b7280', marginLeft: 4 }}>
            [{modeLabel[equip.mode] || equip.mode}]
          </span>
        </div>
      </Html>
      {isSelected && surveyOriginRef && (
        <LiveCoordLabel groupRef={groupRef} surveyOriginRef={surveyOriginRef} labelY={labelY + 0.65} />
      )}
    </group>
  );
});

// ── WBS 작업 배정 헬퍼 ────────────────────────────────────────────────
// BIM 구조물 단위 변환 스케일 (computeStructureBounds 와 동일 기준)
function getStructureScale(struct) {
  const els = struct.elements || [];
  if (!els.length) return 1;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  els.forEach(el => {
    // Z-up DB: positionX=East, positionY=North — 수평 범위로 mm/m 판별
    const px = Number(el.positionX) || 0, py = Number(el.positionY) || 0;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  });
  return (maxX - minX > 500 || maxY - minY > 500) ? 0.001 : 1;
}

// elementType에 해당하는 부재들의 무게중심 → 씬 XZ 위치
function findElementCentroid(struct, elementType) {
  const els = struct.elements.filter(el => el.elementType === elementType);
  if (!els.length) return null;
  const offset = struct.offset || [0, 0, 0];
  const scale  = getStructureScale(struct);
  const cx = els.reduce((s, el) => s + (Number(el.positionX) || 0), 0) / els.length;
  // Z-up DB: positionY=North(Three.js Y=수평 depth) → Y-up 포맷 [east, 0, north]의 [2]에 저장
  const cy = els.reduce((s, el) => s + (Number(el.positionY) || 0), 0) / els.length;
  return [offset[0] + cx * scale, 0, offset[1] + cy * scale];
}

// ── 덤프트럭 작업 사이클 헬퍼 ────────────────────────────────────────
// from/to: [x, 0, z]  →  중간 우회점 포함 경로 반환
function buildDumpRoute(from, to) {
  const mx = (from[0] + to[0]) / 2 + (Math.random() - 0.5) * 6;
  const mz = (from[2] + to[2]) / 2 + (Math.random() - 0.5) * 6;
  return [
    [from[0], 0, from[2]],
    [mx,      0, mz],
    [to[0],   0, to[2]],
  ];
}

// 굴착기에서 가장 먼 플레이 에어리어 코너 → 토사 반출 지점
function findDumpZone(excavPos, pa) {
  const corners = [
    [pa.minX + 5, 0, pa.minZ + 5],
    [pa.maxX - 5, 0, pa.minZ + 5],
    [pa.minX + 5, 0, pa.maxZ - 5],
    [pa.maxX - 5, 0, pa.maxZ - 5],
  ];
  return corners.reduce((best, c) => {
    const d2  = (c[0]-excavPos[0])**2 + (c[2]-excavPos[2])**2;
    const bd2 = (best[0]-excavPos[0])**2 + (best[2]-excavPos[2])**2;
    return d2 > bd2 ? c : best;
  }, corners[0]);
}

// dump_site 구역 중심 반환 (없으면 폴백으로 play area 코너 사용)
function resolveDumpTarget(excavPos, pa, zones) {
  const sites = zones.filter(z => z.type === 'dump_site' && z.active !== false);
  if (sites.length > 0) {
    // 여러 개면 굴착기에서 가장 먼 사이트 선택 (반출 동선 최대화)
    const best = sites.reduce((b, z) => {
      const d2 = (z.center[0]-excavPos[0])**2 + (z.center[2]-excavPos[2])**2;
      const bd = (b.center[0]-excavPos[0])**2 + (b.center[2]-excavPos[2])**2;
      return d2 > bd ? z : b;
    }, sites[0]);
    return [best.center[0], 0, best.center[2]];
  }
  return findDumpZone(excavPos, pa);
}

// ── 시뮬레이션 관리자 ─────────────────────────────────────────────
function SimulationManager({ running }) {
  const t = useT('integrationProject');
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const { workers: initWorkers, equipment: initEquip, dangerZones, selectedEquipId, selectedWorkerId, surveyOrigin, structures, wbsTasks } = useIntegration();
  const dispatch = useIntegrationDispatch();

  // stale-closure 없이 선택 상태를 읽기 위한 ref
  const selectedEquipIdRef  = useRef(selectedEquipId);
  const selectedWorkerIdRef = useRef(selectedWorkerId);
  useEffect(() => { selectedEquipIdRef.current  = selectedEquipId;  }, [selectedEquipId]);
  useEffect(() => { selectedWorkerIdRef.current = selectedWorkerId; }, [selectedWorkerId]);

  // surveyOrigin ref — LiveCoordLabel이 stale closure 없이 최신값 읽음
  const surveyOriginRef = useRef(surveyOrigin);
  useEffect(() => { surveyOriginRef.current = surveyOrigin; }, [surveyOrigin]);

  // 3D 클릭 핸들러 (stable — 의존성 없이 ref 사용)
  const onSelectEquip = useCallback((id) => {
    const cur = selectedEquipIdRef.current;
    dispatch({ type: 'SELECT_EQUIPMENT', id: cur === id ? null : id });
    dispatch({ type: 'SELECT_WORKER',    id: null });
    dispatch({ type: 'SELECT_ZONE',      id: null });
  }, [dispatch]);

  const onSelectWorker = useCallback((id) => {
    const cur = selectedWorkerIdRef.current;
    dispatch({ type: 'SELECT_WORKER',    id: cur === id ? null : id });
    dispatch({ type: 'SELECT_EQUIPMENT', id: null });
    dispatch({ type: 'SELECT_ZONE',      id: null });
  }, [dispatch]);

  const equipStateRef  = useRef({});
  const workerStateRef = useRef({});
  const equipMeshes    = useRef({});
  const workerMeshes   = useRef({});
  const throttleMap    = useRef({});
  const wbsTickRef     = useRef(0);
  const livePosTimer   = useRef(0);
  // 덤프트럭 작업 사이클 상태
  const dumpWorkRef    = useRef({});
  // 덤프트럭 물리 경로/속도 — dispatch 비동기 지연 없이 즉시 반영
  const dumpPhysRef    = useRef({}); // { [id]: { route, speed, stopped } }
  // WBS 배정 이동 상태 { [entityId]: { taskId, targetPos } }
  const wbsMoveRef     = useRef({});

  // 장비 추가/제거/경로변경 동기화
  useEffect(() => {
    const existingIds = new Set(Object.keys(equipStateRef.current));
    const storeIds    = new Set(initEquip.map(e => e.id));
    initEquip.forEach(e => {
      const startPos = (e.route && e.route[0]) ? [...e.route[0]] : [...(e.initialPos || [0, 0, 0])];
      if (!existingIds.has(e.id)) {
        equipStateRef.current[e.id] = { pos: startPos, routeIdx: 0, t: 0 };
      } else {
        // route가 바뀌면 pos를 route[0]으로 텔레포트 (speed=0 장비도 올바른 위치에)
        const st = equipStateRef.current[e.id];
        const prevRoute = st._route;
        if (e.route && e.route !== prevRoute) {
          st.pos      = startPos;
          st.routeIdx = 0;
          st.t        = 0;
          if (equipMeshes.current[e.id])
            equipMeshes.current[e.id].position.set(startPos[0], startPos[2], 0);
          // 덤프 사이클 상태 클리어 (외부에서 경로 변경됨 → 사이클 재초기화)
          if (e.type === 'dump') { delete dumpWorkRef.current[e.id]; delete dumpPhysRef.current[e.id]; }
        }
        st._route = e.route;
      }
    });
    existingIds.forEach(id => { if (!storeIds.has(id)) delete equipStateRef.current[id]; });
  }, [initEquip]);

  // 작업자 추가/제거/위치변경 동기화
  useEffect(() => {
    const existingIds = new Set(Object.keys(workerStateRef.current));
    const storeIds    = new Set(initWorkers.map(w => w.id));
    initWorkers.forEach(w => {
      const newPos = w.initialPos || [0, 0, 0];
      if (!existingIds.has(w.id)) {
        workerStateRef.current[w.id] = { pos: [...newPos], _lastInitialPos: newPos };
      } else {
        // initialPos가 설정 패널에서 변경됐으면 현재 위치를 즉시 이동
        const st = workerStateRef.current[w.id];
        const lp = st._lastInitialPos;
        if (!lp || lp[0] !== newPos[0] || lp[1] !== newPos[1] || lp[2] !== newPos[2]) {
          st.pos = [...newPos];
          st._lastInitialPos = newPos;
          workerMeshes.current[w.id]?.position.set(newPos[0], newPos[2], 0);
        }
      }
    });
    existingIds.forEach(id => { if (!storeIds.has(id)) delete workerStateRef.current[id]; });
  }, [initWorkers]);

  const zonesRef      = useRef(dangerZones);
  useEffect(() => { zonesRef.current = dangerZones; }, [dangerZones]);
  const equipRef      = useRef(initEquip);
  useEffect(() => { equipRef.current = initEquip; }, [initEquip]);
  const workerRef     = useRef(initWorkers);
  useEffect(() => { workerRef.current = initWorkers; }, [initWorkers]);
  const structuresRef = useRef(structures);
  useEffect(() => { structuresRef.current = structures; }, [structures]);
  const wbsTasksRef = useRef(wbsTasks);
  useEffect(() => { wbsTasksRef.current = wbsTasks; }, [wbsTasks]);

  // ── WBS 태스크 배정 시 이동 목적지 계산 ──────────────────────────
  useEffect(() => {
    initEquip.forEach(e => {
      if (!e.assignedWbsTaskId) {
        delete wbsMoveRef.current[e.id];
        return;
      }
      const ref = wbsMoveRef.current[e.id];
      if (ref?.taskId === e.assignedWbsTaskId) return; // 이미 처리됨

      const task = wbsTasksRef.current.find(t => t.taskId === e.assignedWbsTaskId);
      if (!task?.notes) return;
      const match = task.notes.match(/^BIM:([^:]+):([^:]+)/);
      if (!match) return;
      const [, pid, elementType] = match;
      const struct = structuresRef.current.find(s => s.bimProjectId === pid && s.elements?.length);
      if (!struct) return;

      const targetPos = findElementCentroid(struct, elementType);
      if (!targetPos) return;

      // 작업 루프 경로: 목적지 중심 4점 순환
      const r = 2.5 + Math.random() * 1.5;
      const workRoute = [
        [targetPos[0],   0, targetPos[2]  ],
        [targetPos[0]+r, 0, targetPos[2]  ],
        [targetPos[0]+r, 0, targetPos[2]+r],
        [targetPos[0],   0, targetPos[2]+r],
      ];
      const spd = e.type === 'crane' ? 0.3 : e.type === 'excavator' ? 0.6 : 1.5;
      dispatch({ type: 'UPDATE_EQUIPMENT', id: e.id, updates: { route: workRoute, speed: spd } });
      const st = equipStateRef.current[e.id];
      if (st) { st.routeIdx = 0; st.t = 0; }
      delete dumpWorkRef.current[e.id]; // 덤프 사이클 중단
      delete dumpPhysRef.current[e.id];
      wbsMoveRef.current[e.id] = { taskId: e.assignedWbsTaskId, targetPos };
    });

    initWorkers.forEach(w => {
      const ws = workerStateRef.current[w.id];
      if (!ws) return;
      if (!w.assignedWbsTaskId) {
        ws.wbsTarget = null;
        delete wbsMoveRef.current[w.id];
        return;
      }
      const ref = wbsMoveRef.current[w.id];
      if (ref?.taskId === w.assignedWbsTaskId) return;

      const task = wbsTasksRef.current.find(t => t.taskId === w.assignedWbsTaskId);
      if (!task?.notes) return;
      const match = task.notes.match(/^BIM:([^:]+):([^:]+)/);
      if (!match) return;
      const [, pid, elementType] = match;
      const struct = structuresRef.current.find(s => s.bimProjectId === pid && s.elements?.length);
      if (!struct) return;

      const targetPos = findElementCentroid(struct, elementType);
      if (!targetPos) return;

      ws.wbsTarget = targetPos;
      wbsMoveRef.current[w.id] = { taskId: w.assignedWbsTaskId, targetPos };
    });
  }, [initEquip, initWorkers, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // BIM 구조물 전체를 포함하는 play area (동적 클램프 기준)
  const playAreaRef = useRef({ minX: -28, maxX: 28, minZ: -28, maxZ: 28 });
  useEffect(() => {
    const bimList = structures.filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0);
    if (!bimList.length) { playAreaRef.current = { minX: -28, maxX: 28, minZ: -28, maxZ: 28 }; return; }
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    bimList.forEach(s => {
      const b = computeStructureBounds(s);
      mnX = Math.min(mnX, b.minX); mxX = Math.max(mxX, b.maxX);
      mnZ = Math.min(mnZ, b.minZ); mxZ = Math.max(mxZ, b.maxZ);
    });
    playAreaRef.current = { minX: mnX - 8, maxX: mxX + 8, minZ: mnZ - 8, maxZ: mxZ + 8 };
  }, [structures]);

  // 자동 시작 시 작업자를 BIM 영역으로 즉시 이동
  const isAutoRunning = structures.some(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0)
    && initEquip.some(e => e.mode === 'auto');
  useEffect(() => {
    if (!isAutoRunning) return;
    const bimList = structuresRef.current.filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0);
    if (!bimList.length) return;
    const wTotal = initWorkers.length || 1;
    const wCols  = Math.max(1, Math.ceil(Math.sqrt(wTotal)));
    const wRows  = Math.max(1, Math.ceil(wTotal / wCols));
    initWorkers.forEach((w, wIdx) => {
      const ws = workerStateRef.current[w.id];
      if (!ws) return;
      const b  = computeStructureBounds(bimList[wIdx % bimList.length]);
      const bW = b.maxX - b.minX, bD = b.maxZ - b.minZ;
      const col = wIdx % wCols, row = Math.floor(wIdx / wCols) % wRows;
      const cW  = bW / wCols,   cD  = bD / wRows;
      const nx  = b.minX + cW * col + (0.2 + Math.random() * 0.6) * cW;
      const nz  = b.minZ + cD * row + (0.2 + Math.random() * 0.6) * cD;
      ws.pos = [nx, 0, nz];
      ws.dir = null;
      workerMeshes.current[w.id]?.position.set(nx, nz, 0);
    });
  }, [isAutoRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── stale-closure 방지: 작업자 상태를 ref로 관리 ────────────────
  // useState 대신 ref + tick 패턴 → useFrame 안에서 항상 최신 값 읽기
  const workerStatusesRef = useRef(
    Object.fromEntries(initWorkers.map(w => [w.id, w.gear ? 'normal' : 'no_gear']))
  );
  const [statusTick, setStatusTick] = useState(0);

  // 작업자 추가/제거 시 ref 동기화
  useEffect(() => {
    const next = {};
    initWorkers.forEach(w => {
      next[w.id] = workerStatusesRef.current[w.id] || (w.gear ? 'normal' : 'no_gear');
    });
    workerStatusesRef.current = next;
    setStatusTick(n => n + 1);
  }, [initWorkers]);

  useFrame((_, delta) => {
    if (!running) return;

    const equips  = equipRef.current;
    const workers = workerRef.current;
    const zones   = zonesRef.current;

    // 장비 이동 — 이동 전 상태 백업 (충돌 차단 시 복원용)
    equips.forEach(e => {
      const st = equipStateRef.current[e.id];
      if (!st) return;
      st.prevPos      = [...st.pos];
      st.prevT        = st.t;
      st.prevRouteIdx = st.routeIdx;

      if (e.mode === 'gps' && e.gpsPos) {
        st.pos = [e.gpsPos[0], e.gpsPos[1] || 0, e.gpsPos[2]];
        equipMeshes.current[e.id]?.position.set(st.pos[0], st.pos[2], 0);
        return;
      }
      if (e.mode !== 'auto') return;

      // 덤프트럭은 dumpPhysRef 우선 (dispatch 비동기 딜레이 없이 즉시 반영)
      const dp = e.type === 'dump' ? dumpPhysRef.current[e.id] : null;
      if (dp?.stopped) return; // 정차 중 — 위치 유지
      const route = dp ? dp.route : e.route;
      const speed = dp ? dp.speed : e.speed;

      if (!route || route.length < 2 || speed <= 0) return;

      const n = route.length;
      let fi = st.routeIdx % n;
      let ti = (fi + 1) % n;
      let fr = route[fi], to = route[ti];
      let dx = to[0] - fr[0], dz = to[2] - fr[2];
      let len = Math.sqrt(dx * dx + dz * dz);

      if (len < 0.01) {
        st.routeIdx = ti;
        fi = ti; ti = (ti + 1) % n;
        fr = route[fi]; to = route[ti];
        dx = to[0] - fr[0]; dz = to[2] - fr[2];
        len = Math.sqrt(dx * dx + dz * dz) || 0.001;
      }

      st.t += (speed * delta) / len;

      while (st.t >= 1) {
        st.t -= 1;
        st.routeIdx = (st.routeIdx + 1) % n;
        const nfi = st.routeIdx, nti = (nfi + 1) % n;
        const nlen = Math.hypot(
          route[nti][0] - route[nfi][0],
          route[nti][2] - route[nfi][2]
        );
        if (nlen < 0.01) { st.routeIdx = nti; st.t = 0; break; }
      }

      const f2 = route[st.routeIdx % n];
      const t2 = route[(st.routeIdx + 1) % n];
      st.pos = [
        f2[0] + (t2[0] - f2[0]) * st.t,
        f2[1] || 0,
        f2[2] + (t2[2] - f2[2]) * st.t,
      ];
      equipMeshes.current[e.id]?.position.set(st.pos[0], st.pos[2], 0);
    });

    // ── 장비 충돌 차단: 겹치면 이동 취소 (밀어내기 X, 진입 금지) ────
    for (let ia = 0; ia < equips.length; ia++) {
      const ea = equips[ia];
      const sa = equipStateRef.current[ea.id];
      if (!sa || ea.mode !== 'auto') continue;  // 이동 중인 auto 장비만 체크
      const ra = (ea.size ? Math.max(ea.size[0], ea.size[2]) : 3.5) / 2 + 1.0;
      for (let ib = 0; ib < equips.length; ib++) {
        if (ib === ia) continue;
        const eb = equips[ib];
        const sb = equipStateRef.current[eb.id];
        if (!sb) continue;
        // 굴착기-덤프트럭 쌍은 협동 작업이므로 충돌 무시
        if ((ea.type === 'excavator' && eb.type === 'dump') ||
            (ea.type === 'dump'      && eb.type === 'excavator')) continue;
        // 덤프 사이클 진행 중인 덤프트럭은 이동 경로 우선권 — 충돌 롤백 제외
        if (ea.type === 'dump' && dumpWorkRef.current[ea.id]) continue;
        if (eb.type === 'dump' && dumpWorkRef.current[eb.id]) continue;
        const dx = sa.pos[0] - sb.pos[0];
        const dz = sa.pos[2] - sb.pos[2];
        const rb = (eb.size ? Math.max(eb.size[0], eb.size[2]) : 3.5) / 2 + 1.0;
        if (dx * dx + dz * dz < (ra + rb) * (ra + rb)) {
          // 겹침 발생 → 위치 + 루트 진행도 모두 복원 (장애물 비켜나면 자동 재개)
          sa.pos      = sa.prevPos;
          sa.t        = sa.prevT;
          sa.routeIdx = sa.prevRouteIdx;
          equipMeshes.current[ea.id]?.position.set(sa.pos[0], sa.pos[2], 0);
          break;
        }
      }
    }

    // ── 덤프트럭 작업 사이클 (굴착기 적재 → 반출 → 복귀 반복) ──────
    const LOAD_WAIT  = 4.5;   // 적재 대기 시간 (초)
    const DUMP_WAIT  = 3.0;   // 하역 대기 시간 (초)
    const ARRIVE_R2  = 5.0 * 5.0;  // 도착 판정 반경² (m)

    // 이 프레임의 굴착기 (auto 모드)
    const excavator = equips.find(e => e.type === 'excavator' && e.mode === 'auto');
    const excavSt   = excavator ? equipStateRef.current[excavator.id] : null;
    const excavPos  = excavSt ? excavSt.pos : null;

    equips.forEach(e => {
      if (e.type !== 'dump' || e.mode !== 'auto') return;
      if (e.assignedWbsTaskId) return; // WBS 배정 시 덤프 사이클 스킵
      const st = equipStateRef.current[e.id];
      if (!st) return;

      let dw = dumpWorkRef.current[e.id];

      // ── 헬퍼: dumpPhysRef 갱신 (즉시 적용, dispatch 없음) ──
      const setDumpPhys = (route, speed) => {
        dumpPhysRef.current[e.id] = { route, speed, stopped: false };
        st.routeIdx = 0; st.t = 0;
      };
      const stopDump = () => {
        dumpPhysRef.current[e.id] = { route: null, speed: 0, stopped: true };
      };

      // ── 최초 초기화 ──
      if (!dw) {
        const target = excavPos
          ? (() => {
              const angle = Math.atan2(st.pos[2] - excavPos[2], st.pos[0] - excavPos[0]);
              const dist  = 6 + Math.random() * 2;
              return [excavPos[0] + Math.cos(angle) * dist, 0, excavPos[2] + Math.sin(angle) * dist];
            })()
          : [8, 0, 2];
        setDumpPhys(buildDumpRoute(st.pos, target), 4.0);
        dw = { phase: 'to_excav', timer: 0, arrived: false, dumpZone: null };
        dumpWorkRef.current[e.id] = dw;
        return;
      }

      // ── 대기 단계 (적재 / 하역) ──
      if (dw.phase === 'wait_load' || dw.phase === 'wait_dump') {
        dw.timer += delta;
        const waitTime = dw.phase === 'wait_load' ? LOAD_WAIT : DUMP_WAIT;

        if (dw.timer >= waitTime) {
          dw.timer = 0;
          const pa = playAreaRef.current;

          if (dw.phase === 'wait_load') {
            const ep = excavPos || [0, 0, 0];
            dw.dumpZone = dw.dumpZone || resolveDumpTarget(ep, pa, zonesRef.current);
            setDumpPhys(buildDumpRoute(st.pos, dw.dumpZone), 2.5);
            // 굴착기 속도 복구
            if (excavator) dispatch({ type: 'UPDATE_EQUIPMENT', id: excavator.id, updates: { speed: 0.8 } });
            dw.phase = 'to_dump';
            dw.arrived = false;
          } else {
            const ep = excavPos || [0, 0, 0];
            const angle = Math.atan2(st.pos[2] - ep[2], st.pos[0] - ep[0]);
            const arrivePos = [
              ep[0] + Math.cos(angle) * (6 + Math.random() * 2),
              0,
              ep[2] + Math.sin(angle) * (6 + Math.random() * 2),
            ];
            setDumpPhys(buildDumpRoute(st.pos, arrivePos), 4.5);
            dw.phase = 'to_excav';
            dw.arrived = false;
            dw.dumpZone = null;
          }
        }
        return;
      }

      // ── 이동 단계: 마지막 웨이포인트 도착 감지 ──
      if (!dw.arrived) {
        const dp = dumpPhysRef.current[e.id];
        const route = dp?.route;
        if (!route?.length) return;
        const lastWP = route[route.length - 1];
        const dx = st.pos[0] - lastWP[0];
        const dz = st.pos[2] - lastWP[2];

        if (dx*dx + dz*dz < ARRIVE_R2) {
          dw.arrived = true;
          dw.timer   = 0;
          stopDump(); // 즉시 정차 — dispatch 불필요

          if (dw.phase === 'to_excav') {
            dw.phase = 'wait_load';
            if (excavator) dispatch({ type: 'UPDATE_EQUIPMENT', id: excavator.id, updates: { speed: 0.2 } });
          } else {
            dw.phase = 'wait_dump';
          }
        }
      }
    });

    // 작업자 이동 — GPS 위치 우선, 없으면 BIM footprint 안 랜덤워크
    const bimStructList = structuresRef.current
      .filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0);

    workers.forEach((w, wIdx) => {
      const ws = workerStateRef.current[w.id];
      if (!ws) return;
      // GPS 위치가 있으면 즉시 반영하고 랜덤워크 스킵
      if (w.gpsPos) {
        ws.pos = [w.gpsPos[0], w.gpsPos[1] || 0, w.gpsPos[2]];
        workerMeshes.current[w.id]?.position.set(ws.pos[0], ws.pos[2], 0);
        return;
      }

      // WBS 배정 작업 위치 이동
      if (ws.wbsTarget) {
        const tx = ws.wbsTarget[0], tz = ws.wbsTarget[2];
        const dx = tx - ws.pos[0], dz = tz - ws.pos[2];
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist > 3.5) {
          // 목적지까지 이동
          const spd = 1.8 * delta;
          ws.pos = [ws.pos[0] + (dx/dist)*spd, 0, ws.pos[2] + (dz/dist)*spd];
          workerMeshes.current[w.id]?.position.set(ws.pos[0], ws.pos[2], 0);
          return;
        }
        // 목적지 도달 → 주변 반경 2m 내 랜덤워크
        ws.dirTimer = (ws.dirTimer || 0) + delta;
        if (!ws.dir || ws.dirTimer > 2.0) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * 2;
          const localTx = tx + Math.cos(angle)*r, localTz = tz + Math.sin(angle)*r;
          const ldx = localTx - ws.pos[0], ldz = localTz - ws.pos[2];
          const ll  = Math.sqrt(ldx*ldx + ldz*ldz) || 1;
          ws.dir = [ldx/ll, ldz/ll]; ws.dirTimer = 0;
        }
        ws.pos = [ws.pos[0] + ws.dir[0]*0.9*delta, 0, ws.pos[2] + ws.dir[1]*0.9*delta];
        workerMeshes.current[w.id]?.position.set(ws.pos[0], ws.pos[2], 0);
        return;
      }

      ws.dirTimer = (ws.dirTimer || 0) + delta;
      if (!ws.dir || ws.dirTimer > 2.5) {
        if (bimStructList.length > 0) {
          const assigned = bimStructList[wIdx % bimStructList.length];
          const b  = computeStructureBounds(assigned);
          const bW = b.maxX - b.minX, bD = b.maxZ - b.minZ;
          const wTot = workers.length || 1;
          const wC   = Math.max(1, Math.ceil(Math.sqrt(wTot)));
          const wR   = Math.max(1, Math.ceil(wTot / wC));
          const col  = wIdx % wC, row = Math.floor(wIdx / wC) % wR;
          const cW   = bW / wC, cD = bD / wR;
          // 자신의 격자 구역 안에서만 목표점 선택
          const tx = b.minX + cW * col + (0.1 + Math.random() * 0.8) * cW;
          const tz = b.minZ + cD * row + (0.1 + Math.random() * 0.8) * cD;
          const dx = tx - ws.pos[0], dz = tz - ws.pos[2];
          const len = Math.sqrt(dx * dx + dz * dz) || 1;
          ws.dir = [dx / len, dz / len];
        } else {
          const angle = Math.random() * Math.PI * 2;
          ws.dir = [Math.cos(angle), Math.sin(angle)];
        }
        ws.dirTimer = 0;
      }
      const pa = playAreaRef.current;
      ws.pos = [
        Math.max(pa.minX, Math.min(pa.maxX, ws.pos[0] + ws.dir[0] * 1.2 * delta)),
        0,
        Math.max(pa.minZ, Math.min(pa.maxZ, ws.pos[2] + ws.dir[1] * 1.2 * delta)),
      ];
      workerMeshes.current[w.id]?.position.set(ws.pos[0], ws.pos[2], 0);
    });

    // 충돌·구역 감지 — workerStatusesRef 로 비교 (stale closure 없음)
    let changed = false;
    const newStatuses = {};
    workers.forEach(w => {
      const ws = workerStateRef.current[w.id];
      if (!ws) return;
      let st = w.gear ? 'normal' : 'no_gear';

      for (const z of zones) {
        if (inZone(ws.pos, z)) {
          st = 'danger_zone';
          throttledCall(throttleMap.current, `zone_${z.id}_${w.id}`, 5000, () => {
            dispatch({ type: 'LOG_EVENT', event: { type: 'zone_violation', severity: 'warning',
              description: tRef.current('evtZoneEnter', { worker: w.name, zone: z.name }) } });
          });
          break;
        }
      }
      if (st === 'normal' || st === 'no_gear') {
        for (const e of equips) {
          const es = equipStateRef.current[e.id];
          if (!es) continue;
          const ddx = ws.pos[0] - es.pos[0], ddz = ws.pos[2] - es.pos[2];
          if (ddx * ddx + ddz * ddz < 36) {
            st = 'collision_risk';
            throttledCall(throttleMap.current, `coll_${e.id}_${w.id}`, 5000, () => {
              dispatch({ type: 'LOG_EVENT', event: { type: 'collision_risk', severity: 'critical',
                description: tRef.current('evtCollision', { worker: w.name, equip: e.name }) } });
            });
            break;
          }
        }
      }
      if (!w.gear) {
        throttledCall(throttleMap.current, `gear_${w.id}`, 12000, () => {
          dispatch({ type: 'LOG_EVENT', event: { type: 'no_gear', severity: 'warning',
            description: tRef.current('evtNoGear', { worker: w.name }) } });
        });
      }

      newStatuses[w.id] = st;
      if (st !== workerStatusesRef.current[w.id]) changed = true;  // ref 비교 → stale 없음
    });

    if (changed) {
      Object.assign(workerStatusesRef.current, newStatuses);
      setStatusTick(n => n + 1);  // 최소한의 리렌더만 유발
    }

    // 자동작업 중 WBS 진행률 누적 (RECALC_INTERVAL_MS마다 공정율 기반으로 증가)
    wbsTickRef.current += delta;
    if (wbsTickRef.current >= RECALC_INTERVAL_MS / 1000) {
      wbsTickRef.current = 0;
      const activeEquip   = equips.filter(e => e.mode !== 'standby');
      const unassignEquip = activeEquip.filter(e => !e.assignedWbsTaskId);

      wbsTasksRef.current.forEach(task => {
        if ((task.progress || 0) >= 100) return;
        if (typeof task.notes !== 'string' || !/^BIM:[^:]+:[^:]+/.test(task.notes)) return;
        const elementType = task.notes.split(':')[2];

        // 이 태스크에 배정된 장비·작업자
        const assignedEquip   = activeEquip.filter(e => e.assignedWbsTaskId === task.taskId);
        const assignedWorkers = workers.filter(w => w.assignedWbsTaskId === task.taskId);

        if (assignedEquip.length > 0 || assignedWorkers.length > 0) {
          // 배정 전용 작업 (2× 속도 부스트)
          const useEq = assignedEquip.length ? assignedEquip : (unassignEquip.length ? unassignEquip : activeEquip);
          const useWk = assignedWorkers.length ? assignedWorkers : workers;
          const { rate, blocked } = calcProgressRate(elementType, useWk, useEq);
          if (blocked || rate <= 0) return;
          dispatch({ type: 'UPDATE_TASK_PROGRESS', taskId: task.taskId, delta: rate * 7.0 });
        } else if (unassignEquip.length > 0) {
          // 비배정 활성 장비로 일반 작업
          const { rate, blocked } = calcProgressRate(elementType, workers, unassignEquip);
          if (blocked || rate <= 0) return;
          dispatch({ type: 'UPDATE_TASK_PROGRESS', taskId: task.taskId, delta: rate * 3.5 });
        }
      });
    }

    // 사이드바용 실시간 좌표 — 150ms마다 dispatch (API 저장 트리거 안 함)
    livePosTimer.current += delta;
    if (livePosTimer.current >= 0.15) {
      livePosTimer.current = 0;
      const wPos = {};
      workers.forEach(w => {
        const ws = workerStateRef.current[w.id];
        if (ws) wPos[w.id] = [...ws.pos];
      });
      const ePos = {};
      equips.forEach(e => {
        const es = equipStateRef.current[e.id];
        if (es) ePos[e.id] = [...es.pos];
      });
      dispatch({ type: 'SET_LIVE_POSITIONS', workers: wPos, equipment: ePos });
    }
  });

  // useMemo → 언어 바뀔 때만 새 객체, 매 렌더 재생성 방지
  const modeLabel = useMemo(
    () => ({ auto: t('modeAuto'), standby: t('modeStandby'), gps: 'GPS' }),
    [t]
  );
  const statusLabel = useMemo(() => ({
    normal:         t('legendNormal'),
    danger_zone:    t('legendHazard'),
    collision_risk: t('legendCollision'),
    no_gear:        t('legendNoGear'),
  }), [t]);

  return (
    <>
      {initWorkers.map(w => (
        <WorkerItem
          key={w.id}
          worker={w}
          statusKey={workerStatusesRef.current[w.id] || 'normal'}
          statusLabel={statusLabel}
          workerMeshes={workerMeshes}
          isSelected={w.id === selectedWorkerId}
          onSelect={onSelectWorker}
          surveyOriginRef={surveyOriginRef}
        />
      ))}
      {initEquip.map(e => (
        <EquipItem
          key={e.id}
          equip={e}
          isSelected={e.id === selectedEquipId}
          modeLabel={modeLabel}
          equipStateRef={equipStateRef}
          equipMeshes={equipMeshes}
          onSelect={onSelectEquip}
          surveyOriginRef={surveyOriginRef}
        />
      ))}
    </>
  );
}

// ── 측량 기준점 마커 ──────────────────────────────────────────────
function SurveyOriginMarker({ origin }) {
  const t = useT('integrationProject');
  if (!origin) return null;
  return (
    <group position={[0, 0, 0]}>
      {/* 기준점 구 */}
      <mesh position={[0, 0, 0.18]}>
        <sphereGeometry args={[0.18, 10, 10]} />
        <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.7} />
      </mesh>
      {/* X축 막대 (빨강) — Z-up: X=동서 */}
      <mesh position={[1.2, 0, 0.05]}>
        <boxGeometry args={[2.4, 0.05, 0.05]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
      {/* Y축 막대 (파랑) — Z-up: Y=남북 */}
      <mesh position={[0, 1.2, 0.05]}>
        <boxGeometry args={[0.05, 2.4, 0.05]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <Html center distanceFactor={32} position={[0, 0, 0.9]}>
        <div style={{
          background: '#1a1500dd', color: '#facc15',
          padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
          border: '1px solid #facc1588', whiteSpace: 'nowrap', pointerEvents: 'none',
          lineHeight: 1.6,
        }}>
          📍 {origin.label || t('surveyDefaultLabel')}
          <br />
          <span style={{ fontSize: 8, color: '#a09060' }}>
            X:{origin.x.toFixed(2)} Y:{origin.y.toFixed(2)} Z:{origin.z.toFixed(2)}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── 현장 카메라 마커 ──────────────────────────────────────────────
function CameraMarkers() {
  const { cameras } = useIntegration();
  if (!cameras?.length) return null;
  return (
    <>
      {cameras.filter(c => c.active).map(cam => {
        const x = Number(cam.worldX) || 0;
        const y = Number(cam.worldY) || 6;  // Z-up: worldY=height
        const z = Number(cam.worldZ) || 0;  // Z-up: worldZ=north(Three.js Y)
        const yawRad = ((Number(cam.yaw) || 0) * Math.PI) / 180;
        const fovH   = Number(cam.fovH) || 90;
        const range  = 15;
        const halfFov = (fovH / 2) * Math.PI / 180;

        // FOV 양쪽 가이드 선 — Z-up: 수평은 XY 평면
        const lx = x + Math.sin(yawRad - halfFov) * range;
        const ly = z + Math.cos(yawRad - halfFov) * range;
        const rx = x + Math.sin(yawRad + halfFov) * range;
        const ry = z + Math.cos(yawRad + halfFov) * range;

        const lineGeo = (x1, y1, x2, y2) => {
          const pts = [new THREE.Vector3(x1, y1, y), new THREE.Vector3(x2, y2, y)];
          return new THREE.BufferGeometry().setFromPoints(pts);
        };

        return (
          <group key={cam.cameraId}>
            {/* 카메라 본체 — Z-up: [east, north, height] */}
            <mesh position={[x, z, y]}>
              <boxGeometry args={[0.4, 0.25, 0.25]} />
              <meshStandardMaterial color="#60a5fa" emissive="#1e40af" emissiveIntensity={0.5} />
            </mesh>
            {/* 마운트 기둥 — Z-up: height=Y, 기둥은 Z축 방향 */}
            <mesh position={[x, z, y / 2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, y, 6]} />
              <meshStandardMaterial color="#374151" />
            </mesh>
            {/* FOV 가이드 선 */}
            <line geometry={lineGeo(x, z, lx, ly)}>
              <lineBasicMaterial color="#3b82f6" transparent opacity={0.35} />
            </line>
            <line geometry={lineGeo(x, z, rx, ry)}>
              <lineBasicMaterial color="#3b82f6" transparent opacity={0.35} />
            </line>
            <line geometry={lineGeo(lx, ly, rx, ry)}>
              <lineBasicMaterial color="#3b82f6" transparent opacity={0.20} />
            </line>
            {/* 레이블 */}
            <Html center distanceFactor={30} position={[x, z, y + 0.6]}>
              <div style={{
                background: '#060f1add', color: '#60a5fa', fontSize: 8,
                padding: '1px 5px', borderRadius: 3, border: '1px solid #1e3a5f',
                whiteSpace: 'nowrap', pointerEvents: 'none', fontWeight: 700,
              }}>
                📷 {cam.name}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

// ── 씬 내부 ─────────────────────────────────────────────────────
function SceneInner() {
  const { dangerZones, simulationRunning, terrain, selectedZoneId, surveyOrigin } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const selectedZoneIdRef = useRef(selectedZoneId);
  useEffect(() => { selectedZoneIdRef.current = selectedZoneId; }, [selectedZoneId]);

  const onSelectZone = useCallback((id) => {
    const cur = selectedZoneIdRef.current;
    dispatch({ type: 'SELECT_ZONE',      id: cur === id ? null : id });
    dispatch({ type: 'SELECT_WORKER',    id: null });
    dispatch({ type: 'SELECT_EQUIPMENT', id: null });
  }, [dispatch]);

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[30, 40, 20]} intensity={1.1} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <directionalLight position={[-15, 10, -10]} intensity={0.3} />

      {/* 드론 지형 텍스처 */}
      <TerrainLayer />

      {/* 그리드 — z-up 씬: 기본 XZ 평면을 XY 평면(지면)으로 90° 회전 */}
      <Grid
        args={[80, 80]}
        rotation={[-Math.PI / 2, 0, 0]}
        cellSize={1}
        cellThickness={0.3}
        cellColor={terrain ? '#ffffff' : '#1a3a22'}
        sectionSize={5}
        sectionThickness={0.6}
        sectionColor={terrain ? '#ffffff' : '#1e4a2a'}
        fadeDistance={90}
        fadeStrength={1}
        infiniteGrid
        renderOrder={1}
      />

      {/* 위험구역 */}
      {dangerZones.map(z => (
        <DangerZoneMarker
          key={z.id}
          zone={z}
          isSelected={z.id === selectedZoneId}
          onSelect={onSelectZone}
          surveyOrigin={surveyOrigin}
        />
      ))}

      {/* linked BIM (project_meta.bimProjectId) */}
      <LinkedBimElements />

      {/* 명시적으로 추가된 구조물들 (BIM 프로젝트 or IFC) */}
      <StructuresLayer />

      {/* 작업자·장비 시뮬레이션 */}
      <SimulationManager running={simulationRunning} />

      {/* 측량 기준점 마커 */}
      <SurveyOriginMarker origin={surveyOrigin} />

      {/* 현장 카메라 */}
      <CameraMarkers />

      {/* 원점 축 표시 (X=빨강, Y=초록, Z=파랑) */}
      <axesHelper args={[10]} />

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={5}
        maxDistance={120}
      />

      {/* 우측 하단 방향 기즈모 */}
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport
          axisColors={['#ef4444', '#22c55e', '#3b82f6']}
          labelColor="#ffffff"
        />
      </GizmoHelper>
    </>
  );
}

export default function IntegrationScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [30, -30, 25], up: [0, 0, 1], fov: 50 }}
      style={{ background: '#060f18', width: '100%', height: '100%' }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
    >
      <SceneInner />
    </Canvas>
  );
}
