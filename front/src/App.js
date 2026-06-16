import AxiosCustom from './axios/AxiosCustom';
import { useT } from './i18n/LanguageContext';
import SatelliteAPI from './view/SatelliteAPI';
import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/bim/BimDashboard';
import BimProjectList from './view/bim/BimProjectList';
import SatelliteDashboard from './view/SatelliteDashboard';
import ElementEditPanel from './view/bim/component/ElementEditPanel';
import FloatingAgent from './component/FloatingAgent';
import AgentDashboard from './view/agent/AgentDashboard';
import SimulationDashboard from './view/simulation/SimulationDashboard';
import SimulationProjectList from './view/simulation/SimulationProjectList';
import SafeDashboard from './view/safe/SafeDashboard';
import SafeProjectList from './view/safe/SafeProjectList';
import TestDashboard from './view/test/TestDashboard';
import WbsDashboard from './view/wbs/WbsDashboard';
import { IntegrationServices, IntegrationUI } from './view/integration/IntegrationDashboard';
import { IntegrationProvider } from './view/integration/IntegrationStore';
import IntegrationProjectList from './view/integration/IntegrationProjectList';
import AgentWbsPopup from './component/AgentWbsPopup';
import WbsProjectSelectModal from './component/WbsProjectSelectModal';
import { CrackMonitorProvider } from './context/CrackMonitorContext';
import SettingsPanel from './view/settings/SettingsPanel';
import TotpModal from './view/settings/TotpModal';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── 모바일 가로 회전 차단 오버레이 ──────────────────────────────
function OrientationLockOverlay() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const check = () => {
      const landscape = window.innerWidth > window.innerHeight;
      const mobile = window.innerWidth <= 1024 && ('ontouchstart' in window);
      setShow(landscape && mobile);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  if (!show) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      backgroundColor: '#060f18',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 20,
    }}>
      <div style={{ fontSize: 56, transform: 'rotate(90deg)' }}>📱</div>
      <p style={{ color: '#93c5fd', fontSize: 17, fontWeight: 700, letterSpacing: '0.02em' }}>
        세로 방향으로 사용해주세요
      </p>
      <p style={{ color: '#4b5563', fontSize: 13 }}>Please rotate to portrait</p>
    </div>
  );
}

// ── IFC 임포트 시 레이어 자동 생성 ─────────────────────────────
const IFC_LAYER_LABEL = {
  IfcColumn: '기둥공사', IfcBeam: '보공사',   IfcWall:   '벽체공사',
  IfcSlab:   '슬래브 공사', IfcPier: '교각공사', IfcMember: '부재공사',
  IfcWindow: '창호공사', IfcDoor: '문공사',  IfcStair:  '계단공사', IfcRoof: '지붕공사',
};
const IFC_LAYER_COLOR = {
  IfcColumn: '#3b82f6', IfcBeam:   '#22c55e', IfcWall:   '#64748b',
  IfcSlab:   '#f59e0b', IfcPier:   '#ec4899', IfcMember: '#84cc16',
  IfcWindow: '#06b6d4', IfcDoor:   '#8b5cf6', IfcStair:  '#f97316', IfcRoof: '#6366f1',
};
const IFC_TYPE_ORDER = ['IfcColumn','IfcBeam','IfcWall','IfcSlab','IfcPier','IfcMember','IfcWindow','IfcDoor','IfcStair','IfcRoof'];

function storeyRank(name) {
  if (!name || name === '(층 미지정)') return 9999;
  const lc = name.toLowerCase();
  const b = lc.match(/^b(\d+)/); if (b) return -parseInt(b[1], 10);
  const f = name.match(/^(\d+)/); if (f) return parseInt(f[1], 10);
  if (lc === 'rf' || lc.includes('roof') || lc.includes('옥상') || lc.includes('지붕')) return 1000;
  return 500;
}

// IFC 기본 빌딩 이름 더미값 — 동 레이어를 만들지 않는 것으로 취급
const IFC_DUMMY_BUILDING_NAMES = new Set([
  '// building/name //', 'building name', 'building/name', 'building', 'default',
  'unnamed', 'no building', 'building_0', 'building_1', 'building_2', 'none', '(none)', '',
]);

function isRealBuilding(name) {
  if (!name) return false;
  return !IFC_DUMMY_BUILDING_NAMES.has(name.trim().toLowerCase());
}

/**
 * 다양한 IFC 층 이름 표현을 표준 형식으로 정규화합니다.
 * 예: "2F", "2층", "Floor 2", "Level 2", "Story 2" → "2F"
 *     "B1", "지하1층" → "B1"
 *     "지붕", "Roof" → "RF"
 */
function normalizeStoreyName(name) {
  if (!name) return null;
  const lc = name.toLowerCase().trim();

  // 지하 (B, Basement)
  const basementMatch = lc.match(/(b|지하|basement)\s*(\d+)/);
  if (basementMatch) {
    return `B${basementMatch[2]}`;
  }

  // 지상 (F, Floor, 층, Story, Storey, Level) — "2층", "2F", "Floor 2", "Level 2", "Story 2" 등
  const floorMatch = lc.match(/(\d+)\s*(f|층|floor|level|story|storey)/);
  if (floorMatch) return `${floorMatch[1]}F`;
  const levelMatch = lc.match(/(floor|level|story|storey)\s*(\d+)/);
  if (levelMatch) return `${levelMatch[2]}F`;

  // 그냥 숫자만 있는 경우 (예: "1", "2")
  const numMatch = lc.match(/^(\d+)$/);
  if (numMatch) {
    return `${numMatch[1]}F`;
  }

  // "지붕", "옥상", "Roof", "RF"
  if (lc.includes('roof') || lc.includes('지붕') || lc.includes('옥상') || lc === 'rf') {
    return 'RF';
  }

  return name; // 일치하는 패턴이 없으면 원본 이름 반환
}


