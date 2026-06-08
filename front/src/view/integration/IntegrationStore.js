import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';

export const IntegrationCtx      = createContext(null);
export const IntegrationDispatch = createContext(null);

export const useIntegration         = () => useContext(IntegrationCtx);
export const useIntegrationDispatch = () => useContext(IntegrationDispatch);

const MAX_EVENTS = 60;

const DEFAULT_WORKERS = [
  { id: 'w1', name: '작업자 A', initialPos: [5,  0,  3], gear: true  },
  { id: 'w2', name: '작업자 B', initialPos: [-3, 0,  8], gear: true  },
  { id: 'w3', name: '작업자 C', initialPos: [10, 0, -5], gear: false },
];
const DEFAULT_EQUIPMENT = [
  { id: 'e1', type: 'excavator', name: '굴착기-1', initialPos: [0,0,0],   route: [[0,0,0],[10,0,0],[10,0,10],[0,0,10],[0,0,0]], speed: 1.5 },
  { id: 'e2', type: 'dump',      name: '덤프트럭-1', initialPos: [-8,0,-8], route: [[-8,0,-8],[8,0,-8],[8,0,-2],[-8,0,-2],[-8,0,-8]], speed: 2.5 },
  { id: 'e3', type: 'crane',     name: '크레인-1',  initialPos: [15,0,5],  route: [[15,0,5]], speed: 0 },
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

    isLoading:         false,
    simulationRunning: true,
    referencePoint:    { lat: 37.5665, lng: 126.9780 },
  };
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

    case 'SET_PROJECT_META':
      return { ...state, projectMeta: action.meta };

    case 'SET_REAL_DATA':
      return {
        ...state,
        isLoading:      false,
        linkedProjects: action.linkedProjects ?? state.linkedProjects,
        wbsTasks:       action.wbsTasks       ?? state.wbsTasks,
        bimElements:    action.bimElements     ?? state.bimElements,
      };

    case 'LOAD_SIM_CONFIG':
      return {
        ...state,
        workers:     action.config.workers     || state.workers,
        equipment:   action.config.equipment   || state.equipment,
        dangerZones: action.config.dangerZones || state.dangerZones,
        structures:  deserializeStructures(action.config.structures),
        terrain:     action.config.terrain !== undefined ? action.config.terrain : state.terrain,
      };

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

    // ── 작업자 ──────────────────────────────────────────────────
    case 'ADD_WORKER':
      return { ...state, workers: [...state.workers, action.worker] };
    case 'REMOVE_WORKER':
      return { ...state, workers: state.workers.filter(w => w.id !== action.id) };

    // ── 장비 ────────────────────────────────────────────────────
    case 'ADD_EQUIPMENT':
      return { ...state, equipment: [...state.equipment, action.equipment] };
    case 'REMOVE_EQUIPMENT':
      return { ...state, equipment: state.equipment.filter(e => e.id !== action.id) };

    // ── 위험구역 ─────────────────────────────────────────────────
    case 'ADD_ZONE':
      return { ...state, dangerZones: [...state.dangerZones, action.zone] };
    case 'TOGGLE_ZONE':
      return { ...state, dangerZones: state.dangerZones.map(z => z.id === action.id ? { ...z, active: !z.active } : z) };
    case 'REMOVE_ZONE':
      return { ...state, dangerZones: state.dangerZones.filter(z => z.id !== action.id) };

    // ── 구조물 ───────────────────────────────────────────────────
    case 'ADD_STRUCTURE':
      return { ...state, structures: [...state.structures, action.structure] };

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
    case 'SET_STRUCTURE_ELEMENTS':
      return {
        ...state,
        structures: state.structures.map(s => s.id === action.id ? { ...s, elements: action.elements } : s),
      };

    // ── 드론 지형 ────────────────────────────────────────────────
    case 'SET_TERRAIN':
      return { ...state, terrain: action.terrain };

    case 'CLEAR_TERRAIN':
      return { ...state, terrain: null };

    // ── 시뮬레이션 ───────────────────────────────────────────────
    case 'TOGGLE_SIM':
      return { ...state, simulationRunning: !state.simulationRunning };

    default:
      return state;
  }
}

// ── Provider ─────────────────────────────────────────────────────
export function IntegrationProvider({ projectId, children }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitial);

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

  // 변경 시 1.5초 debounce 후 API에 저장
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!projectId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const simConfig = JSON.stringify({
        workers:     state.workers,
        equipment:   state.equipment,
        dangerZones: state.dangerZones,
        structures:  serializeStructures(state.structures),
        terrain:     state.terrain,
      });
      AxiosCustom.put(`/api/integration/project/${projectId}/sim-config`, { simConfig })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(saveTimer.current);
  }, [projectId, state.workers, state.equipment, state.dangerZones, state.structures, state.terrain]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <IntegrationCtx.Provider value={state}>
      <IntegrationDispatch.Provider value={dispatch}>
        {children}
      </IntegrationDispatch.Provider>
    </IntegrationCtx.Provider>
  );
}
