import { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { BimElement } from '../../bim/element/BimElement';

// ── 상수 ────────────────────────────────────────────────────────
const STATUS_COLOR = {
  normal:         '#22c55e',
  danger_zone:    '#f59e0b',
  collision_risk: '#ef4444',
  no_gear:        '#a855f7',
};
const STATUS_LABEL = {
  normal:         '정상',
  danger_zone:    '위험구역',
  collision_risk: '충돌위험',
  no_gear:        '장비미착',
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
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} />
    </mesh>
  );
}

// ── 구조물 레이어 (여러 BIM/IFC 구조물) ──────────────────────────
function StructuresLayer() {
  const { structures } = useIntegration();
  if (!structures?.length) return null;

  return (
    <>
      {structures.filter(s => s.visible !== false).map(s => {
        const elems = s.elements;
        if (!elems || elems.length === 0) return null;
        return (
          <group key={s.id} position={s.offset || [0, 0, 0]}>
            {elems.map(el => (
              <BimElement key={el.elementId} element={el} />
            ))}
          </group>
        );
      })}
    </>
  );
}

// ── 기존 BIM 연결 부재 ──────────────────────────────────────────
function LinkedBimElements() {
  const { bimElements } = useIntegration();
  if (!bimElements?.length) return null;
  return (
    <>
      {bimElements.map(el => (
        <mesh
          key={el.elementId}
          position={[el.positionX || 0, (el.positionZ || 0) + (el.sizeZ || 3) / 2, el.positionY || 0]}
          castShadow receiveShadow
        >
          <boxGeometry args={[el.sizeX || 1, el.sizeZ || 3, el.sizeY || 1]} />
          <meshStandardMaterial color="#334155" transparent opacity={0.45} />
        </mesh>
      ))}
    </>
  );
}

// ── 위험구역 마커 ────────────────────────────────────────────────
function DangerZoneMarker({ zone }) {
  const [hx, hy, hz] = zone.halfSize;
  const color = ZONE_COLOR[zone.type] || '#ef4444';
  const boxGeo = useMemo(() => new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), [hx, hy, hz]);
  if (!zone.active) return null;

  return (
    <group position={zone.center}>
      <mesh>
        <boxGeometry args={[hx * 2, hy * 2, hz * 2]} />
        <meshStandardMaterial color={color} transparent opacity={0.10} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[boxGeo]} />
        <lineBasicMaterial color={color} transparent opacity={0.8} />
      </lineSegments>
      <Html center position={[0, hy + 0.6, 0]} distanceFactor={35}>
        <div style={{
          background: '#1a0000cc', color, padding: '2px 8px', borderRadius: 4,
          fontSize: 10, border: `1px solid ${color}`, whiteSpace: 'nowrap',
          pointerEvents: 'none', fontWeight: 700,
        }}>
          ⚠ {zone.name}
        </div>
      </Html>
    </group>
  );
}

