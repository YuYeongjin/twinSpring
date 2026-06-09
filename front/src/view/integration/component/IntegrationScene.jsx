import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback, memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { BimElement, getBaseColor } from '../../bim/element/BimElement';
import { useT } from '../../../i18n/LanguageContext';

// ── 상수 ────────────────────────────────────────────────────────
const STATUS_COLOR = {
  normal:         '#22c55e',
  danger_zone:    '#f59e0b',
  collision_risk: '#ef4444',
  no_gear:        '#a855f7',
};
const EQUIP_COLOR = { excavator: '#f97316', dump: '#3b82f6', crane: '#eab308' };
const EQUIP_ICON  = { excavator: '🚜',      dump: '🚛',       crane: '🏗'  };
const ZONE_COLOR  = { excavation: '#ef4444', restricted: '#f97316' };

// ── 헬퍼 ─────────────────────────────────────────────────────────
function inZone(pos, zone) {
  if (!zone.active) return false;
  const [cx,,cz] = zone.center;
  const [hx,,hz] = zone.halfSize;
  return Math.abs(pos[0] - cx) < hx && Math.abs(pos[2] - cz) < hz;
}

function throttledCall(map, key, ms, fn) {
  const now = Date.now();
  if (!map[key] || now - map[key] > ms) { map[key] = now; fn(); }
}

// ── 드론 지형 레이어 ─────────────────────────────────────────────
function TerrainLayer() {
  const { terrain } = useIntegration();
  const [texture, setTexture] = useState(null);
  const prevUrl = useRef(null);

  useEffect(() => {
    if (!terrain?.imageDataUrl) { setTexture(t => { t?.dispose(); return null; }); return; }
    if (terrain.imageDataUrl === prevUrl.current) return;
    prevUrl.current = terrain.imageDataUrl;
    const loader = new THREE.TextureLoader();
    loader.load(terrain.imageDataUrl, tex => {
      setTexture(prev => { prev?.dispose(); return tex; });
    });
  }, [terrain?.imageDataUrl]);

  if (!terrain || !texture) return null;

  const w = terrain.width  || 80;
  const h = terrain.height || 80;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow>
      <planeGeometry args={[w, h, 1, 1]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} side={2} />
    </mesh>
  );
}

// BIM Y-up → Three.js Y-up 좌표 변환
// BimElement 내부: Three.js Y(up) = positionZ + sizeZ/2, Three.js Z = positionY
// 이 BIM 데이터:  positionY = 높이, positionZ = 깊이
// → positionY/Z 와 sizeY/Z 를 교환해서 BimElement 에 전달
function toIntegrationCoords(el) {
  const pY = Number(el.positionY) || 0;
  const pZ = Number(el.positionZ) || 0;
  const sY = Number(el.sizeY)     || 0.1;
  const sZ = Number(el.sizeZ)     || 0.1;
  return {
    ...el,
    positionZ: pY,   // BIM 높이 → Three.js Y(up)
    positionY: pZ,   // BIM 깊이 → Three.js Z(depth)
    sizeZ:     sY,
    sizeY:     sZ,
  };
}

// ── WBS 태스크에서 BIM 공정율 맵 빌드 ────────────────────────────
// 반환: { "bimProjectId:IfcColumn": 42, "bimProjectId:IfcSlab": 100, ... }
function buildProgressMap(wbsTasks) {
  const map = {};
  wbsTasks.forEach(t => {
    if (!t.notes) return;
    const m = t.notes.match(/^BIM:([^:]+):([^:]+)/);
    if (m) map[`${m[1]}:${m[2]}`] = Math.min(100, Math.max(0, t.progress || 0));
  });
  return map;
}