export function generateLayersFromElements(elements, projectId) {
  // building → storey → type 3단계 그루핑
  const byBuilding = new Map();
  for (const el of elements) {
    if (!IFC_LAYER_LABEL[el.elementType]) continue;
    const building = isRealBuilding(el.building) ? el.building : null;
    const storey   = el.storey || null;
    
    // 층 이름 정규화 — null이면 '미분류'로 대체하여 WBS 누락 방지
    const normalizedStoreyName = normalizeStoreyName(storey) ?? '미분류';

    const bKey = building ?? '__none__';
    if (!byBuilding.has(bKey)) byBuilding.set(bKey, { name: building, storeys: new Map() });
    const byStorey = byBuilding.get(bKey).storeys;

    const sKey = normalizedStoreyName;
    if (!byStorey.has(sKey)) byStorey.set(sKey, { name: normalizedStoreyName, types: new Map() });
    const byType = byStorey.get(sKey).types;
    if (!byType.has(el.elementType)) byType.set(el.elementType, []);

    // 부재 ID뿐만 아니라 물성치 판별을 위해 부재 객체 전체를 임시 보관
    byType.get(el.elementType).push(el);
  }

  const layers = [];
  const sortedBuildingKeys = [...byBuilding.keys()].sort((a, b) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    return byBuilding.get(a).name.localeCompare(byBuilding.get(b).name, 'ko');
  });

  sortedBuildingKeys.forEach((bKey, bIdx) => {
    const { name: buildingName, storeys: byStorey } = byBuilding.get(bKey);
    const hasBuilding = buildingName !== null;
    const buildingId  = hasBuilding ? `layer-${projectId}-B${bIdx}` : null;

    if (hasBuilding) {
      layers.push({
        layerId: buildingId, projectId, parentLayerId: null,
        layerName: buildingName, color: '#94a3b8',
        visible: true, elementIds: [], sortOrder: bIdx * 10000,
      });
    }

    const sortedStoreyKeys = [...byStorey.keys()].sort((a, b) => {
      const na = byStorey.get(a).name, nb = byStorey.get(b).name;
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return storeyRank(na) - storeyRank(nb);
    });

    sortedStoreyKeys.forEach((sKey, sIdx) => {
      const { name: storeyName, types: byType } = byStorey.get(sKey);
      const hasStorey = storeyName !== null;
      const storeyId  = `layer-${projectId}-B${bIdx}-S${sIdx}`;

      if (hasStorey) {
        // 💡 [핵심] 해당 층의 첫 번째 부재를 샘플링하여 오리지널 고도 및 지하 여부 추출
        let sampleElement = null;
        for (const typeElements of byType.values()) {
          if (typeElements && typeElements.length > 0) {
            sampleElement = typeElements[0];
            break;
          }
        }

        layers.push({
          layerId: storeyId, projectId, parentLayerId: buildingId,
          layerName: storeyName, color: '#64748b',
          visible: true, elementIds: [], sortOrder: bIdx * 10000 + sIdx * 100,
          // 💡 WBS 연동용 메타데이터 심기
          elevation: sampleElement ? (sampleElement.elevation ?? null) : null,
          isUnderground: sampleElement ? (sampleElement.isUnderground ?? null) : null,
        });
      }

      const typeParentId = hasStorey ? storeyId : buildingId;
      const sortedTypes = [...byType.keys()].sort(
          (a, b) => IFC_TYPE_ORDER.indexOf(a) - IFC_TYPE_ORDER.indexOf(b)
      );

      sortedTypes.forEach((type, tIdx) => {
        const typeElements = byType.get(type);
        layers.push({
          layerId:       `layer-${projectId}-B${bIdx}-S${sIdx}-T${tIdx}`,
          projectId,
          parentLayerId: typeParentId,
          layerName:     IFC_LAYER_LABEL[type],
          color:         IFC_LAYER_COLOR[type] || '#888888',
          visible:       true,
          // 부재 객체 배열에서 ID 배열만 추출하여 매핑
          elementIds:    typeElements.map(el => el.elementId),
          sortOrder:     bIdx * 10000 + sIdx * 100 + tIdx,
        });
      });
    });
  });

  return layers;
}

