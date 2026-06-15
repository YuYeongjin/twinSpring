import { useEffect, useMemo, useRef, useState } from 'react';
import SockJS                              from 'sockjs-client';
import { Client }                          from '@stomp/stompjs';
import AxiosCustom                          from '../../axios/AxiosCustom';
import { IntegrationProvider,
         useIntegration,
         useIntegrationDispatch }            from './IntegrationStore';
import IntegrationScene                from './component/IntegrationScene';
import IntegrationDashboardPanel       from './component/IntegrationDashboardPanel';
import IntegrationEventLog             from './component/IntegrationEventLog';
import WbsProgressPanel                from './component/WbsProgressPanel';
import ControlSidebar                  from './component/ControlSidebar';
import DailyReport                     from './component/DailyReport';
import { useT }                        from '../../i18n/LanguageContext';
import { calcProgressRate, calcRealTimeProgress, RECALC_INTERVAL_MS } from './progressEngine';

// ── GPS WebSocket 구독 (장비·작업자 ID별 개별 토픽) ────────────────
function GpsLoader() {
  const { equipment, workers, gpsMode, referencePoint } = useIntegration();
  const dispatch    = useIntegrationDispatch();
  const equipRef    = useRef(equipment);
  const workerRef   = useRef(workers);
  const refPointRef = useRef(referencePoint);

  useEffect(() => { equipRef.current    = equipment;      }, [equipment]);
  useEffect(() => { workerRef.current   = workers;        }, [workers]);
  useEffect(() => { refPointRef.current = referencePoint; }, [referencePoint]);

  // 장비: GPS 모드이면서 deviceId 있는 것 / 작업자: gpsMode ON + deviceId 있는 것
  const equipDeviceIds  = [...new Set(
    equipment.filter(e => e.mode === 'gps' && e.gpsDeviceId).map(e => e.gpsDeviceId)
  )];
  const workerDeviceIds = [...new Set(
    gpsMode
      ? workers.filter(w => w.gpsDeviceId).map(w => w.gpsDeviceId)
      : []
  )];
  const allIds    = [...new Set([...equipDeviceIds, ...workerDeviceIds])];
  const allIdsKey = allIds.join(',');

  useEffect(() => {
    if (allIds.length === 0) return;

    function buildWsUrl() {
      if (process.env.REACT_APP_API_URL)
        return `${process.env.REACT_APP_API_URL.replace(/\/$/, '')}/ws/sensor`;
      if (process.env.NODE_ENV === 'development')
        return `${window.location.protocol}//${window.location.hostname}:8080/ws/sensor`;
      return `${window.location.origin}/ws/sensor`;
    }

    function handleMsg(deviceId, msg) {
      try {
        const data = JSON.parse(msg.body);
        if (data.lat == null || data.lng == null) return;
        const { lat: refLat, lng: refLng } = refPointRef.current;
        const x = (data.lng - refLng) * 111320 * Math.cos(refLat * Math.PI / 180);
        const z = -(data.lat - refLat) * 110540;
        const pos = [x, 0, z];
        // 장비 위치 갱신
        equipRef.current
          .filter(e => e.mode === 'gps' && e.gpsDeviceId === deviceId)
          .forEach(e => dispatch({ type: 'SET_EQUIP_GPS_POS', id: e.id, pos }));
        // 작업자 위치 갱신
        workerRef.current
          .filter(w => w.gpsDeviceId === deviceId)
          .forEach(w => dispatch({ type: 'SET_WORKER_GPS_POS', id: w.id, pos }));
      } catch { /* parse 실패 무시 */ }
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(buildWsUrl()),
      reconnectDelay: 5000,
      onConnect: () => {
        allIds.forEach(deviceId => {
          client.subscribe(`/topic/gps/${deviceId}`, msg => handleMsg(deviceId, msg));
        });
      },
    });
    client.activate();
    return () => { client.deactivate(); };
  }, [allIdsKey, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ── 실제 API 데이터를 로드하는 내부 컴포넌트 ───────────────
function DataLoader({ selectedProject }) {
  const dispatch = useIntegrationDispatch();

  useEffect(() => {
    if (!selectedProject?.projectId) return;

    dispatch({ type: 'SET_LOADING', value: true });

    async function load() {
      try {
        const { wbsProjectId, bimProjectId } = selectedProject;

        let wbsTasks = [];
        if (wbsProjectId) {
          try {
            const tasksRes = await AxiosCustom.get(`/api/wbs/project/${wbsProjectId}/tasks`);
            wbsTasks = tasksRes.data || [];
          } catch {
            // WBS 로드 실패 무시
          }
        }

        let bimElements = [];
        if (bimProjectId) {
          try {
            const bimRes = await AxiosCustom.get(`/api/bim/project/${bimProjectId}`);
            bimElements = Array.isArray(bimRes.data) ? bimRes.data : [];
          } catch {
            // BIM 로드 실패 무시
          }
        }

        const linkedProjects = [
          ...(wbsProjectId ? [{ linkedType: 'WBS', linkedProjectId: wbsProjectId }] : []),
          ...(bimProjectId ? [{ linkedType: 'BIM', linkedProjectId: bimProjectId }] : []),
        ];

        dispatch({ type: 'SET_REAL_DATA', linkedProjects, wbsTasks, bimElements });
      } catch {
        dispatch({ type: 'SET_LOADING', value: false });
      }
    }

    load();
  }, [selectedProject, dispatch]);

  // WBS 태스크 진도 주기 갱신 (30초)
  // WBS 탭에서 진도를 수정하면 통합 관제 BIM 채우기에 자동 반영됨
  useEffect(() => {
    const wbsProjectId = selectedProject?.wbsProjectId;
    if (!wbsProjectId) return;

    const refreshWbs = async () => {
      try {
        const r = await AxiosCustom.get(`/api/wbs/project/${wbsProjectId}/tasks`);
        dispatch({ type: 'SET_REAL_DATA', wbsTasks: r.data || [] });
      } catch { /* 갱신 실패 무시 */ }
    };

    const id = setInterval(refreshWbs, 30000);
    return () => clearInterval(id);
  }, [selectedProject?.wbsProjectId, dispatch]);

  // BIM 태스크 진도 실시간 자동 증가 (10초 주기)
  // notes = "BIM:<projectId>:<elementType>" 형식인 태스크만 대상
  const { wbsTasks, workers, equipment } = useIntegration();
  const liveRef = useRef({ wbsTasks, workers, equipment });
  useEffect(() => { liveRef.current = { wbsTasks, workers, equipment }; }, [wbsTasks, workers, equipment]);

  useEffect(() => {
    // CPM 공종 진행 순서 (이 순서대로 하나씩 완료 후 다음 공종 진행)
    const CPM_ORDER = ['IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcWall', 'IfcPier'];

    const tick = () => {
      const { wbsTasks: tasks, workers: ws, equipment: eq } = liveRef.current;

      // BIM 루트 태스크별로 CPM 순차 처리
      const rootTasks = tasks.filter(t => /^BIM:[^:]+:ROOT$/.test(t.notes || ''));

      rootTasks.forEach(rootTask => {
        const bimId = (rootTask.notes || '').split(':')[1];
        if (!bimId) return;

        // 공종 태스크 (CPM 순서 정렬, ROOT 제외)
        const elemTasks = tasks
          .filter(t => {
            const m = (t.notes || '').match(/^BIM:([^:]+):([^:]+)$/);
            return m && m[1] === bimId && m[2] !== 'ROOT';
          })
          .sort((a, b) => {
            const ia = CPM_ORDER.indexOf((a.notes || '').split(':')[2]);
            const ib = CPM_ORDER.indexOf((b.notes || '').split(':')[2]);
            return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
          });

        if (elemTasks.length === 0) {
          // ── FLOOR:<n>:FRAME/SLAB 형식 처리 (generateFloorWbsTasks 가 생성하는 층별 구조) ──
          const floorTasks = tasks
            .filter(t => {
              const m = (t.notes || '').match(/^BIM:([^:]+):FLOOR:(\d+):(FRAME|SLAB)$/);
              return m && m[1] === bimId;
            })
            .sort((a, b) => {
              const ma = (a.notes || '').match(/^BIM:[^:]+:FLOOR:(\d+):(FRAME|SLAB)$/);
              const mb = (b.notes || '').match(/^BIM:[^:]+:FLOOR:(\d+):(FRAME|SLAB)$/);
              const ia = ma ? parseInt(ma[1]) * 2 + (ma[2] === 'SLAB' ? 1 : 0) : 999;
              const ib = mb ? parseInt(mb[1]) * 2 + (mb[2] === 'SLAB' ? 1 : 0) : 999;
              return ia - ib;
            });

          if (floorTasks.length > 0) {
            // 순차 진행: 이전 층 완료 후 다음 층 시작 (FRAME → SLAB → 다음층 FRAME → ...)
            const activeFloor = floorTasks.find(t => (t.progress || 0) < 100);
            if (!activeFloor) {
              dispatch({ type: 'SET_TASK_PROGRESS', taskId: rootTask.taskId, progress: 100 });
              return;
            }
            const floorType = (activeFloor.notes || '').match(/:(FRAME|SLAB)$/)?.[1];
            // FRAME은 crane, SLAB은 excavator+dump 필요 — 없으면 달력 기반 rate=1.0
            const reprType = floorType === 'FRAME' ? 'IfcColumn' : 'IfcSlab';
            const { rate, blocked } = calcProgressRate(reprType, ws, eq);
            const effectiveRate = blocked ? 1.0 : rate; // 장비 없어도 달력 기반으로는 진행
            const p = calcRealTimeProgress(activeFloor, effectiveRate);
            if (p !== null) dispatch({ type: 'SET_TASK_PROGRESS', taskId: activeFloor.taskId, progress: p });

            const rootProg = floorTasks.reduce((s, t) => s + (t.progress || 0), 0) / floorTasks.length;
            dispatch({ type: 'SET_TASK_PROGRESS', taskId: rootTask.taskId, progress: rootProg });
            return;
          }

          // ── PLAN:<i> 형식 태스크 처리 (generateBimWbsTasks 가 생성하는 공사 단계별 구조) ──
          const planTasks = tasks
            .filter(t => /^BIM:[^:]+:PLAN:\d+$/.test(t.notes || '') && (t.notes || '').split(':')[1] === bimId)
            .sort((a, b) => {
              const ia = parseInt((a.notes || '').split(':')[3] || '0');
              const ib = parseInt((b.notes || '').split(':')[3] || '0');
              return ia - ib;
            });

          if (planTasks.length === 0) return;

          // 순차 진행: 이전 태스크 100% 후 다음 태스크 시작
          const activePlan = planTasks.find(t => (t.progress || 0) < 100);
          if (!activePlan) {
            dispatch({ type: 'SET_TASK_PROGRESS', taskId: rootTask.taskId, progress: 100 });
            return;
          }

          // 달력 시간 기반 진도 계산 (startDate/endDate 기준)
          const p = calcRealTimeProgress(activePlan, 1.0);
          if (p !== null) dispatch({ type: 'SET_TASK_PROGRESS', taskId: activePlan.taskId, progress: p });

          const rootProg = planTasks.reduce((s, t) => s + (t.progress || 0), 0) / planTasks.length;
          dispatch({ type: 'SET_TASK_PROGRESS', taskId: rootTask.taskId, progress: rootProg });
          return;
        }

        // CPM 순서로 첫 번째 미완료 공종만 진행 (이전 공종이 100% 되어야 다음 시작)
        const activeElem = elemTasks.find(t => (t.progress || 0) < 100);
        if (!activeElem) {
          dispatch({ type: 'SET_TASK_PROGRESS', taskId: rootTask.taskId, progress: 100 });
          return;
        }

        const elementType = (activeElem.notes || '').split(':')[2];
        const { rate, blocked } = calcProgressRate(elementType, ws, eq);

        if (!blocked && rate > 0) {
          // 세부 공정 태스크 (sortOrder 순 — 터파기→버림콘크리트→거푸집→...)
          const subTasks = tasks
            .filter(t => t.parentTaskId === activeElem.taskId)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

          if (subTasks.length === 0) {
            // 세부 공정 없을 때 공종 직접 진행
            const p = calcRealTimeProgress(activeElem, rate);
            if (p !== null) dispatch({ type: 'SET_TASK_PROGRESS', taskId: activeElem.taskId, progress: p });
          } else {
            // 첫 번째 미완료 세부 공정에만 진도 적용
            const activeSub = subTasks.find(t => (t.progress || 0) < 100);
            if (activeSub) {
              const p = calcRealTimeProgress(activeSub, rate);
              if (p !== null) dispatch({ type: 'SET_TASK_PROGRESS', taskId: activeSub.taskId, progress: p });
            }

            // 공종 진도 = (완료 세부공정 수 + 현재 세부공정 비율) / 전체 세부공정 수
            const doneSubs = subTasks.filter(t => (t.progress || 0) >= 100).length;
            const curSubProg = activeSub ? Math.min(100, activeSub.progress || 0) : 0;
            const elemProg = ((doneSubs + curSubProg / 100) / subTasks.length) * 100;
            dispatch({ type: 'SET_TASK_PROGRESS', taskId: activeElem.taskId, progress: Math.min(100, elemProg) });
          }
        }

        // 루트 진도 = 공종 진도 평균
        const rootProg = elemTasks.reduce((s, t) => s + (t.progress || 0), 0) / elemTasks.length;
        dispatch({ type: 'SET_TASK_PROGRESS', taskId: rootTask.taskId, progress: rootProg });
      });

      // 활동 중인 장비 누적 시간 갱신
      dispatch({ type: 'TICK_EQUIP_ACTIVE', equipment: eq, intervalSec: RECALC_INTERVAL_MS / 1000 });
    };
    const id = setInterval(tick, RECALC_INTERVAL_MS);
    tick();
    return () => clearInterval(id);
  }, [dispatch]);

  return null;
}

// ── project_link 기반 BIM 구조물 자동 동기화 ──────────────────
// WBS탭에서 BIM을 추가하면 통합관제에도 자동으로 구조물이 추가됨
function BimLinkSync({ selectedProject }) {
  const { structures, projectMeta } = useIntegration();
  const dispatch = useIntegrationDispatch();
  const syncedRef = useRef(false);

  useEffect(() => {
    syncedRef.current = false;
  }, [selectedProject?.projectId]);

  useEffect(() => {
    const wbsProjectId = projectMeta?.wbsProjectId;
    if (!wbsProjectId || syncedRef.current) return;
    // structures 로드가 완료된 후 한 번만 실행
    syncedRef.current = true;

    async function syncBimLinks() {
      try {
        const res = await AxiosCustom.get(`/api/project-link/wbs/${wbsProjectId}`);
        const bimLinks = (res.data || []).filter(l => l.linkedType === 'BIM');
        for (const link of bimLinks) {
          const alreadyInScene = structures.some(
            s => s.type === 'bim' && String(s.bimProjectId) === String(link.linkedProjectId)
          );
          if (alreadyInScene) continue;
          // 씬에 없는 BIM 프로젝트를 자동으로 추가
          try {
            const bimRes = await AxiosCustom.get(`/api/bim/project/${link.linkedProjectId}`);
            dispatch({
              type: 'ADD_STRUCTURE',
              structure: {
                id:           `s_${Date.now()}_${link.linkedProjectId}`,
                name:         link.linkedProjectName || `BIM ${link.linkedProjectId}`,
                type:         'bim',
                bimProjectId: link.linkedProjectId,
                elements:     bimRes.data || [],
                offset:       [0, 0, 0],
                visible:      true,
              },
            });
          } catch { /* BIM 로드 실패 — 무시 */ }
        }
      } catch { /* project_link 조회 실패 — 무시 */ }
    }

    syncBimLinks();
  }, [projectMeta?.wbsProjectId, structures, dispatch]);

  return null;
}

// ── BIM WBS 진척도 폴링 (통합관제 3D 시각화용) ─────────────────────
function BimWbsProgressPoller() {
  const { structures } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const bimProjectIds = useMemo(
    () => [...new Set(
      structures
        .filter(s => s.type === 'bim' && s.bimProjectId)
        .map(s => String(s.bimProjectId))
    )],
    [structures],
  );
  const idsKey = bimProjectIds.join(',');

  useEffect(() => {
    if (bimProjectIds.length === 0) return;

    const poll = async () => {
      for (const id of bimProjectIds) {
        try {
          const r = await AxiosCustom.get(`/api/bim/wbs/progress-summary?projectId=${id}`);
          dispatch({ type: 'SET_BIM_WBS_PROGRESS', bimProjectId: id, data: r.data });
        } catch { /* 갱신 실패 무시 */ }
      }
    };

    poll();
    const timer = setInterval(poll, 30000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, dispatch]);

  return null;
}

// ── BIM 구조물 elements 자동 로더 ──────────────────────────
function StructureLoader() {
  const { structures } = useIntegration();
  const dispatch = useIntegrationDispatch();

  useEffect(() => {
    const pending = structures.filter(s => s.type === 'bim' && s.elements === null && s.bimProjectId);
    pending.forEach(async (s) => {
      try {
        const res = await AxiosCustom.get(`/api/bim/project/${s.bimProjectId}`);
        dispatch({ type: 'SET_STRUCTURE_ELEMENTS', id: s.id, elements: res.data || [] });
      } catch {
        dispatch({ type: 'SET_STRUCTURE_ELEMENTS', id: s.id, elements: [] });
      }
    });
  }, [structures, dispatch]);

  return null;
}

// ── 드래그 리사이즈 핸들 ────────────────────────────────────
function ResizeHandle({ onMouseDown, onTouchStart, side = 'left' }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 8, flexShrink: 0, cursor: 'col-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', touchAction: 'none', zIndex: 10,
        order: side === 'right' ? -1 : undefined,
      }}
    >
      <div style={{
        width: 3,
        height: hovered ? 64 : 48,
        borderRadius: 2,
        background: '#3b82f6',
        opacity: hovered ? 1 : 0.3,
        transition: 'opacity 0.15s, height 0.15s',
      }} />
    </div>
  );
}