// ── 아래→위 공정율 채우기 렌더러 ──────────────────────────────────
// localPosition: Three.js 로컬 좌표 [x, y, z] (그룹 내 위치, y = 중심)
// size:          Three.js [width, height, depth]
// progress:      0-100 (WBS 공정율)
// offsetY:       소속 <group>의 world Y 오프셋 (clip plane은 world 좌표계)
function BimProgressFill({ localPosition, size, elementType, progress, offsetY = 0 }) {
  const worldYBottom = localPosition[1] - size[1] / 2 + offsetY;
  const worldHeight  = size[1];

  // Three.js Plane(법선, 상수): -y + constant >= 0 → y <= constant 인 영역만 표시
  // 즉 fillLevel 아래(바닥→진도만큼)만 렌더
  const planeRef    = useRef(null);
  const currentPRef = useRef(progress);
  const targetPRef  = useRef(progress);
  const wYBRef      = useRef(worldYBottom);

  // 첫 마운트 시 clip plane 생성
  if (!planeRef.current) {
    const initLevel = worldYBottom + (progress / 100) * worldHeight;
    planeRef.current = new THREE.Plane(new THREE.Vector3(0, -1, 0), initLevel);
  }

  useEffect(() => { targetPRef.current  = progress;     }, [progress]);
  useEffect(() => { wYBRef.current      = worldYBottom; }, [worldYBottom]);

  // 매 프레임: 현재 진도를 목표값으로 부드럽게 보간 → clip plane 이동
  useFrame((_, delta) => {
    const diff = targetPRef.current - currentPRef.current;
    if (Math.abs(diff) < 0.01) return;
    currentPRef.current += diff * Math.min(1, delta * 2.0);
    planeRef.current.constant = wYBRef.current + (currentPRef.current / 100) * worldHeight;
  });

  const baseColor = getBaseColor(elementType) || '#334155';
  const p = progress;
  const fillColor = p >= 100 ? '#60a5fa'   // 완료 — 파랑
    : p >= 75    ? '#22c55e'               // 75%+ — 녹색
    : p >= 40    ? '#eab308'               // 40%+ — 노랑
    : p >  0     ? '#f97316'               // 진행 — 주황
    : '#334155';                           // 미착수 — 회색

  return (
    <group>
      {/* 고스트: 전체 형상 반투명 윤곽 (항상 표시) */}
      <mesh position={localPosition} castShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={baseColor} transparent opacity={0.07} depthWrite={false} />
      </mesh>
      {/* 외곽선 */}
      <lineSegments position={localPosition}>
        <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
        <lineBasicMaterial color={baseColor} transparent opacity={0.28} />
      </lineSegments>
      {/* 채움: clip plane이 진도에 따라 아래→위로 이동 */}
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
    </group>
  );
}

