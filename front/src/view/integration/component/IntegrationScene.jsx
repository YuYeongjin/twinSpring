import { useRef, useState, useEffect, useLayoutEffect, useMemo, memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { BimElement } from '../../bim/element/BimElement';
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
              <BimElement key={el.elementId} element={toIntegrationCoords(el)} />
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
      {bimElements.map(el => {
        const pY = Number(el.positionY) || 0;
        const sY = el.sizeY || 3;
        return (
          <mesh
            key={el.elementId}
            position={[
              el.positionX || 0,
              pY + sY / 2,
              el.positionZ || 0,
            ]}
            castShadow receiveShadow
          >
            <boxGeometry args={[el.sizeX || 1, sY, el.sizeZ || 1]} />
            <meshStandardMaterial color="#334155" transparent opacity={0.45} />
          </mesh>
        );
      })}
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

// ── 장비 모드 색 (정적 상수 — 렌더마다 새 객체 생성 방지) ────────
const EQUIP_MODE_COLOR = { auto: '#22c55e', standby: '#f59e0b', gps: '#a78bfa' };

// ── 작업자 메시 ─────────────────────────────────────────────────
// statusKey가 바뀔 때만 리렌더 (다른 작업자 상태 변화 무시)
const WorkerItem = memo(function WorkerItem({ worker, statusKey, statusLabel, workerMeshes }) {
  const groupRef = useRef(null);

  // 마운트 시 공유 meshes 맵에 등록, 언마운트 시 정리
  useLayoutEffect(() => {
    workerMeshes.current[worker.id] = groupRef.current;
    if (groupRef.current)
      groupRef.current.position.set(...(worker.initialPos || [0, 0, 0]));
    return () => { workerMeshes.current[worker.id] = null; };
  }, []); // eslint-disable-line

  const color = STATUS_COLOR[statusKey] || STATUS_COLOR.normal;
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Html center distanceFactor={30} position={[0, 2.1, 0]}>
        <div style={{
          background: '#0d1b2acc', color,
          padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
          border: `1px solid ${color}`, whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          👷 {worker.name} · {statusLabel[statusKey] || ''}
        </div>
      </Html>
    </group>
  );
});

// ── 장비 메시 ────────────────────────────────────────────────────
// 작업자 상태 변화와 완전히 독립 — isSelected·modeLabel 바뀔 때만 리렌더
const EquipItem = memo(function EquipItem({ equip, isSelected, modeLabel, equipStateRef, equipMeshes }) {
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
  const labelY = bh + 1.0;
  const color  = EQUIP_COLOR[equip.type] || '#888888';
  return (
    <group ref={groupRef}>
      <mesh position={[0, bh / 2, 0]} castShadow>
        <boxGeometry args={[bw, bh, bd]} />
        <meshStandardMaterial
          color={color}
          emissive={isSelected ? '#ffffff' : '#000000'}
          emissiveIntensity={isSelected ? 0.15 : 0}
        />
      </mesh>
      {isSelected && (
        <mesh position={[0, bh / 2, 0]}>
          <boxGeometry args={[bw + 0.15, bh + 0.15, bd + 0.15]} />
          <meshStandardMaterial color="#60a5fa" transparent opacity={0.18} wireframe />
        </mesh>
      )}
      <Html center distanceFactor={30} position={[0, labelY, 0]}>
        <div style={{
          background: '#0d1b2acc', color,
          padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
          border: `1px solid ${isSelected ? '#60a5fa' : color}`,
          whiteSpace: 'nowrap', pointerEvents: 'none',
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

  const { workers: initWorkers, equipment: initEquip, dangerZones, selectedEquipId } = useIntegration();
  const dispatch = useIntegrationDispatch();

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

  // 작업자 추가/제거 동기화
  useEffect(() => {
    const existingIds = new Set(Object.keys(workerStateRef.current));
    const storeIds    = new Set(initWorkers.map(w => w.id));
    initWorkers.forEach(w => {
      if (!existingIds.has(w.id))
        workerStateRef.current[w.id] = { pos: [...(w.initialPos || [0, 0, 0])] };
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
        />
      ))}
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
    >
      <SceneInner />
    </Canvas>
  );
}