// ── 개발 중 배너 ────────────────────────────────────────────
function DevBanner({ isMobile }) {
  const t = useT('integrationProject');
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div style={{
      position: 'absolute',
      // 모바일: 네비바(46px) 아래에 표시, 데스크톱: 우상단
      top: isMobile ? 54 : 12,
      left: isMobile ? 8 : undefined,
      right: isMobile ? 8 : 12,
      zIndex: 11,
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      background: '#1a1200cc',
      border: '1px solid #d97706',
      borderRadius: 8,
      padding: '5px 10px 5px 12px',
      fontSize: 10,
      color: '#fbbf24',
      fontWeight: 700,
      backdropFilter: 'blur(6px)',
      whiteSpace: 'nowrap',
    }}>
      {t('devBanner')}
      <button
        onClick={() => setClosed(true)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#92400e', fontSize: 11, padding: '0 2px', lineHeight: 1,
          fontWeight: 900,
        }}
      >✕</button>
    </div>
  );
}

const PANEL_BTN = {
  background: '#0d1b2acc',
  border: '1px solid #1e3a5f',
  borderRadius: 10,
  padding: '7px 13px',
  fontSize: 16,
  color: '#60a5fa',
  backdropFilter: 'blur(4px)',
  cursor: 'pointer',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 40,
  minHeight: 40,
};