// ── 구조물 레이어 (여러 BIM/IFC 구조물) ──────────────────────────
function StructuresLayer() {
  const { structures, wbsTasks } = useIntegration();

  const progressMap = useMemo(() => buildProgressMap(wbsTasks), [wbsTasks]);

  if (!structures?.length) return null;

  return (
    <>
      {structures.filter(s => s.visible !== false).map(s => {
        const elems = s.elements;
        if (!elems || elems.length === 0) return null;
        const offset  = s.offset || [0, 0, 0];
        const offsetY = offset[1];
        const isBim   = s.type === 'bim';

        return (
          <group key={s.id} position={offset}>
            {elems.map(el => {
              if (isBim) {
                // BIM 구조물: 공정율 채우기 렌더
                const cv = toIntegrationCoords(el);
                const pX = Number(cv.positionX) || 0;
                const pY = Number(cv.positionY) || 0;
                const pZ = Number(cv.positionZ) || 0;
                const sX = Number(cv.sizeX)     || 0.1;
                const sY = Number(cv.sizeY)     || 0.1;
                const sZ = Number(cv.sizeZ)     || 0.1;
                return (
                  <BimProgressFill
                    key={el.elementId}
                    localPosition={[pX, pZ + sZ / 2, pY]}
                    size={[sX, sZ, sY]}
                    elementType={el.elementType}
                    progress={progressMap[`${s.bimProjectId}:${el.elementType}`] || 0}
                    offsetY={offsetY}
                  />
                );
              }
              // IFC 구조물: 기존 BimElement 그대로 유지
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

  if (!bimElements?.length) return null;
  return (
    <>
      {bimElements.map(el => {
        const pY = Number(el.positionY) || 0;
        const sY = Number(el.sizeY) || 3;
        return (
          <BimProgressFill
            key={el.elementId}
            localPosition={[el.positionX || 0, pY + sY / 2, el.positionZ || 0]}
            size={[el.sizeX || 1, sY, el.sizeZ || 1]}
            elementType={el.elementType}
            progress={progressMap[`${bimProjectId}:${el.elementType}`] || 0}
            offsetY={0}
          />
        );
      })}
    </>
  );
}

// ── 위험구역 마커 ────────────────────────────────────────────────
function DangerZoneMarker({ zone, isSelected, onSelect }) {
  const [hx, hy, hz] = zone.halfSize;
  const color = ZONE_COLOR[zone.type] || '#ef4444';
  const boxGeo = useMemo(() => new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), [hx, hy, hz]);
  if (!zone.active) return null;

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
      <Html center position={[0, hy + 0.6, 0]} distanceFactor={35}>
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
    </group>
  );
}

// ── 장비 모드 색 (정적 상수 — 렌더마다 새 객체 생성 방지) ────────
const EQUIP_MODE_COLOR = { auto: '#22c55e', standby: '#f59e0b', gps: '#a78bfa' };

// ── 작업자 메시 ─────────────────────────────────────────────────
// statusKey·isSelected가 바뀔 때만 리렌더
const WorkerItem = memo(function WorkerItem({ worker, statusKey, statusLabel, workerMeshes, isSelected, onSelect }) {
  const groupRef = useRef(null);

  useLayoutEffect(() => {
    workerMeshes.current[worker.id] = groupRef.current;
    if (groupRef.current)
      groupRef.current.position.set(...(worker.initialPos || [0, 0, 0]));
    return () => { workerMeshes.current[worker.id] = null; };
  }, []); // eslint-disable-line

  const color    = STATUS_COLOR[statusKey] || STATUS_COLOR.normal;
  const emissive = isSelected ? '#ffffff' : '#000000';
  const emissiveI = isSelected ? 0.22 : 0;
  const hatColor = worker.gear ? '#fbbf24' : '#6b7280';

  return (
    <group ref={groupRef}>
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

      <Html center distanceFactor={30} position={[0, 2.15, 0]}>
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
const EquipItem = memo(function EquipItem({ equip, isSelected, modeLabel, equipStateRef, equipMeshes, onSelect }) {
  const groupRef = useRef(null);

  useLayoutEffect(() => {
    equipMeshes.current[equip.id] = groupRef.current;
    if (groupRef.current) {
      const pos = equipStateRef.current[equip.id]?.pos || equip.initialPos || [0, 0, 0];
      groupRef.current.position.set(...pos);
    }
    return () => { equipMeshes.current[equip.id] = null; };
  }, []); // eslint-disable-line

  const [bw, bh, bd] = equip.size || [2.8, 2.5, 3.5];
  const color  = EQUIP_COLOR[equip.type] || '#888888';
  const em     = isSelected ? '#ffffff' : '#000000';
  const emI    = isSelected ? 0.18 : 0;
  // 레이블 높이: 크레인은 타워 꼭대기 + 여유
  const labelY = equip.type === 'crane' ? bh + 1.4 : bh + 1.1;

  const shapeProps = { bw, bh, bd, color, em, emI };

  return (
    <group ref={groupRef}>
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

      <Html center distanceFactor={30} position={[0, labelY, 0]}>
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
    </group>
  );
});

// ── 시뮬레이션 관리자 ─────────────────────────────────────────────
function SimulationManager({ running }) {
  const t = useT('integrationProject');
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const { workers: initWorkers, equipment: initEquip, dangerZones, selectedEquipId, selectedWorkerId } = useIntegration();
  const dispatch = useIntegrationDispatch();

  // stale-closure 없이 선택 상태를 읽기 위한 ref
  const selectedEquipIdRef  = useRef(selectedEquipId);
  const selectedWorkerIdRef = useRef(selectedWorkerId);
  useEffect(() => { selectedEquipIdRef.current  = selectedEquipId;  }, [selectedEquipId]);
  useEffect(() => { selectedWorkerIdRef.current = selectedWorkerId; }, [selectedWorkerId]);

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

  const equipStateRef = useRef({});
  const workerStateRef = useRef({});
  const equipMeshes   = useRef({});
  const workerMeshes  = useRef({});
  const throttleMap   = useRef({});
  const wbsTickRef    = useRef(0);

  // 장비 추가/제거 동기화
  useEffect(() => {
    const existingIds = new Set(Object.keys(equipStateRef.current));
    const storeIds    = new Set(initEquip.map(e => e.id));
    initEquip.forEach(e => {
      if (!existingIds.has(e.id))
        equipStateRef.current[e.id] = { pos: [...(e.initialPos || [0, 0, 0])], routeIdx: 0, t: 0 };
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
          workerMeshes.current[w.id]?.position.set(...newPos);
        }
      }
    });
    existingIds.forEach(id => { if (!storeIds.has(id)) delete workerStateRef.current[id]; });
  }, [initWorkers]);

  const zonesRef  = useRef(dangerZones);
  useEffect(() => { zonesRef.current = dangerZones; }, [dangerZones]);
  const equipRef  = useRef(initEquip);
  useEffect(() => { equipRef.current = initEquip; }, [initEquip]);
  const workerRef = useRef(initWorkers);
  useEffect(() => { workerRef.current = initWorkers; }, [initWorkers]);

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

    // 장비 이동
    equips.forEach(e => {
      const st = equipStateRef.current[e.id];
      if (!st) return;
      if (e.mode === 'gps' && e.gpsPos) {
        st.pos = [e.gpsPos[0], e.gpsPos[1] || 0, e.gpsPos[2]];
        equipMeshes.current[e.id]?.position.set(...st.pos);
      } else if (e.mode === 'auto' && e.speed > 0 && e.route?.length >= 2) {
        const n = e.route.length;
        // 현재 구간 길이 계산
        let fi = st.routeIdx % n;
        let ti = (fi + 1) % n;
        let fr = e.route[fi], to = e.route[ti];
        let dx = to[0] - fr[0], dz = to[2] - fr[2];
        let len = Math.sqrt(dx * dx + dz * dz);

        // 길이가 0인 구간(중복 포인트) 은 건너뜀
        if (len < 0.01) {
          st.routeIdx = ti;
          fi = ti; ti = (ti + 1) % n;
          fr = e.route[fi]; to = e.route[ti];
          dx = to[0] - fr[0]; dz = to[2] - fr[2];
          len = Math.sqrt(dx * dx + dz * dz) || 0.001;
        }

        st.t += (e.speed * delta) / len;

        // t >= 1 을 while 로 처리 — 한 프레임에 여러 구간 통과해도 안전
        while (st.t >= 1) {
          st.t -= 1;
          st.routeIdx = (st.routeIdx + 1) % n;
          // 다음 구간도 0-길이면 건너뜀
          const nfi = st.routeIdx, nti = (nfi + 1) % n;
          const nlen = Math.hypot(
            e.route[nti][0] - e.route[nfi][0],
            e.route[nti][2] - e.route[nfi][2]
          );
          if (nlen < 0.01) { st.routeIdx = nti; st.t = 0; break; }
        }

        const f2 = e.route[st.routeIdx % n];
        const t2 = e.route[(st.routeIdx + 1) % n];
        st.pos = [
          f2[0] + (t2[0] - f2[0]) * st.t,
          f2[1] || 0,
          f2[2] + (t2[2] - f2[2]) * st.t,
        ];
        equipMeshes.current[e.id]?.position.set(...st.pos);
      }
    });

    // 작업자 랜덤워크 — 매 프레임 delta 기반으로 부드럽게 이동
    // 방향은 ~2초마다 랜덤 변경 (순간이동 없음)
    workers.forEach(w => {
      const ws = workerStateRef.current[w.id];
      if (!ws) return;
      ws.dirTimer = (ws.dirTimer || 0) + delta;
      if (!ws.dir || ws.dirTimer > 2.0) {
        const angle = Math.random() * Math.PI * 2;
        ws.dir = [Math.cos(angle), Math.sin(angle)];
        ws.dirTimer = 0;
      }
      ws.pos = [
        Math.max(-28, Math.min(28, ws.pos[0] + ws.dir[0] * 1.2 * delta)),
        0,
        Math.max(-28, Math.min(28, ws.pos[2] + ws.dir[1] * 1.2 * delta)),
      ];
      workerMeshes.current[w.id]?.position.set(...ws.pos);
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

    // WBS 공정률 자동 증가 (60초마다)
    wbsTickRef.current += delta;
    if (wbsTickRef.current > 60) {
      wbsTickRef.current = 0;
      const active = equips.filter(e => e.mode === 'auto' && e.speed > 0).length;
      if (active > 0)
        dispatch({ type: 'UPDATE_TASK_PROGRESS', delta: 0.05 * active, taskIndex: Math.floor(Math.random() * 4) });
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
        />
      ))}
    </>
  );
}

// ── 측량 기준점 마커 ──────────────────────────────────────────────
function SurveyOriginMarker({ origin }) {
  if (!origin) return null;
  return (
    <group position={[0, 0, 0]}>
      {/* 기준점 구 */}
      <mesh position={[0, 0.18, 0]}>
        <sphereGeometry args={[0.18, 10, 10]} />
        <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.7} />
      </mesh>
      {/* X축 막대 (빨강) */}
      <mesh position={[1.2, 0.05, 0]}>
        <boxGeometry args={[2.4, 0.05, 0.05]} />
        <meshStandardMaterial color="#ef4444" />
      </mesh>
      {/* Z축 막대 (파랑) */}
      <mesh position={[0, 0.05, 1.2]}>
        <boxGeometry args={[0.05, 0.05, 2.4]} />
        <meshStandardMaterial color="#3b82f6" />
      </mesh>
      <Html center distanceFactor={32} position={[0, 0.9, 0]}>
        <div style={{
          background: '#1a1500dd', color: '#facc15',
          padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
          border: '1px solid #facc1588', whiteSpace: 'nowrap', pointerEvents: 'none',
          lineHeight: 1.6,
        }}>
          📍 {origin.label || '기준점'}
          <br />
          <span style={{ fontSize: 8, color: '#a09060' }}>
            X:{origin.x.toFixed(2)} Y:{origin.y.toFixed(2)} Z:{origin.z.toFixed(2)}
          </span>
        </div>
      </Html>
    </group>
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

      {/* 그리드 (지형 위에 얇게 오버레이) */}
      <Grid
        args={[80, 80]}
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
      camera={{ position: [30, 25, 30], fov: 50 }}
      style={{ background: '#060f18', width: '100%', height: '100%' }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
    >
      <SceneInner />
    </Canvas>
  );
}
