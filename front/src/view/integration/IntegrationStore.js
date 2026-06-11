import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';

export const IntegrationCtx      = createContext(null);
export const IntegrationDispatch = createContext(null);

export const useIntegration         = () => useContext(IntegrationCtx);
export const useIntegrationDispatch = () => useContext(IntegrationDispatch);

const MAX_EVENTS = 60;

const DEFAULT_WORKERS = [
  { id: 'w1', name: '작업자 A', initialPos: [5,  0,  3], gear: true,  gpsDeviceId: null, gpsPos: null, assignedWbsTaskId: null },
  { id: 'w2', name: '작업자 B', initialPos: [-3, 0,  8], gear: true,  gpsDeviceId: null, gpsPos: null, assignedWbsTaskId: null },
  { id: 'w3', name: '작업자 C', initialPos: [10, 0, -5], gear: false, gpsDeviceId: null, gpsPos: null, assignedWbsTaskId: null },
];
const DEFAULT_EQUIPMENT = [
  { id: 'e1', type: 'excavator', name: '굴착기-1',  initialPos: [0,0,0],   route: [[0,0,0],[10,0,0],[10,0,10],[0,0,10]], speed: 1.5, mode: 'auto',    size: [2.8,2.5,3.5], gpsDeviceId: null, gpsPos: null, assignedWbsTaskId: null },
  { id: 'e2', type: 'dump',      name: '덤프트럭-1', initialPos: [-8,0,-8], route: [[-8,0,-8],[8,0,-8],[8,0,-2],[-8,0,-2]], speed: 2.5, mode: 'auto',    size: [2.8,2.5,3.5], gpsDeviceId: null, gpsPos: null, assignedWbsTaskId: null },
  { id: 'e3', type: 'crane',     name: '크레인-1',   initialPos: [15,0,5],  route: [[15,0,5],[15,0,-5],[20,0,-5],[20,0,5]], speed: 1.0, mode: 'auto', size: [1.5,9.0,1.5], gpsDeviceId: null, gpsPos: null, assignedWbsTaskId: null },
];
const DEFAULT_ZONES = [
  { id: 'z1', name: '굴착 위험구역', center: [5,  2, 5], halfSize: [4, 4, 4], type: 'excavation', active: true },
  { id: 'z2', name: '접근 금지구역', center: [15, 2, 5], halfSize: [3, 4, 3], type: 'restricted',  active: true },
];

function makeInitial() {
  return {
    projectMeta: null,
    workers:     DEFAULT_WORKERS,
    equipment:   DEFAULT_EQUIPMENT,
    dangerZones: DEFAULT_ZONES,
    events:      [],
    wbsTasks:       [],
    linkedProjects: [],
    bimElements:    [],   // linked BIM project elements (legacy/convenience)

    // ── 신규 ──────────────────────────────────────────────────────
    structures: [],       // { id, name, type:'bim'|'ifc', bimProjectId?, elements:null|[], offset:[0,0,0], visible:true }
    terrain:    null,     // { imageDataUrl, width, height } or null
    cameras:    [],       // { cameraId, name, url, worldX, worldY, worldZ, yaw, fovH, active }

    isLoading:         false,
    simulationRunning: true,
    gpsMode:           false,  // true = 전체 GPS 추적 모드 (장비/작업자 모두)
    // GPS ↔ 물리 좌표 변환 기준점 (현장 원점)
    // project.refLat/refLng가 설정되면 그 값으로 덮어씀
    referencePoint:    { lat: 37.5665, lng: 126.9780 },
    surveyOrigin:      null,   // { label, x, y, z } — 측량 기준점 (scene 원점의 실좌표)
    selectedEquipId:   null,
    selectedWorkerId:  null,
    selectedZoneId:    null,
    // ── 런타임 전용 (저장 안 됨) ─────────────────────────────────
    livePositions:     { workers: {}, equipment: {} },
    equipActiveSecs:   {},  // { [equipId]: number } — 누적 활동 초 (mode !== 'standby')
    bimSimProgress:    {},  // { [structureId]: number } — 자동 작업 누적 진척도(%)
    pendingBimReset:   [],  // BIM 프로젝트 ID 배열 — 다음 SET_REAL_DATA 시 해당 태스크 0% 초기화
  };
}