// ── 시뮬레이션 관리자 ─────────────────────────────────────────────
function SimulationManager({ running }) {
  const { workers: initWorkers, equipment: initEquip, dangerZones } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const simRef = useRef(null);
  if (!simRef.current) {
    simRef.current = {
      workers:   initWorkers.map(w => ({ ...w, pos: [...(w.initialPos || [0, 0, 0])] })),
      equipment: initEquip.map(e => ({ ...e, pos: [...(e.initialPos || [0, 0, 0])], routeIdx: 0, t: 0 })),
    };
  }

  const zonesRef = useRef(dangerZones);
  useEffect(() => { zonesRef.current = dangerZones; }, [dangerZones]);

  const workerRefs    = useRef([]);
  const equipRefs     = useRef([]);
  const throttleMap   = useRef({});
  const wbsTickRef    = useRef(0);
  const frameCounter  = useRef(0);

  const [workerStatuses, setWorkerStatuses] = useState(() =>
    initWorkers.map(w => (w.gear ? 'normal' : 'no_gear'))
  );

  useFrame((_, delta) => {
    if (!running) return;
    frameCounter.current++;

    const { workers, equipment } = simRef.current;
    const zones = zonesRef.current;

    // 장비 경로 이동
    equipment.forEach((e, i) => {
      if (e.speed === 0 || e.route.length < 2) return;
      const fi = e.routeIdx % e.route.length;
      const ti = (e.routeIdx + 1) % e.route.length;
      const fr = e.route[fi], to = e.route[ti];
      const dx = to[0] - fr[0], dz = to[2] - fr[2];
      const len = Math.sqrt(dx * dx + dz * dz) || 0.001;
      e.t += (e.speed * delta) / len;
      if (e.t >= 1) { e.t -= 1; e.routeIdx = ti; }
      const f2 = e.route[e.routeIdx % e.route.length];
      const t2 = e.route[(e.routeIdx + 1) % e.route.length];
      e.pos = [f2[0] + (t2[0] - f2[0]) * e.t, f2[1] || 0, f2[2] + (t2[2] - f2[2]) * e.t];
      if (equipRefs.current[i]) equipRefs.current[i].position.set(...e.pos);
    });

    // 작업자 랜덤워크 (~30프레임마다)
    if (frameCounter.current % 30 === 0) {
      const STEP = 0.5;
      workers.forEach((w, i) => {
        w.pos = [
          Math.max(-28, Math.min(28, w.pos[0] + (Math.random() - 0.5) * STEP)),
          0,
          Math.max(-28, Math.min(28, w.pos[2] + (Math.random() - 0.5) * STEP)),
        ];
        if (workerRefs.current[i]) workerRefs.current[i].position.set(...w.pos);
      });
    }

    // 충돌·구역 감지
    let changed = false;
    const newStatuses = workers.map((w, wi) => {
      let st = w.gear ? 'normal' : 'no_gear';

      for (const z of zones) {
        if (inZone(w.pos, z)) {
          st = 'danger_zone';
          throttledCall(throttleMap.current, `zone_${z.id}_${w.id}`, 5000, () => {
            dispatch({ type: 'LOG_EVENT', event: { type: 'zone_violation', severity: 'warning',
              description: `${w.name}이(가) "${z.name}"에 진입했습니다` } });
          });
          break;
        }
      }

      if (st === 'normal' || st === 'no_gear') {
        for (const e of equipment) {
          const ddx = w.pos[0] - e.pos[0], ddz = w.pos[2] - e.pos[2];
          if (ddx * ddx + ddz * ddz < 36) {
            st = 'collision_risk';
            throttledCall(throttleMap.current, `coll_${e.id}_${w.id}`, 5000, () => {
              dispatch({ type: 'LOG_EVENT', event: { type: 'collision_risk', severity: 'critical',
                description: `${w.name}과(와) ${e.name} 충돌 위험 감지!` } });
            });
            break;
          }
        }
      }

      if (!w.gear) {
        throttledCall(throttleMap.current, `gear_${w.id}`, 12000, () => {
          dispatch({ type: 'LOG_EVENT', event: { type: 'no_gear', severity: 'warning',
            description: `${w.name}이(가) 보호장비를 미착용 중입니다` } });
        });
      }

      if (st !== workerStatuses[wi]) changed = true;
      return st;
    });

    if (changed) setWorkerStatuses([...newStatuses]);

    // WBS 공정률 자동 증가 (60초마다)
    wbsTickRef.current += delta;
    if (wbsTickRef.current > 60) {
      wbsTickRef.current = 0;
      const active = equipment.filter(e => e.speed > 0).length;
      if (active > 0) {
        dispatch({ type: 'UPDATE_TASK_PROGRESS', delta: 0.05 * active, taskIndex: Math.floor(Math.random() * 4) });
      }
    }
  });

  return (
    <>
      {simRef.current.workers.map((w, i) => (
        <group key={w.id} ref={el => { workerRefs.current[i] = el; }} position={w.pos}>
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
            <meshStandardMaterial color={STATUS_COLOR[workerStatuses[i]] || STATUS_COLOR.normal} />
          </mesh>
          <Html center distanceFactor={30} position={[0, 2.1, 0]}>
            <div style={{
              background: '#0d1b2acc',
              color: STATUS_COLOR[workerStatuses[i]] || STATUS_COLOR.normal,
              padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
              border: `1px solid ${STATUS_COLOR[workerStatuses[i]] || STATUS_COLOR.normal}`,
              whiteSpace: 'nowrap', pointerEvents: 'none',
            }}>
              👷 {w.name} · {STATUS_LABEL[workerStatuses[i]] || ''}
            </div>
          </Html>
        </group>
      ))}

      {simRef.current.equipment.map((e, i) => {
        const isCrane = e.type === 'crane';
        const bw = isCrane ? 1.5 : 2.8, bh = isCrane ? 9 : 2.5, bd = isCrane ? 1.5 : 3.5;
        const labelY = isCrane ? 10.5 : 3.5;
        return (
          <group key={e.id} ref={el => { equipRefs.current[i] = el; }} position={e.pos}>
            <mesh position={[0, bh / 2, 0]} castShadow>
              <boxGeometry args={[bw, bh, bd]} />
              <meshStandardMaterial color={EQUIP_COLOR[e.type] || '#888888'} />
            </mesh>
            <Html center distanceFactor={30} position={[0, labelY, 0]}>
              <div style={{
                background: '#0d1b2acc',
                color: EQUIP_COLOR[e.type] || '#888888',
                padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                border: `1px solid ${EQUIP_COLOR[e.type] || '#888888'}`,
                whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>
                {EQUIP_ICON[e.type] || '🔧'} {e.name}
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
  const { dangerZones, simulationRunning, terrain } = useIntegration();

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[30, 40, 20]} intensity={1.1} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <directionalLight position={[-15, 10, -10]} intensity={0.3} />

      {/* 드론 지형이 없을 때만 기본 지면 표시 */}
      {!terrain && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#0a1f0f" />
        </mesh>
      )}

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
      {dangerZones.map(z => <DangerZoneMarker key={z.id} zone={z} />)}

      {/* linked BIM (project_meta.bimProjectId) */}
      <LinkedBimElements />

      {/* 명시적으로 추가된 구조물들 (BIM 프로젝트 or IFC) */}
      <StructuresLayer />

      {/* 작업자·장비 시뮬레이션 */}
      <SimulationManager running={simulationRunning} />

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={5}
        maxDistance={120}
      />
    </>
  );
}

export default function IntegrationScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [30, 25, 30], fov: 50 }}
      style={{ background: '#060f18', width: '100%', height: '100%' }}
    >
      <SceneInner />
    </Canvas>
  );
}