function App() {
  const t = useT('app');

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // 모바일 세로 방향 고정 (Screen Orientation API — PWA/fullscreen 환경)
  useEffect(() => {
    const lock = window.screen.orientation?.lock;
    if (typeof lock === 'function') {
      window.screen.orientation.lock('portrait').catch(() => {});
    }
  }, []);

  // 캔버스 전체화면 상태 (BIM / TEST 탭)
  const [canvasFullscreen, setCanvasFullscreen] = useState(false);
  const toggleCanvasFullscreen = useCallback(() => setCanvasFullscreen(v => !v), []);

  // BIM 부재 배치/선 작도 모드 — 활성 중 FloatingAgent 숨김
  const [bimPlacementMode, setBimPlacementMode] = useState(false);

  // ESC 키로 전체화면 해제
  useEffect(() => {
    if (!canvasFullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setCanvasFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvasFullscreen]);

  const [viewComponent, setViceComponent] = useState('wbs');

  const [elements, setElements] = useState(null);
  const [selectedElement, setSelectedElement] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [modelData, setModelData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [projectList, setProjectList] = useState([]);
  const [wbsJobState, setWbsJobState] = useState({ projectId: null, status: 'idle' });

  // ── IFC 실제 지오메트리 캐시 (세션 동안 유지, 재렌더링 없음) ───────
  // Map: projectId → IfcMeshData[]
  const ifcMeshesRef = useRef(new Map());

  // ── Simulation projects ───────────────────────────────────────
  const [simulationProjectList, setSimulationProjectList] = useState([]);
  const [selectedSimulationProject, setSelectedSimulationProject] = useState(null);

  // ── Safe projects ─────────────────────────────────────────────
  const [safeProjectList, setSafeProjectList] = useState([]);
  const [selectedSafeProject, setSelectedSafeProject] = useState(null);

  // ── Integration (WBS 프로젝트가 앵커) ──────────────────────────
  const [selectedIntegrationProject, setSelectedIntegrationProject] = useState(null);

  // ── Agent WBS 자동 수정 요청 ──────────────────────────────────
  // { eventType, title, detail, ts, targetProjectId? } — WbsDashboard로 전달되어 자동 수정을 실행한다.
  const [autoEditRequest, setAutoEditRequest] = useState(null);

  // 프로젝트 선택 모달 상태
  const [showWbsProjectSelect, setShowWbsProjectSelect] = useState(false);
  const [pendingWbsEvent, setPendingWbsEvent] = useState(null);

  // 최종 WBS 수정 적용 (targetProjectId 확정 후 호출)
  const applyWbsApprove = useCallback((eventItem, targetProjectId) => {
    setAutoEditRequest({ ...eventItem, targetProjectId, approvedAt: Date.now() });
    setViceComponent('wbs');
  }, []);

  // Agent WBS 팝업 승인 핸들러
  // 1) 이벤트에 projectId가 있으면 연결된 WBS 프로젝트를 역방향 조회
  // 2) 연결된 WBS 프로젝트가 있으면 → 직접 적용
  // 3) 없으면 → 프로젝트 선택 모달 표시
  const handleWbsApprove = useCallback(async (eventItem) => {
    const sourceProjectId = eventItem.projectId;

    if (sourceProjectId) {
      try {
        // 모든 WBS 프로젝트 조회 후 역방향 링크 탐색
        const projRes = await AxiosCustom.get('/api/wbs/projects');
        const wbsProjects = projRes.data || [];

        // 각 WBS 프로젝트의 링크를 병렬 조회
        const linkResults = await Promise.allSettled(
          wbsProjects.map(p =>
            AxiosCustom.get(`/api/project-link/wbs/${p.projectId}`)
              .then(r => ({ project: p, links: r.data || [] }))
          )
        );

        // 소스 프로젝트 ID와 일치하는 링크를 가진 WBS 프로젝트 탐색
        let linkedWbsProject = null;
        for (const result of linkResults) {
          if (result.status !== 'fulfilled') continue;
          const { project, links } = result.value;
          if (links.some(l => l.linkedProjectId === sourceProjectId)) {
            linkedWbsProject = project;
            break;
          }
        }

        if (linkedWbsProject) {
          // 연결된 WBS 프로젝트 발견 → 바로 적용
          applyWbsApprove(eventItem, linkedWbsProject.projectId);
          return;
        }
      } catch {
        // 링크 조회 실패 시 선택 모달로 폴백
      }
    }

    // 연결된 WBS 프로젝트 없음 → 선택 모달 표시
    setPendingWbsEvent(eventItem);
    setShowWbsProjectSelect(true);
  }, [applyWbsApprove]);

  // ── Agent health check ────────────────────────────────────────
  const [agentAvailable, setAgentAvailable] = useState(null);

  // ── 환경설정 탭 TOTP 인증 상태 (페이지 새로고침 시 초기화) ──────
  const [settingsVerified, setSettingsVerified] = useState(false);

  // ── IoT 센서 연결 (앱 수명 동안 유지 → Simulation 탭에 props로 전달) ──
  const { latest: sensorLatest, wsStatus: sensorWsStatus } = SatelliteAPI();

  // ---------------------------------------------------------------
  // Refresh BIM project list
  // ---------------------------------------------------------------
  const refreshProjectList = useCallback(() => {
    return AxiosCustom.get('/api/bim/projects')
      .then(response => {
        setProjectList(response.data);
      })
      .catch(error => {
        console.error('Failed to load project list:', error);
      });
  }, []);

  // ---------------------------------------------------------------
  // Rename BIM project
  // ---------------------------------------------------------------
  const renameProject = useCallback((projectId, newName, callback) => {
    const existingNames = new Set(
      (projectList || []).filter(p => p.projectId !== projectId).map(p => p.projectName)
    );
    let uniqueName = newName;
    let counter = 1;
    const base = newName;
    while (existingNames.has(uniqueName)) uniqueName = `${base} (${counter++})`;

    AxiosCustom.put(`/api/bim/project/${projectId}/name`, { projectName: uniqueName })
      .then(() => {
        setProjectList(prev =>
          prev.map(p => p.projectId === projectId ? { ...p, projectName: uniqueName } : p)
        );
        if (callback) callback(true);
      })
      .catch(error => {
        console.error('Failed to rename project:', error);
        if (callback) callback(false);
      });
  }, [projectList]);

  // ---------------------------------------------------------------
  // Create new BIM project
  // ---------------------------------------------------------------
  const addNewProject = useCallback((type, name, callback) => {
    const base = name || type + ' project';
    const existingNames = new Set((projectList || []).map(p => p.projectName));
    let uniqueName = base;
    let counter = 1;
    while (existingNames.has(uniqueName)) uniqueName = `${base} (${counter++})`;

    AxiosCustom.post('/api/bim/project', {
      structureType: type,
      projectName: uniqueName,
      spanCount: 0,
    })
      .then(() => refreshProjectList())
      .then(() => { if (callback) callback(); })
      .catch(error => {
        console.error('Failed to create project:', error);
        if (callback) callback();
      });
  }, [refreshProjectList, projectList]);

  // ---------------------------------------------------------------
  // Delete BIM project
  // ---------------------------------------------------------------
  const deleteProject = useCallback((projectId) => {
    AxiosCustom.delete(`/api/bim/project/${projectId}`)
      .then(() => {
        setProjectList(prev => prev.filter(p => p.projectId !== projectId));
        if (selectedProject?.projectId === projectId) setSelectedProject(null);
      })
      .catch(error => console.error('Failed to delete project:', error));
  }, [selectedProject]);

  // ---------------------------------------------------------------
  // Convert drone analysis result into a BIM project
  // ---------------------------------------------------------------
  // signature: (type, name, terrainEls, contourBeams, contourLines, callback)
  const convertDroneProject = useCallback(async (type, name, terrainEls, contourBeams, contourLines, callback) => {
    try {
      const existingNames = new Set((projectList || []).map(p => p.projectName));
      let uniqueName = name;
      let counter = 1;
      while (existingNames.has(uniqueName)) uniqueName = `${name} (${counter++})`;

      const projectRes = await AxiosCustom.post('/api/bim/project', {
        structureType: type, projectName: uniqueName, spanCount: 0,
      });
      const project = projectRes.data;
      const pid = project.projectId;
      const newId = () => 'ELEM-' + Math.random().toString(36).substr(2, 9).toUpperCase();

      // 1) 절토/성토 배치 — 드론 프로젝트(DRONE)는 선(Line)으로 대체되므로 terrainEls는 빈 배열
      //    일반 프로젝트에서 IfcSlab 요소가 있을 경우에만 저장
      let terrainIds = [];
      if (terrainEls.length > 0) {
        // _color 필드는 내부 마킹용이므로 API 전송 전 제거
        const payload = terrainEls.map(el => {
          const { _color, ...rest } = el;
          return { ...rest, elementId: newId(), projectId: pid };
        });
        terrainIds = payload.map(e => e.elementId);
        await AxiosCustom.post('/api/bim/elements/batch', payload);

        // 절토(빨강) / 성토(초록) 레이어 분리
        const cutIds  = terrainEls.map((el, i) => el._color === '#ef4444' ? terrainIds[i] : null).filter(Boolean);
        const fillIds = terrainEls.map((el, i) => el._color === '#22c55e' ? terrainIds[i] : null).filter(Boolean);

        if (cutIds.length > 0) {
          await AxiosCustom.post('/api/bim/layer', {
            projectId: pid, layerName: '⛏️ 절토', color: '#ef4444',
            visible: true, elementIds: cutIds, sortOrder: 2,
          });
        }
        if (fillIds.length > 0) {
          await AxiosCustom.post('/api/bim/layer', {
            projectId: pid, layerName: '🚛 성토', color: '#22c55e',
            visible: true, elementIds: fillIds, sortOrder: 3,
          });
        }
      }

      // 2) 등고선 IfcBeam 배치 + 레이어 생성 (지형 위에 렌더링)
      let contourIds = [];
      if (contourBeams.length > 0) {
        const payload = contourBeams.map(el => ({ ...el, elementId: newId(), projectId: pid }));
        contourIds = payload.map(e => e.elementId);
        await AxiosCustom.post('/api/bim/elements/batch', payload);
        await AxiosCustom.post('/api/bim/layer', {
          projectId: pid, layerName: '📐 등고선', color: '#facc15',
          visible: true, elementIds: contourIds, sortOrder: 0,
        });
      }

      // 3) 도면 선 일괄 삽입 (배치 API 사용 — 개별 POST 수백 번 방지)
      if (contourLines.length > 0) {
        const linePayload = contourLines.map(line => ({ ...line, projectId: pid }));
        await AxiosCustom.post('/api/bim/line/batch', linePayload);
      }

      await refreshProjectList();
      if (callback) callback(project);
    } catch (error) {
      console.error('Drone project conversion failed:', error);
      if (callback) callback(null);
    }
  }, [refreshProjectList, projectList]);

  // ---------------------------------------------------------------
  // [WASM A안 — 비활성화] Import BIM project from IFC elements
  // GLB 서버 변환(importIfcProjectServer)으로 전환 완료.
  // ifcMeshes 세션 캐시 경로는 더 이상 사용하지 않음.
  // ---------------------------------------------------------------
  /* const importIfcProject = useCallback(async (type, name, elements, ifcMeshes, geoOrigin, callback, storeys, ifcFile) => {
    try {
      // 이름 중복 시 자동 증가
      const existingNames = new Set((projectList || []).map(p => p.projectName));
      let uniqueName = name;
      let counter = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${name} (${counter++})`;
      }

      const projectRes = await AxiosCustom.post('/api/bim/project', {
        structureType: type,
        projectName: uniqueName,
        spanCount: 0,
        ...(geoOrigin ? {
          geoLatitude:  geoOrigin.latitude,
          geoLongitude: geoOrigin.longitude,
          geoElevation: geoOrigin.elevation,
          ifcOffsetX:   geoOrigin.ifcOffsetX,
          ifcOffsetY:   geoOrigin.ifcOffsetY,
          ifcOffsetZ:   geoOrigin.ifcOffsetZ,
          ifcScale:     geoOrigin.scale,
        } : {}),
      });
      const project = projectRes.data;

      // 부재 일괄 저장 (projectId suffix 적용 — PK 충돌 방지)
      const idMap = {}; // 'IFC-{expressId}' → 최종 elementId
      if (elements.length > 0) {
        const payload = elements.map(el => {
          const newId = `${el.elementId}-${project.projectId}`;
          idMap[el.elementId] = newId;
          return { ...el, projectId: project.projectId, elementId: newId };
        });
        await AxiosCustom.post('/api/bim/elements/batch', payload);
      }

      // 층(BuildingStorey) 저장
      if (storeys && storeys.length > 0) {
        const storeyPayload = storeys.map((s, idx) => ({
          storeyId:   `${project.projectId}-STOREY-${idx}`,
          projectId:  project.projectId,
          storeyName: s.name,
          elevation:  s.elevation ?? null,
          building:   s.building  ?? null,
          sortOrder:  idx,
        }));
        try { await AxiosCustom.post('/api/bim/storeys/batch', storeyPayload); }
        catch (e) { console.warn('층 저장 실패(무시):', e.message); }
      }

      // 레이어 자동 생성 → 레이어 기반 WBS 자동 생성 (층 구조 1:1 일치)
      if (elements.length > 0) {
        try {
          const { generateWbsFromLayers } = await import('./utils/wbsGenerator');
          const renamedElements = elements.map(el => ({
            ...el,
            elementId: idMap[el.elementId] || `${el.elementId}-${project.projectId}`,
          }));
          const layers = generateLayersFromElements(renamedElements, project.projectId);
          if (layers.length > 0) {
            await AxiosCustom.post('/api/bim/layers/batch', layers);
          }
          const { wbsNodes, mappings } = generateWbsFromLayers(layers, project.projectId, renamedElements, {
            storeys:   storeys || [],
            geoOrigin: geoOrigin || null,
            standard:  'KDS',
          });
          if (wbsNodes.length > 0) {
            await AxiosCustom.post('/api/bim/wbs/batch', wbsNodes);
          }
          if (mappings.length > 0) {
            await AxiosCustom.post('/api/bim/element-wbs/batch', mappings);
          }
        } catch (e) {
          console.warn('레이어/WBS 자동 생성 실패(무시):', e.message);
        }
      }

      // IFC 지오메트리 클라이언트 캐시 (DB 미저장)
      if (ifcMeshes && ifcMeshes.length > 0) {
        const renamedMeshes = ifcMeshes.map(mesh => ({
          ...mesh,
          elementId: `${mesh.elementId}-${project.projectId}`,
        }));
        ifcMeshesRef.current.set(project.projectId, renamedMeshes);
      }

      // IFC 원본 파일 Object Storage 업로드 (파싱 성공 후에만, fire-and-forget)
      if (ifcFile && project?.projectId) {
        const formData = new FormData();
        formData.append('file', ifcFile);
        AxiosCustom.post(`/api/bim/project/${project.projectId}/ifc`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
          .then(() => console.log(`[IFC] 원본 파일 업로드 완료: ${project.projectId}`))
          .catch(e => console.warn('[IFC] 원본 파일 업로드 실패(무시):', e?.message));
      }

      await refreshProjectList();
      if (callback) callback(project);
    } catch (error) {
      console.error('IFC import failed:', error);
      if (callback) callback(null);
    }
  }, [refreshProjectList, projectList]); */

  // ---------------------------------------------------------------
  // Import BIM project via server-side IFC → GLB conversion (B안 — 현재 사용)
  // WASM 파싱 없이 IFC 파일을 서버에 업로드 → Python 변환 → GLB + DB 저장
  // ---------------------------------------------------------------
  const importIfcProjectServer = useCallback(async (type, name, ifcFile, callback, userScale = 1) => {
    try {
      const existingNames = new Set((projectList || []).map(p => p.projectName));
      let uniqueName = name;
      let counter = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${name} (${counter++})`;
      }

      // 1. 빈 프로젝트 생성 → projectId 확보
      const projectRes = await AxiosCustom.post('/api/bim/project', {
        structureType: type,
        projectName:   uniqueName,
        spanCount:     0,
      });
      const project = projectRes.data;

      // 2. IFC 업로드 → 서버(Python)에서 변환 + DB 저장
      const formData = new FormData();
      formData.append('file', ifcFile);
      if (userScale && userScale !== 1) formData.append('scale', String(userScale));
      await AxiosCustom.post(
        `/api/bim/project/${project.projectId}/convert-ifc`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 600000 },
      );

      // 3. 변환 후 DB에 저장된 elements 로드
      const elemRes = await AxiosCustom.get(`/api/bim/project/${project.projectId}`);
      const savedElements = elemRes.data ?? [];

      // 4. 에디터를 먼저 연다 (BIM 즉시 표시)
      await refreshProjectList();
      if (callback) callback(project);

      // 5. WBS 생성을 비동기로 처리 (작업계획 탭은 폴링으로 감지)
      if (savedElements.length > 0) {
        setWbsJobState({ projectId: project.projectId, status: 'pending' });
        (async () => {
          try {
            const { generateWbsFromLayers } = await import('./utils/wbsGenerator');

            // Ollama 3B 모델로 층 이름 정규화 (BimElementDTO 필드명은 storey)
            const rawNames = [...new Set(savedElements.map(e => e.storey).filter(Boolean))];
            let normalizedMap = {};
            if (rawNames.length > 0) {
              try {
                const normRes = await AxiosCustom.post('/api/bim/normalize-storeys', { names: rawNames });
                normalizedMap = normRes.data || {};
                console.log('[WBS] Ollama 층 이름 정규화:', normalizedMap);
              } catch (e) {
                console.warn('[WBS] Ollama 정규화 실패, 내부 정규식 폴백으로 진행:', e.message);
              }
            }
            const patchedElements = Object.keys(normalizedMap).length > 0
              ? savedElements.map(e => ({
                  ...e,
                  storey: normalizedMap[e.storey] ?? e.storey,
                }))
              : savedElements;

            const layers = generateLayersFromElements(patchedElements, project.projectId);
            if (layers.length > 0) await AxiosCustom.post('/api/bim/layers/batch', layers);

            const storeyRes = await AxiosCustom.get(`/api/bim/storeys?projectId=${project.projectId}`);
            const storeys = storeyRes.data ?? [];

            const { wbsNodes, mappings } = await generateWbsFromLayers(
              layers, project.projectId, patchedElements,
              {
                storeys, geoOrigin: null, standard: 'KDS',
                axiosPost: (url, data) => AxiosCustom.post(url, data),
              },
            );
            if (wbsNodes.length > 0)  await AxiosCustom.post('/api/bim/wbs/batch', wbsNodes);
            if (mappings.length > 0)  await AxiosCustom.post('/api/bim/element-wbs/batch', mappings);
            setWbsJobState({ projectId: project.projectId, status: 'done' });
          } catch (e) {
            console.warn('레이어/WBS 자동 생성 실패(무시):', e.message);
            setWbsJobState({ projectId: project.projectId, status: 'failed' });
          }
        })();
      }
    } catch (error) {
      console.error('IFC server import failed:', error);
      if (callback) callback(null);
    }
  }, [refreshProjectList, projectList]);

  // ---------------------------------------------------------------
  // Select BIM project → load BIM model data
  // ---------------------------------------------------------------
  function handleProjectSelect(projectData) {
    setSelectedProject(projectData);
    setModelData([]);
    AxiosCustom.get(`/api/bim/project/${projectData.projectId}`)
      .then(response => {
        setModelData(response.data);
      })
      .catch(error => {
        console.error('Failed to load BIM data:', error);
      });
  }

  const handleElementUpdate = (updatedElement) => {
    if (elements) {
      setElements(
        elements.map(el => (el.elementId === updatedElement.elementId ? updatedElement : el))
      );
      setSelectedElement(updatedElement);
    }
  };

  const refreshModelData = useCallback(() => {
    if (!selectedProject) return;
    AxiosCustom.get(`/api/bim/project/${selectedProject.projectId}`)
      .then(response => setModelData(response.data))
      .catch(error => console.error('Failed to refresh model:', error));
  }, [selectedProject]);

  // ---------------------------------------------------------------
  // Refresh simulation project list
  // ---------------------------------------------------------------
  const refreshSimulationProjectList = useCallback(() => {
    return AxiosCustom.get('/api/simulation/projects')
      .then(response => setSimulationProjectList(response.data))
      .catch(error => console.error('Failed to load simulation project list:', error));
  }, []);

  // ---------------------------------------------------------------
  // Create new simulation project
  // ---------------------------------------------------------------
  const addSimulationProject = useCallback((name, callback) => {
    AxiosCustom.post('/api/simulation/project', { projectName: name })
      .then(() => refreshSimulationProjectList())
      .then(() => { if (callback) callback(); })
      .catch(error => {
        console.error('Failed to create simulation project:', error);
        if (callback) callback();
      });
  }, [refreshSimulationProjectList]);

  // ---------------------------------------------------------------
  // Delete simulation project
  // ---------------------------------------------------------------
  const deleteSimulationProject = useCallback((projectId) => {
    AxiosCustom.delete(`/api/simulation/project/${projectId}`)
      .then(() => {
        setSimulationProjectList(prev => prev.filter(p => p.projectId !== projectId));
        if (selectedSimulationProject?.projectId === projectId) setSelectedSimulationProject(null);
      })
      .catch(error => console.error('Failed to delete simulation project:', error));
  }, [selectedSimulationProject]);

  // ---------------------------------------------------------------
  // Rename simulation project
  // ---------------------------------------------------------------
  const renameSimulationProject = useCallback((projectId, newName, callback) => {
    AxiosCustom.put(`/api/simulation/project/${projectId}/name`, { projectName: newName })
      .then(() => {
        setSimulationProjectList(prev =>
          prev.map(p => p.projectId === projectId ? { ...p, projectName: newName } : p)
        );
        if (selectedSimulationProject?.projectId === projectId) {
          setSelectedSimulationProject(prev => ({ ...prev, projectName: newName }));
        }
        if (callback) callback(true);
      })
      .catch(error => {
        console.error('Failed to rename simulation project:', error);
        if (callback) callback(false);
      });
  }, [selectedSimulationProject]);

  // ---------------------------------------------------------------
  // Safe project list management
  // ---------------------------------------------------------------
  const refreshSafeProjectList = useCallback(() => {
    return AxiosCustom.get('/api/safe/projects')
      .then(r => setSafeProjectList(r.data))
      .catch(error => console.error('Failed to load safe project list:', error));
  }, []);

  const createSafeProject = useCallback(async (formData) => {
    const res = await AxiosCustom.post('/api/safe/project', formData);
    await refreshSafeProjectList();
    return res.data; // 생성된 프로젝트 반환 (projectId 포함)
  }, [refreshSafeProjectList]);

  const updateSafeProject = useCallback(async (projectId, formData) => {
    await AxiosCustom.put(`/api/safe/project/${projectId}`, formData);
    setSafeProjectList(prev =>
      prev.map(p => p.projectId === projectId ? { ...p, ...formData } : p)
    );
    if (selectedSafeProject?.projectId === projectId) {
      setSelectedSafeProject(prev => ({ ...prev, ...formData }));
    }
  }, [selectedSafeProject]);

  const deleteSafeProject = useCallback(async (projectId) => {
    await AxiosCustom.delete(`/api/safe/project/${projectId}`);
    setSafeProjectList(prev => prev.filter(p => p.projectId !== projectId));
    if (selectedSafeProject?.projectId === projectId) setSelectedSafeProject(null);
  }, [selectedSafeProject]);

  // Initial load
  useEffect(() => {
    Promise.all([
      refreshProjectList(),
      refreshSimulationProjectList(),
      refreshSafeProjectList(),
    ]).finally(() => setLoading(false));
  }, [refreshProjectList, refreshSimulationProjectList, refreshSafeProjectList]);

  useEffect(() => {
    const check = () =>
      AxiosCustom.get('/api/chat/status')
        .then(() => setAgentAvailable(true))
        .catch(() => setAgentAvailable(false));

    check(); // 최초 즉시 체크
    const id = setInterval(check, 30_000); // 30초마다 재확인
    return () => clearInterval(id);
  }, []);


  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center text-gray-400">
        <div className="text-center">
          <img src={`${process.env.PUBLIC_URL}/logo512.png`} alt="logo" className="mb-4 mx-auto" style={{ width: 96, height: 96, objectFit: 'contain' }} />
          <div className="text-sm">{t('loading')}</div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // View rendering
  // ---------------------------------------------------------------
  const renderView = () => {
    if (viewComponent === 'simulation-projects') {
      return (
        <SimulationProjectList
          setViceComponent={setViceComponent}
          projectList={simulationProjectList}
          onProjectSelect={setSelectedSimulationProject}
          onCreateProject={addSimulationProject}
          onRenameProject={renameSimulationProject}
          onDeleteProject={deleteSimulationProject}
        />
      );
    }
    if (viewComponent === 'simulation') {
      return (
        <SimulationDashboard
          selectedProject={selectedSimulationProject}
          modelData={modelData}
          setViceComponent={setViceComponent}
          sensorLatest={sensorLatest}
          sensorWsStatus={sensorWsStatus}
        />
      );
    }
    if (viewComponent === 'wbs') {
      // WBS 연결 패널에서 "이동" 클릭 시 해당 탭으로 전환
      const handleWbsNavigate = (link) => {
        if (link.linkedType === 'BIM') {
          // BIM 프로젝트로 이동: 목록에서 해당 프로젝트 찾아서 선택
          const found = projectList.find(p => p.projectId === link.linkedProjectId);
          if (found) handleProjectSelect(found);
          setViceComponent('bim');
        } else if (link.linkedType === 'SAFE') {
          const found = safeProjectList.find(p => p.projectId === link.linkedProjectId);
          if (found) setSelectedSafeProject(found);
          setViceComponent('safe');
        } else if (link.linkedType === 'SIMULATION') {
          const found = simulationProjectList.find(p => p.projectId === link.linkedProjectId);
          if (found) setSelectedSimulationProject(found);
          setViceComponent('simulation');
        }
      };
      return (
        <WbsDashboard
          onNavigateToTab={handleWbsNavigate}
          autoEditRequest={autoEditRequest}
          onAutoEditDone={() => setAutoEditRequest(null)}
        />
      );
    }
    if (viewComponent === 'safe-projects') {
      return (
        <SafeProjectList
          setViceComponent={setViceComponent}
          projectList={safeProjectList}
          onProjectSelect={(p) => { setSelectedSafeProject(p); setViceComponent('safe'); }}
          onCreateProject={createSafeProject}
          onUpdateProject={updateSafeProject}
          onDeleteProject={deleteSafeProject}
        />
      );
    }
    if (viewComponent === 'safe') {
      return (
        <SafeDashboard
          selectedProject={selectedSafeProject}
          onBack={() => setViceComponent('safe-projects')}
        />
      );
    }
    if (viewComponent === 'settings') {
      if (!settingsVerified) {
        return <TotpModal onSuccess={() => setSettingsVerified(true)} />;
      }
      return <SettingsPanel />;
    }
    if (viewComponent === 'test') {
      return <TestDashboard canvasFullscreen={canvasFullscreen} onToggleCanvasFullscreen={toggleCanvasFullscreen} />;
    }
    if (viewComponent === 'agent') {
      return (
        <AgentDashboard
          selectedProject={selectedProject}
          onBimUpdate={refreshModelData}
          modelData={modelData}
          selectedSimulationProject={selectedSimulationProject}
          agentAvailable={agentAvailable}
          onOpenSettings={() => setViceComponent('settings')}
        />
      );
    }
    if (viewComponent === 'integration-projects') {
      return (
        <IntegrationProjectList
          setViceComponent={setViceComponent}
          onProjectSelect={setSelectedIntegrationProject}
        />
      );
    }
    if (viewComponent === 'integration') {
      // UI는 IntegrationProvider 블록에서 렌더됨 (항상 살아있는 백그라운드 서비스와 같은 Provider 공유)
      return null;
    }
    if (viewComponent === 'bim') {
      // GLB 서버 변환 방식만 사용 (WASM 세션 캐시 비활성화)
      const currentIfcMeshes = null;
      const glbUrl = selectedProject?.glbStorageKey
        ? `/api/bim/project/${selectedProject.projectId}/glb`
        : null;
      return (
        <BimDashboard
          setViceComponent={setViceComponent}
          elements={elements}
          modelData={modelData}
          setModelData={setModelData}
          selectedProject={selectedProject}
          onConvertDrone={convertDroneProject}
          ifcMeshes={currentIfcMeshes}
          glbUrl={glbUrl}
          canvasFullscreen={canvasFullscreen}
          onToggleCanvasFullscreen={toggleCanvasFullscreen}
          onPlacementModeChange={setBimPlacementMode}
          wbsJobState={wbsJobState}
        />
      );
    }
    if (viewComponent === 'bim-projects') {
      return (
        <BimProjectList
          setViceComponent={setViceComponent}
          projectList={projectList}
          onProjectSelect={handleProjectSelect}
          onCreateProject={addNewProject}
          onRenameProject={renameProject}
          onImportIFC={importIfcProjectServer}
          onConvertDrone={convertDroneProject}
          onDeleteProject={deleteProject}
        />
      );
    }
    if (selectedElement) {
      return (
        <ElementEditPanel
          element={selectedElement}
          onClose={() => setSelectedElement(null)}
          onUpdate={handleElementUpdate}
        />
      );
    }
    return (
      <SatelliteDashboard
        setViceComponent={setViceComponent}
        elements={elements}
        modelData={modelData}
        onProjectSelect={handleProjectSelect}
        projectList={projectList}
      />
    );
  };

  const isWbs         = viewComponent === 'wbs';
  const isIntegration = viewComponent === 'integration' || viewComponent === 'integration-projects';

  return (
    <CrackMonitorProvider>
      {/* 모바일 가로 회전 차단 */}
      <OrientationLockOverlay />

      <div className={
        canvasFullscreen
          ? "fixed inset-0 z-40 bg-space-900 text-gray-200 flex flex-col"
          : (isWbs || isIntegration)
            ? "h-screen flex flex-col bg-space-900 text-gray-200 overflow-hidden"
            : "min-h-screen bg-space-900 text-gray-200"
      }>
        {/* 캔버스 전체화면 모드에서는 헤더 숨김 */}
        {!canvasFullscreen && (
          <Header viewComponent={viewComponent} setViceComponent={setViceComponent} agentAvailable={agentAvailable} />
        )}

        {/* 통합관제 백그라운드 서비스: 프로젝트 선택 후 항상 유지 (탭 이탈해도 유지) */}
        {selectedIntegrationProject && (
          <IntegrationProvider projectId={selectedIntegrationProject.projectId}>
            <IntegrationServices selectedProject={selectedIntegrationProject} />
            {viewComponent === 'integration' && <IntegrationUI />}
          </IntegrationProvider>
        )}

        <main className={
          canvasFullscreen
            ? "flex-1 min-h-0 flex flex-col overflow-hidden"
            : (isWbs || isIntegration)
              ? "flex-1 min-h-0 flex flex-col overflow-hidden"
              : "w-full px-2 sm:px-4 py-4 sm:py-6 pb-4 sm:pb-6 overflow-x-hidden"
        }>
          {renderView()}
        </main>

        {!canvasFullscreen && viewComponent !== 'wbs' && viewComponent !== 'bim' && viewComponent !== 'integration' && viewComponent !== 'integration-projects' && <Footer />}

        {/* 에이전트: 전체화면·배치모드·agent·wbs·bim·integration 탭에서는 숨김 */}
        {!canvasFullscreen && !bimPlacementMode && viewComponent !== 'agent' && viewComponent !== 'wbs' && viewComponent !== 'bim' && viewComponent !== 'integration' && viewComponent !== 'integration-projects' && (
          <FloatingAgent
            viewComponent={viewComponent}
            selectedProject={selectedProject}
            selectedSimulationProject={selectedSimulationProject}
            selectedSafeProject={selectedSafeProject}
          />
        )}

        <AgentWbsPopup onApprove={handleWbsApprove} />

        {showWbsProjectSelect && pendingWbsEvent && (
          <WbsProjectSelectModal
            eventItem={pendingWbsEvent}
            onSelect={(project) => {
              setShowWbsProjectSelect(false);
              applyWbsApprove(pendingWbsEvent, project.projectId);
              setPendingWbsEvent(null);
            }}
            onClose={() => {
              setShowWbsProjectSelect(false);
              setPendingWbsEvent(null);
            }}
          />
        )}
      </div>
    </CrackMonitorProvider>
  );
}

export default App;