// ── BIM 구조물 실제 바운딩 박스 계산 ─────────────────────────────
// 절대 로컬 좌표가 크면(mm 단위 등) 전부 클램프 경계에 몰리는 문제 방지:
// "로컬 크기(extent)"만 추출해 offset 중심으로 배치 + 단위 자동 스케일
// 반환: { minX, maxX, minZ, maxZ } — scene world 좌표
export function computeStructureBounds(s) {
  const [ox, , oz] = s.offset || [0, 0, 0];
  const els = s.elements || [];
  if (!els.length) return { minX: ox - 10, maxX: ox + 10, minZ: oz - 10, maxZ: oz + 10 };

  let minLX = Infinity, maxLX = -Infinity, minLZ = Infinity, maxLZ = -Infinity;
  els.forEach(el => {
    const px = Number(el.positionX) || 0;
    const pz = Number(el.positionZ) || 0;   // floor plan depth → Three.js Z
    const sx = Math.abs(Number(el.sizeX))  || 0;
    const sz = Math.abs(Number(el.sizeZ))  || 0;
    minLX = Math.min(minLX, px - sx / 2);
    maxLX = Math.max(maxLX, px + sx / 2);
    minLZ = Math.min(minLZ, pz - sz / 2);
    maxLZ = Math.max(maxLZ, pz + sz / 2);
  });
  if (!isFinite(minLX)) return { minX: ox - 10, maxX: ox + 10, minZ: oz - 10, maxZ: oz + 10 };

  const rawExtX = maxLX - minLX;
  const rawExtZ = maxLZ - minLZ;

  // 단위 자동 감지: 어느 축이든 500 초과면 mm → m 변환(×0.001)
  const scale = (rawExtX > 500 || rawExtZ > 500) ? 0.001 : 1;

  // 실제 월드 좌표 = offset + 로컬좌표 × scale
  // ox ± halfExt 방식은 건물이 로컬 0~N에 있으면 절반을 놓치므로 사용 금지
  const wMinX = ox + minLX * scale;
  const wMaxX = ox + maxLX * scale;
  const wMinZ = oz + minLZ * scale;
  const wMaxZ = oz + maxLZ * scale;

  if (process.env.NODE_ENV !== 'production') {
    const first = els[0];
    console.log('[BIM bounds]', s.name,
      '| rawExt:', rawExtX.toFixed(1), rawExtZ.toFixed(1), '| scale:', scale,
      '| world X:', wMinX.toFixed(1), '~', wMaxX.toFixed(1),
      '/ Z:', wMinZ.toFixed(1), '~', wMaxZ.toFixed(1));
  }

  return { minX: wMinX, maxX: wMaxX, minZ: wMinZ, maxZ: wMaxZ };
}

// ── 직렬화 헬퍼 ──────────────────────────────────────────────────
// sim_config 저장 시 BIM 구조물의 elements(runtime only)는 제외
function serializeStructures(structures) {
  return structures.map(s => {
    const base = { id: s.id, name: s.name, type: s.type, offset: s.offset ?? [0,0,0], visible: s.visible !== false };
    if (s.type === 'bim') return { ...base, bimProjectId: s.bimProjectId };
    return { ...base, elements: s.elements || [] };
  });
}

// 로드 시 BIM 구조물은 elements=null(미로드 표시), IFC 구조물은 elements 복원
function deserializeStructures(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(s => ({
    ...s,
    elements: s.type === 'bim' ? null : (s.elements || []),
    offset:   s.offset   || [0, 0, 0],
    visible:  s.visible  !== false,
  }));
}

