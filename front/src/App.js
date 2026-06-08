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
import IntegrationDashboard from './view/integration/IntegrationDashboard';
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
    AxiosCustom.put(`/api/bim/project/${projectId}/name`, { projectName: newName })
      .then(() => {
        setProjectList(prev =>
          prev.map(p => p.projectId === projectId ? { ...p, projectName: newName } : p)
        );
        if (callback) callback(true);
      })
      .catch(error => {
        console.error('Failed to rename project:', error);
        if (callback) callback(false);
      });
  }, []);

  // ---------------------------------------------------------------
  // Create new BIM project
  // ---------------------------------------------------------------
  const addNewProject = useCallback((type, name, callback) => {
    AxiosCustom.post('/api/bim/project', {
      structureType: type,
      projectName: name || type + ' project',
      spanCount: 0,
    })
      .then(() => refreshProjectList())
      .then(() => { if (callback) callback(); })
      .catch(error => {
        console.error('Failed to create project:', error);
        if (callback) callback();
      });
  }, [refreshProjectList]);

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
  // Import BIM project from IFC elements
  // ifcMeshes: 실제 Three.js 지오메트리 (클라이언트 캐시, DB 미저장)
  // ---------------------------------------------------------------
  const importIfcProject = useCallback(async (type, name, elements, ifcMeshes, callback) => {
    try {
      // 이름 중복 시 자동 증가: "이름" → "이름 (1)" → "이름 (2)"
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
      });
      const project = projectRes.data;

      if (elements.length > 0) {
        // projectId를 suffix로 붙여 동일 IFC 파일을 여러 프로젝트에 임포트해도 PK 충돌 방지
        const payload = elements.map(el => ({
          ...el,
          projectId: project.projectId,
          elementId: `${el.elementId}-${project.projectId}`,
        }));
        await AxiosCustom.post('/api/bim/elements/batch', payload);
      }

      // IFC 실제 지오메트리를 클라이언트 캐시에 저장 (DB 미저장)
      // DB elementId와 동일한 suffix를 ifcMeshes에도 적용해 IFCMeshGroup 매칭 유지
      if (ifcMeshes && ifcMeshes.length > 0) {
        const renamedMeshes = ifcMeshes.map(mesh => ({
          ...mesh,
          elementId: `${mesh.elementId}-${project.projectId}`,
        }));
        ifcMeshesRef.current.set(project.projectId, renamedMeshes);
      }

      await refreshProjectList();
      if (callback) callback(project);
    } catch (error) {
      console.error('IFC import failed:', error);
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
      return (
        <IntegrationDashboard
          selectedProject={selectedIntegrationProject}
          onBack={() => setViceComponent('integration-projects')}
        />
      );
    }
    if (viewComponent === 'bim') {
      // IFC 세션 캐시에서 현재 프로젝트의 실제 지오메트리 조회
      const currentIfcMeshes = selectedProject
        ? (ifcMeshesRef.current.get(selectedProject.projectId) ?? null)
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
          canvasFullscreen={canvasFullscreen}
          onToggleCanvasFullscreen={toggleCanvasFullscreen}
          onPlacementModeChange={setBimPlacementMode}
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
          onImportIFC={importIfcProject}
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