// ── 메인 대시보드 레이아웃 ─────────────────────────────────
function DashboardLayout() {
  const t = useT('integrationProject');
  const { projectMeta } = useIntegration();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showPanel,   setShowPanel]   = useState(false); // 오른쪽 대시보드
  const [showSidebar, setShowSidebar] = useState(false); // 왼쪽 컨트롤
  const [showReport,  setShowReport]  = useState(false); // 작업일보

  // 사이드바 / 우측 패널 드래그 리사이즈
  const [sidebarWidth,    setSidebarWidth]    = useState(260);
  const [rightPanelWidth, setRightPanelWidth] = useState(290);
  const sidebarDragging    = useRef(false);
  const rightDragging      = useRef(false);
  const sidebarContainerRef  = useRef(null);
  const rightContainerRef    = useRef(null);
  const layoutContainerRef   = useRef(null);

  const makeDragHandler = (draggingRef, setter, getWidth) => (e) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      if (!draggingRef.current) return;
      const clientX = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
      setter(Math.min(480, Math.max(200, getWidth(clientX))));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  };

  const handleSidebarDragStart = makeDragHandler(
    sidebarDragging, setSidebarWidth,
    (clientX) => {
      if (!sidebarContainerRef.current) return sidebarWidth;
      return clientX - sidebarContainerRef.current.getBoundingClientRect().left;
    }
  );

  const handleRightDragStart = makeDragHandler(
    rightDragging, setRightPanelWidth,
    (clientX) => {
      if (!rightContainerRef.current) return rightPanelWidth;
      return rightContainerRef.current.getBoundingClientRect().right - clientX;
    }
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // ESC 키로 열린 패널 닫기
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setShowPanel(false); setShowSidebar(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeAll = () => { setShowPanel(false); setShowSidebar(false); };

  const mobileAnyOpen = isMobile && (showPanel || showSidebar);

  return (
    <div
      ref={layoutContainerRef}
      style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden', background: '#060f18', position: 'relative' }}
    >

      {/* 데스크톱: 왼쪽 리사이즈 사이드바 */}
      {!isMobile && (
        <div
          ref={sidebarContainerRef}
          style={{ width: sidebarWidth, flexShrink: 0, display: 'flex', position: 'relative' }}
        >
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <ControlSidebar />
          </div>
          <ResizeHandle onMouseDown={handleSidebarDragStart} onTouchStart={handleSidebarDragStart} />
        </div>
      )}

      {/* 3D 씬 */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 0 }}>
        <IntegrationScene />

        {/* 모바일: 상단 통합 네비바 */}
        {isMobile && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 11,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px',
            background: '#060f18cc',
            borderBottom: '1px solid #111e2d',
            backdropFilter: 'blur(6px)',
            minHeight: 46,
          }}>
            {/* 프로젝트명 (줄임) */}
            <div style={{
              flex: 1, minWidth: 0,
              fontSize: 11, color: '#60a5fa', fontWeight: 700,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              🔗 {projectMeta?.projectName || t('pageTitle')}
            </div>
            {/* 작업일보 */}
            <button
              onClick={() => setShowReport(true)}
              style={{
                background: '#0d1b2acc', border: '1px solid #1e3a5f', borderRadius: 8,
                padding: '5px 9px', fontSize: 10, color: '#93c5fd', fontWeight: 700,
                cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {t('dailyReportBtn')}
            </button>
            {/* 사이드바 토글 */}
            <button
              onClick={() => { setShowSidebar(v => !v); setShowPanel(false); }}
              style={{ ...PANEL_BTN, color: showSidebar ? '#22c55e' : '#60a5fa', padding: '6px 10px', fontSize: 15 }}
            >⚙</button>
            {/* 우측 패널 토글 */}
            <button
              onClick={() => { setShowPanel(v => !v); setShowSidebar(false); }}
              style={{ ...PANEL_BTN, color: showPanel ? '#22c55e' : '#60a5fa', padding: '6px 10px', fontSize: 15 }}
            >📊</button>
          </div>
        )}

        {/* 데스크톱: 프로젝트명 배지 + 작업일보 버튼 */}
        {!isMobile && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 8, zIndex: 5,
          }}>
            <div style={{
              background: '#0d1b2acc', border: '1px solid #1e3a5f', borderRadius: 20,
              padding: '4px 18px', fontSize: 11, color: '#60a5fa', fontWeight: 700,
              pointerEvents: 'none', whiteSpace: 'nowrap', backdropFilter: 'blur(4px)',
            }}>
              🔗 {projectMeta?.projectName || t('pageTitle')} · BIM · WBS
            </div>
            <button
              onClick={() => setShowReport(true)}
              style={{
                background: '#0d1b2acc', border: '1px solid #1e3a5f', borderRadius: 20,
                padding: '4px 14px', fontSize: 11, color: '#93c5fd', fontWeight: 700,
                cursor: 'pointer', backdropFilter: 'blur(4px)', whiteSpace: 'nowrap',
              }}
            >
              {t('dailyReportBtn')}
            </button>
          </div>
        )}

        {/* 개발중 배너 — 데스크톱: 우상단 / 모바일: 네비바 아래 */}
        <DevBanner isMobile={isMobile} />

        {/* 힌트 */}
        <div style={{ position: 'absolute', bottom: 10, left: 10, fontSize: 9, color: '#374151', pointerEvents: 'none' }}>
          {t('overlayHint')}
        </div>
      </div>

      {/* 딤 오버레이 (모바일, 패널 열렸을 때) */}
      {mobileAnyOpen && (
        <div
          onClick={closeAll}
          style={{
            position: 'absolute', inset: 0, background: 'rgba(3,10,20,0.65)',
            zIndex: 19, backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* 모바일: 왼쪽 ControlSidebar 오버레이 (네비바 아래부터) */}
      {isMobile && showSidebar && (
        <div style={{
          position: 'absolute', top: 46, left: 0,
          width: 'min(82vw, 280px)', height: 'calc(100% - 46px)',
          zIndex: 20, overflow: 'hidden',
        }} className="bim-panel-left">
          <ControlSidebar />
        </div>
      )}

      {/* 데스크톱: 오른쪽 리사이즈 패널 / 모바일: 오버레이 */}
      {(!isMobile || showPanel) && (
        <div
          ref={!isMobile ? rightContainerRef : undefined}
          className={isMobile ? 'bim-panel-right' : undefined}
          style={isMobile ? {
            position: 'absolute', top: 46, right: 0,
            width: 'min(88vw, 320px)', height: 'calc(100% - 46px)',
            zIndex: 20, background: '#0a1525',
            borderLeft: '1px solid #111e2d',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          } : {
            width: rightPanelWidth, flexShrink: 0, background: '#0a1525',
            borderLeft: '1px solid #111e2d',
            display: 'flex', overflow: 'hidden',
          }}
        >
          {/* 데스크톱: 좌측 드래그 핸들 */}
          {!isMobile && (
            <ResizeHandle
              onMouseDown={handleRightDragStart}
              onTouchStart={handleRightDragStart}
              side="right"
            />
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <IntegrationDashboardPanel />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid #111e2d' }}>
              <IntegrationEventLog />
            </div>
            <WbsProgressPanel />
          </div>
        </div>
      )}

      {/* 작업일보 모달 */}
      {showReport && <DailyReport onClose={() => setShowReport(false)} />}

    </div>
  );
}

// ── 백그라운드 서비스 (IntegrationProvider 안에서 실행) ─────────
// App.js에서 IntegrationProvider로 감싼 뒤 이 컴포넌트를 항상 렌더한다.
// → 시뮬 타이머·DB 저장·WBS 폴링이 탭을 벗어나도 중단되지 않음.
export function IntegrationServices({ selectedProject }) {
  return (
    <>
      <DataLoader selectedProject={selectedProject} />
      <StructureLoader />
      <BimWbsProgressPoller />
      <BimLinkSync selectedProject={selectedProject} />
      <GpsLoader />
    </>
  );
}

// ── UI 진입점 (통합관제 탭 활성화 시만 렌더) ───────────────────
// IntegrationProvider 없이 useIntegration 컨텍스트를 그대로 사용.
export function IntegrationUI() {
  return <DashboardLayout />;
}

// ── 레거시 default export (단독 실행 시 호환) ──────────────────
export default function IntegrationDashboard({ selectedProject }) {
  return (
    <IntegrationProvider projectId={selectedProject?.projectId}>
      <DataLoader selectedProject={selectedProject} />
      <StructureLoader />
      <BimWbsProgressPoller />
      <BimLinkSync selectedProject={selectedProject} />
      <GpsLoader />
      <DashboardLayout />
    </IntegrationProvider>
  );
}