// ── Reducer ──────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {

    case 'SET_LOADING':
      return { ...state, isLoading: action.value };

    case 'SET_PROJECT_META': {
      // project에 refLat/refLng가 있으면 현장 원점으로 즉시 반영
      const meta = action.meta;
      const refUpdate = (meta?.refLat != null && meta?.refLng != null)
        ? { referencePoint: { lat: meta.refLat, lng: meta.refLng } }
        : {};
      return { ...state, projectMeta: meta, ...refUpdate };
    }

    case 'SET_REAL_DATA': {
      const incomingTasks = action.wbsTasks ?? state.wbsTasks;
      const pending = state.pendingBimReset;
      // pendingBimReset에 있는 BIM 프로젝트 태스크만 0% 초기화
      // 30초 폴링 시에는 pendingBimReset이 비어있어 리셋하지 않음 → 시뮬 진행률 보존
      const resolvedTasks = pending.length > 0
        ? (() => {
            const pendingSet = new Set(pending);
            return incomingTasks.map(t => {
              const m = (t.notes || '').match(/^BIM[^:]*:([^:]+):/);
              return (m && pendingSet.has(m[1])) ? { ...t, progress: 0 } : t;
            });
          })()
        : incomingTasks;
      return {
        ...state,
        isLoading:        false,
        linkedProjects:   action.linkedProjects ?? state.linkedProjects,
        wbsTasks:         resolvedTasks,
        bimElements:      action.bimElements    ?? state.bimElements,
        pendingBimReset:  [],  // 처리 후 초기화
      };
    }

    case 'LOAD_SIM_CONFIG': {
      const loadedStructures = deserializeStructures(action.config.structures);
      const hasBim = loadedStructures.some(s => s.type === 'bim');
      const bimIdsFromConfig = loadedStructures
        .filter(s => s.type === 'bim' && s.bimProjectId)
        .map(s => String(s.bimProjectId));

      let wbsTasks = state.wbsTasks;
      let pendingBimReset = state.pendingBimReset;

      if (bimIdsFromConfig.length > 0) {
        if (state.wbsTasks.length > 0) {
          // SET_REAL_DATA가 먼저 도착한 경우 → 지금 바로 리셋
          const bimIdSet = new Set(bimIdsFromConfig);
          wbsTasks = state.wbsTasks.map(t => {
            const m = (t.notes || '').match(/^BIM[^:]*:([^:]+):/);
            return (m && bimIdSet.has(m[1])) ? { ...t, progress: 0 } : t;
          });
        } else {
          // wbsTasks 아직 미로드 → SET_REAL_DATA 도착 시 리셋하도록 표시
          pendingBimReset = [...new Set([...state.pendingBimReset, ...bimIdsFromConfig])];
        }
      }

      return {
        ...state,
        workers:      action.config.workers     || state.workers,
        equipment:    action.config.equipment   || state.equipment,
        dangerZones:  action.config.dangerZones || state.dangerZones,
        structures:   loadedStructures,
        terrain:      action.config.terrain !== undefined ? action.config.terrain : state.terrain,
        surveyOrigin: action.config.surveyOrigin !== undefined ? action.config.surveyOrigin : state.surveyOrigin,
        bimSimProgress: hasBim ? {} : state.bimSimProgress,
        wbsTasks,
        pendingBimReset,
      };
    }

    case 'LOG_EVENT':
      return {
        ...state,
        events: [
          { id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, timestamp: new Date().toISOString(), ...action.event },
          ...state.events,
        ].slice(0, MAX_EVENTS),
      };

    case 'UPDATE_TASK_PROGRESS': {
      const updated = state.wbsTasks.map(t =>
        t.taskId === action.taskId
          ? { ...t, progress: Math.min(100, (t.progress || 0) + (action.delta || 0)) }
          : t
      );
      return { ...state, wbsTasks: updated };
    }

    case 'SET_TASK_PROGRESS': {
      // 절댓값으로 진도를 설정 (실시간 날짜 계산 결과 반영)
      const updated = state.wbsTasks.map(t =>
        t.taskId === action.taskId
          ? { ...t, progress: Math.min(100, Math.max(0, action.progress)) }
          : t
      );
      return { ...state, wbsTasks: updated };
    }

    // ── 작업자 ──────────────────────────────────────────────────
    case 'ADD_WORKER':
      return { ...state, workers: [...state.workers, action.worker] };
    case 'REMOVE_WORKER':
      return {
        ...state,
        workers: state.workers.filter(w => w.id !== action.id),
        selectedWorkerId: state.selectedWorkerId === action.id ? null : state.selectedWorkerId,
      };
    case 'SELECT_WORKER':
      return { ...state, selectedWorkerId: action.id };
    case 'UPDATE_WORKER':
      return {
        ...state,
        workers: state.workers.map(w => w.id === action.id ? { ...w, ...action.updates } : w),
      };

    // ── 장비 ────────────────────────────────────────────────────
    case 'ADD_EQUIPMENT':
      return { ...state, equipment: [...state.equipment, action.equipment] };
    case 'REMOVE_EQUIPMENT':
      return {
        ...state,
        equipment: state.equipment.filter(e => e.id !== action.id),
        selectedEquipId: state.selectedEquipId === action.id ? null : state.selectedEquipId,
      };
    case 'SELECT_EQUIPMENT':
      return { ...state, selectedEquipId: action.id };
    case 'UPDATE_EQUIPMENT':
      return {
        ...state,
        equipment: state.equipment.map(e => e.id === action.id ? { ...e, ...action.updates } : e),
      };
    case 'SET_EQUIP_GPS_POS':
      return {
        ...state,
        equipment: state.equipment.map(e => e.id === action.id ? { ...e, gpsPos: action.pos } : e),
      };

    // GPS 장치 ID 할당
    case 'SET_EQUIP_DEVICE_ID':
      return {
        ...state,
        equipment: state.equipment.map(e => e.id === action.id ? { ...e, gpsDeviceId: action.deviceId } : e),
      };
    case 'SET_WORKER_DEVICE_ID':
      return {
        ...state,
        workers: state.workers.map(w => w.id === action.id ? { ...w, gpsDeviceId: action.deviceId } : w),
      };
    case 'SET_WORKER_GPS_POS':
      return {
        ...state,
        workers: state.workers.map(w => w.id === action.id ? { ...w, gpsPos: action.pos } : w),
      };

    // WBS 태스크 배정 (장비 또는 작업자, entityId로 매칭)
    case 'ASSIGN_WBS_TASK':
      return {
        ...state,
        equipment: state.equipment.map(e =>
          e.id === action.entityId ? { ...e, assignedWbsTaskId: action.taskId } : e
        ),
        workers: state.workers.map(w =>
          w.id === action.entityId ? { ...w, assignedWbsTaskId: action.taskId } : w
        ),
      };

    // GPS 전체 모드 토글
    // ON  → deviceId 있는 장비를 mode:'gps'로 전환, 이전 mode를 _prevMode에 백업
    // OFF → _prevMode로 복구 (없으면 'standby'), gpsPos 초기화
    case 'TOGGLE_GPS_MODE': {
      const next = !state.gpsMode;
      return {
        ...state,
        gpsMode: next,
        equipment: state.equipment.map(e =>
          next
            ? (e.gpsDeviceId
                ? { ...e, _prevMode: e.mode, mode: 'gps' }
                : e)
            : (e.mode === 'gps'
                ? { ...e, mode: e._prevMode || 'standby', _prevMode: undefined, gpsPos: null }
                : e)
        ),
        workers: state.workers.map(w =>
          next ? w : { ...w, gpsPos: null }
        ),
      };
    }

    // ── 위험구역 ─────────────────────────────────────────────────
    case 'ADD_ZONE':
      return { ...state, dangerZones: [...state.dangerZones, action.zone] };
    case 'TOGGLE_ZONE':
      return { ...state, dangerZones: state.dangerZones.map(z => z.id === action.id ? { ...z, active: !z.active } : z) };
    case 'REMOVE_ZONE':
      return {
        ...state,
        dangerZones: state.dangerZones.filter(z => z.id !== action.id),
        selectedZoneId: state.selectedZoneId === action.id ? null : state.selectedZoneId,
      };
    case 'SELECT_ZONE':
      return { ...state, selectedZoneId: action.id };
    case 'UPDATE_ZONE':
      return {
        ...state,
        dangerZones: state.dangerZones.map(z => z.id === action.id ? { ...z, ...action.updates } : z),
      };

    // ── 구조물 ───────────────────────────────────────────────────
    case 'ADD_STRUCTURE': {
      const newStructures = [...state.structures, action.structure];
      if (action.structure.type === 'bim' && action.structure.bimProjectId) {
        const bimId    = String(action.structure.bimProjectId);
        const prefix   = `BIM:${bimId}:`;
        const subPrefix = `BIM_SUB:${bimId}:`;
        const isBimTask = (notes) => (notes || '').startsWith(prefix) || (notes || '').startsWith(subPrefix);

        if (state.wbsTasks.length > 0) {
          // 태스크 이미 로드됨 → 해당 BIM 태스크만 즉시 리셋 (기존 WBS 태스크 보호)
          return {
            ...state,
            structures: newStructures,
            wbsTasks: state.wbsTasks.map(t =>
              isBimTask(t.notes) ? { ...t, progress: 0 } : t
            ),
            bimSimProgress: {},
          };
        } else {
          // 아직 wbsTasks 없음 → SET_REAL_DATA 도착 시 리셋하도록 표시
          return {
            ...state,
            structures: newStructures,
            pendingBimReset: [...new Set([...state.pendingBimReset, bimId])],
            bimSimProgress: {},
          };
        }
      }
      return { ...state, structures: newStructures };
    }

    case 'REMOVE_STRUCTURE':
      return { ...state, structures: state.structures.filter(s => s.id !== action.id) };

    case 'TOGGLE_STRUCTURE':
      return {
        ...state,
        structures: state.structures.map(s => s.id === action.id ? { ...s, visible: !s.visible } : s),
      };

    case 'UPDATE_STRUCTURE_OFFSET':
      return {
        ...state,
        structures: state.structures.map(s => s.id === action.id ? { ...s, offset: action.offset } : s),
      };

    // BIM 구조물 elements를 API에서 로드한 후 채워넣기
    // 자동 작업 중이면 BIM 로드 완료 시점에 장비 경로 재계산
    case 'SET_STRUCTURE_ELEMENTS': {
      const newStructures = state.structures.map(s =>
        s.id === action.id ? { ...s, elements: action.elements } : s
      );
      // auto 장비 경로 재계산 (elements가 없어서 초기 위치 주변으로만 돌던 상황 수정)
      const isAnyAuto = state.equipment.some(e => e.mode === 'auto') && state.simulationRunning;
      if (!isAnyAuto || !action.elements?.length) {
        return { ...state, structures: newStructures };
      }
      const rng = (min, max) => min + Math.random() * (max - min);
      const allBounds = newStructures
        .filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0)
        .map(s => computeStructureBounds(s));
      if (!allBounds.length) return { ...state, structures: newStructures };
      const bInMinX = Math.min(...allBounds.map(b => b.minX));
      const bInMaxX = Math.max(...allBounds.map(b => b.maxX));
      const bInMinZ = Math.min(...allBounds.map(b => b.minZ));
      const bInMaxZ = Math.max(...allBounds.map(b => b.maxZ));
      const bW = bInMaxX - bInMinX, bD = bInMaxZ - bInMinZ;
      const BPAD = 8;
      const bMinX = bInMinX - BPAD, bMaxX = bInMaxX + BPAD;
      const bMinZ = bInMinZ - BPAD, bMaxZ = bInMaxZ + BPAD;
      const clampB = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      // 굴착기/크레인 → BIM 내부 격자
      const autoEquip   = state.equipment.filter(e => e.mode === 'auto');
      const sFixedEquip = autoEquip.filter(e => e.type === 'excavator' || e.type === 'crane');
      const sfTotal = sFixedEquip.length || 1;
      const sfCols  = Math.max(1, Math.ceil(Math.sqrt(sfTotal)));
      const sfRows  = Math.max(1, Math.ceil(sfTotal / sfCols));
      const sFixedPos = {};
      sFixedEquip.forEach((e, i) => {
        const col = i % sfCols;
        const row = Math.floor(i / sfCols) % sfRows;
        const cW  = bW / sfCols, cD = bD / sfRows;
        sFixedPos[e.id] = [
          bInMinX + cW * col + rng(cW * 0.25, cW * 0.75),
          bInMinZ + cD * row + rng(cD * 0.25, cD * 0.75),
        ];
      });
      const sExcavPts = sFixedEquip.filter(e => e.type === 'excavator').map(e => sFixedPos[e.id]);
      let sDumpCount = 0;
      const equipment = state.equipment.map((e) => {
        if (e.mode !== 'auto') return e;
        let route;
        if (e.type === 'excavator' || e.type === 'crane') {
          const [cx, cz] = sFixedPos[e.id] || [0, 0];
          route = [[cx, 0, cz], [cx, 0, cz]];
        } else if (e.type === 'dump') {
          let px, pz;
          if (sExcavPts.length > 0) {
            const [ex, ez] = sExcavPts[sDumpCount % sExcavPts.length];
            px = clampB(ex + rng(-4, 4), bInMinX, bInMaxX);
            pz = clampB(ez + rng(-4, 4), bInMinZ, bInMaxZ);
          } else {
            px = rng(bInMinX, bInMaxX); pz = rng(bInMinZ, bInMaxZ);
          }
          sDumpCount++;
          const side = Math.floor(Math.random() * 4), off = rng(6, 18);
          let dx, dz;
          if (side === 0)      { dx = rng(bInMinX, bInMaxX); dz = bInMinZ - off; }
          else if (side === 1) { dx = rng(bInMinX, bInMaxX); dz = bInMaxZ + off; }
          else if (side === 2) { dx = bInMinX - off;          dz = rng(bInMinZ, bInMaxZ); }
          else                 { dx = bInMaxX + off;          dz = rng(bInMinZ, bInMaxZ); }
          route = [[px, 0, pz], [dx, 0, dz]];
        } else {
          const cx = rng(bInMinX, bInMaxX), cz = rng(bInMinZ, bInMaxZ);
          const r  = Math.max(8, Math.min(bW, bD) * 0.12);
          route = Array.from({ length: 4 }, (_, i) => {
            const a = (i / 4) * Math.PI * 2;
            return [clampB(cx + Math.cos(a) * r, bMinX, bMaxX), 0, clampB(cz + Math.sin(a) * r, bMinZ, bMaxZ)];
          });
        }
        return { ...e, route };
      });
      return { ...state, structures: newStructures, equipment };
    }

    // ── 드론 지형 ────────────────────────────────────────────────
    case 'SET_TERRAIN':
      return { ...state, terrain: action.terrain };

    case 'CLEAR_TERRAIN':
      return { ...state, terrain: null };

    // ── 현장 원점 (GPS ↔ 물리 좌표) ─────────────────────────────
    case 'SET_SITE_ORIGIN':
      return { ...state, referencePoint: { lat: action.lat, lng: action.lng } };

    // ── 카메라 ──────────────────────────────────────────────────
    case 'SET_CAMERAS':
      return { ...state, cameras: action.cameras };
    case 'ADD_CAMERA':
      return { ...state, cameras: [...state.cameras, action.camera] };
    case 'UPDATE_CAMERA':
      return { ...state, cameras: state.cameras.map(c => c.cameraId === action.cameraId ? { ...c, ...action.updates } : c) };
    case 'REMOVE_CAMERA':
      return { ...state, cameras: state.cameras.filter(c => c.cameraId !== action.cameraId) };

    // ── 측량 기준점 ──────────────────────────────────────────────
    case 'SET_SURVEY_ORIGIN':
      return { ...state, surveyOrigin: action.origin }; // null이면 해제

    // ── 실시간 위치 (저장 안 됨, Canvas → 사이드바용) ─────────────
    case 'SET_LIVE_POSITIONS':
      return { ...state, livePositions: { workers: action.workers, equipment: action.equipment } };

    // ── 시뮬레이션 ───────────────────────────────────────────────
    case 'TOGGLE_SIM':
      return { ...state, simulationRunning: !state.simulationRunning };

    // ── Auto 작업 시뮬레이션 ────────────────────────────────────
    // BIM 구조물이 있으면 그 주변으로, 없으면 initialPos 주변으로 경로 생성
    case 'AUTO_SIM_START': {
      const rng = (min, max) => min + Math.random() * (max - min);

      // BIM 구조물 실제 바운딩 박스 목록
      const bimStructs = state.structures
        .filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0);
      const bimBounds = bimStructs.map(s => computeStructureBounds(s));

      // BIM 내부 바운딩 (패딩 없음) — 굴착기/크레인 배치 기준
      const innerMinX = bimBounds.length > 0 ? Math.min(...bimBounds.map(b => b.minX)) : -30;
      const innerMaxX = bimBounds.length > 0 ? Math.max(...bimBounds.map(b => b.maxX)) : 30;
      const innerMinZ = bimBounds.length > 0 ? Math.min(...bimBounds.map(b => b.minZ)) : -30;
      const innerMaxZ = bimBounds.length > 0 ? Math.max(...bimBounds.map(b => b.maxZ)) : 30;
      const innerW = innerMaxX - innerMinX;
      const innerD = innerMaxZ - innerMinZ;
      // 외곽 반출 구역 (소형 패딩)
      const PAD = 8;
      const areaMinX = innerMinX - PAD;
      const areaMaxX = innerMaxX + PAD;
      const areaMinZ = innerMinZ - PAD;
      const areaMaxZ = innerMaxZ + PAD;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

      // 굴착기/크레인 → BIM 내부 격자 배치 (사전 계산)
      const fixedEquip = state.equipment.filter(e => e.type === 'excavator' || e.type === 'crane');
      const fTotal = fixedEquip.length || 1;
      const fCols  = Math.max(1, Math.ceil(Math.sqrt(fTotal)));
      const fRows  = Math.max(1, Math.ceil(fTotal / fCols));
      const fixedPos = {};
      fixedEquip.forEach((e, i) => {
        const col = i % fCols;
        const row = Math.floor(i / fCols) % fRows;
        const cW  = innerW / fCols;
        const cD  = innerD / fRows;
        fixedPos[e.id] = [
          innerMinX + cW * col + rng(cW * 0.25, cW * 0.75),
          innerMinZ + cD * row + rng(cD * 0.25, cD * 0.75),
        ];
      });
      // 덤프트럭이 접근할 굴착기 위치 목록
      const excavPts = fixedEquip
        .filter(e => e.type === 'excavator')
        .map(e => fixedPos[e.id]);

      let dumpCount = 0;
      const makeRoute = (e) => {
        const { type } = e;
        if (type === 'crane') {
          const [cx, cz] = fixedPos[e.id] || [0, 0];
          return [[cx, 0, cz], [cx, 0, cz]];
        }
        if (type === 'excavator') {
          // 굴착 패턴: 작은 반경으로 천천히 이동 (실제 굴착 동작처럼)
          const [cx, cz] = fixedPos[e.id] || [0, 0];
          const r = rng(1.5, 3.0);
          return [
            [cx,         0, cz        ],
            [cx + r,     0, cz        ],
            [cx + r,     0, cz + r    ],
            [cx,         0, cz + r    ],
            [cx - r*0.5, 0, cz + r*0.5],
            [cx,         0, cz        ],
          ];
        }
        if (type === 'dump') {
          // 적재: 굴착기 옆으로 접근
          let px, pz;
          if (excavPts.length > 0) {
            const [ex, ez] = excavPts[dumpCount % excavPts.length];
            px = clamp(ex + rng(-4, 4), innerMinX, innerMaxX);
            pz = clamp(ez + rng(-4, 4), innerMinZ, innerMaxZ);
          } else {
            px = rng(innerMinX, innerMaxX);
            pz = rng(innerMinZ, innerMaxZ);
          }
          dumpCount++;
          // 반출: BIM 외곽 바깥으로
          const side = Math.floor(Math.random() * 4);
          const off  = rng(6, 18);
          let dx, dz;
          if (side === 0)      { dx = rng(innerMinX, innerMaxX); dz = innerMinZ - off; }
          else if (side === 1) { dx = rng(innerMinX, innerMaxX); dz = innerMaxZ + off; }
          else if (side === 2) { dx = innerMinX - off;           dz = rng(innerMinZ, innerMaxZ); }
          else                 { dx = innerMaxX + off;           dz = rng(innerMinZ, innerMaxZ); }
          return [[px, 0, pz], [dx, 0, dz]];
        }
        // vehicle: 작업 구역 내 순환
        const cx = rng(innerMinX, innerMaxX);
        const cz = rng(innerMinZ, innerMaxZ);
        const r  = Math.max(8, Math.min(innerW, innerD) * 0.12);
        return Array.from({ length: 4 }, (_, i) => {
          const a = (i / 4) * Math.PI * 2;
          return [clamp(cx + Math.cos(a) * r, areaMinX, areaMaxX), 0, clamp(cz + Math.sin(a) * r, areaMinZ, areaMaxZ)];
        });
      };
      const getSpeed = (type) => {
        if (type === 'dump')      return 4.0;   // 덤프 사이클 시작 속도 (사이클 관리자가 조절)
        if (type === 'crane')     return 0;
        if (type === 'excavator') return 0.8;   // 굴착 작업 속도 (느린 이동)
        if (type === 'vehicle')   return rng(1.5, 2.5);
        return rng(1.0, 2.0);
      };
      const equipment = state.equipment.map((e) => ({
        ...e,
        mode:  'auto',
        speed: getSpeed(e.type),
        route: makeRoute(e),
      }));
      return { ...state, equipment, simulationRunning: true };
    }

    // ── BIM 자동 작업 진척도 틱 ────────────────────────────────────
    // updates: [{ key: '${structureId}_${taskIdx}', delta: number }, ...]
    case 'BIM_PROGRESS_TICK': {
      const updated = { ...state.bimSimProgress };
      (action.updates || []).forEach(({ key, delta }) => {
        updated[key] = Math.min(100, (updated[key] || 0) + delta);
      });
      return { ...state, bimSimProgress: updated };
    }

    // ── 장비 활동 시간 누적 ─────────────────────────────────────────
    case 'TICK_EQUIP_ACTIVE': {
      const updated = { ...state.equipActiveSecs };
      action.equipment.forEach(e => {
        if (e.mode !== 'standby') updated[e.id] = (updated[e.id] || 0) + action.intervalSec;
      });
      return { ...state, equipActiveSecs: updated };
    }

    default:
      return state;
  }
}

// ── Provider ─────────────────────────────────────────────────────
export function IntegrationProvider({ projectId, children }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitial);

  // WBS 태스크 진행률 변경 감지 → DB 자동 저장 (3초 debounce)
  const prevProgressRef = useRef({});  // { taskId: progress }
  const syncTimers      = useRef({});  // { taskId: timeoutId }
  useEffect(() => {
    state.wbsTasks.forEach(task => {
      const prev = prevProgressRef.current[task.taskId];
      if (prev === undefined) {
        prevProgressRef.current[task.taskId] = task.progress;
        return;
      }
      if (prev !== task.progress) {
        prevProgressRef.current[task.taskId] = task.progress;
        clearTimeout(syncTimers.current[task.taskId]);
        syncTimers.current[task.taskId] = setTimeout(() => {
          AxiosCustom.put(`/api/wbs/task/${task.taskId}`, task).catch(() => {});
        }, 3000);
      }
    });
  }, [state.wbsTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // 프로젝트 전환 시 API에서 sim_config 복원
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    async function loadSimConfig() {
      try {
        const res = await AxiosCustom.get(`/api/integration/project/${projectId}`);
        if (cancelled) return;
        const project = res.data;
        dispatch({ type: 'SET_PROJECT_META', meta: {
          projectId:    project.projectId,
          projectName:  project.projectName,
          wbsProjectId: project.wbsProjectId,
          bimProjectId: project.bimProjectId,
          description:  project.description,
          refLat:       project.refLat,
          refLng:       project.refLng,
        }});
        if (project.simConfig) {
          try {
            const config = JSON.parse(project.simConfig);
            dispatch({ type: 'LOAD_SIM_CONFIG', config });
          } catch {
            // simConfig JSON 파싱 실패 → 기본값 유지
          }
        }
      } catch {
        // 로드 실패 → 기본값 유지
      }
    }
    loadSimConfig();
    return () => { cancelled = true; };
  }, [projectId]);

  // 프로젝트 전환 시 카메라 목록 로드
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    AxiosCustom.get(`/api/integration/project/${projectId}/cameras`)
      .then(res => { if (!cancelled) dispatch({ type: 'SET_CAMERAS', cameras: res.data || [] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  // 변경 시 1.5초 debounce 후 API에 저장
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!projectId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const simConfig = JSON.stringify({
        workers:      state.workers,
        equipment:    state.equipment,
        dangerZones:  state.dangerZones,
        structures:   serializeStructures(state.structures),
        terrain:      state.terrain,
        surveyOrigin: state.surveyOrigin,
      });
      AxiosCustom.put(`/api/integration/project/${projectId}/sim-config`, { simConfig })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [projectId, state.workers, state.equipment, state.dangerZones, state.structures, state.terrain, state.surveyOrigin]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <IntegrationCtx.Provider value={state}>
      <IntegrationDispatch.Provider value={dispatch}>
        {children}
      </IntegrationDispatch.Provider>
    </IntegrationCtx.Provider>
  );
}
