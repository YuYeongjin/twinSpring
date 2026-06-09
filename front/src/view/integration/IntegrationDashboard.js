import { useEffect, useRef, useState } from 'react';
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
import { useT }                        from '../../i18n/LanguageContext';

// ── GPS WebSocket 구독 (장비 ID별 개별 토픽) ────────────────
function GpsLoader() {
  const { equipment, referencePoint } = useIntegration();
  const dispatch    = useIntegrationDispatch();
  const equipRef    = useRef(equipment);
  const refPointRef = useRef(referencePoint);

  useEffect(() => { equipRef.current    = equipment;      }, [equipment]);
  useEffect(() => { refPointRef.current = referencePoint; }, [referencePoint]);

  // GPS 모드이면서 deviceId 가 설정된 장비 → 고유 ID 목록
  const deviceIds = [...new Set(
    equipment.filter(e => e.mode === 'gps' && e.gpsDeviceId).map(e => e.gpsDeviceId)
  )];
  const deviceIdsKey = deviceIds.join(',');

  useEffect(() => {
    if (deviceIds.length === 0) return;

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
        equipRef.current
          .filter(e => e.mode === 'gps' && e.gpsDeviceId === deviceId)
          .forEach(e => dispatch({ type: 'SET_EQUIP_GPS_POS', id: e.id, pos }));
      } catch { /* parse 실패 무시 */ }
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(buildWsUrl()),
      reconnectDelay: 5000,
      onConnect: () => {
        // 각 장비 ID별로 /topic/gps/{deviceId} 구독
        deviceIds.forEach(deviceId => {
          client.subscribe(`/topic/gps/${deviceId}`, msg => handleMsg(deviceId, msg));
        });
      },
    });
    client.activate();
    return () => { client.deactivate(); };
  }, [deviceIdsKey, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

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

// ── 개발 중 배너 ────────────────────────────────────────────
function DevBanner() {
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  return (
    <div style={{
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 20,
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
      🚧 개발 중
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

// ── 메인 대시보드 레이아웃 ─────────────────────────────────
function DashboardLayout({ selectedProject }) {
  const t = useT('integrationProject');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      background: '#060f18',
    }}>

      {!isMobile && <ControlSidebar />}

      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <IntegrationScene />
        <DevBanner />

        <div style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0d1b2acc',
          border: '1px solid #1e3a5f',
          borderRadius: 20,
          padding: '4px 18px',
          fontSize: 11,
          color: '#60a5fa',
          fontWeight: 700,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          backdropFilter: 'blur(4px)',
        }}>
          🔗 {selectedProject?.projectName || t('pageTitle')} · BIM · WBS
        </div>

        <div style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          fontSize: 9,
          color: '#374151',
          pointerEvents: 'none',
        }}>
          {t('overlayHint')}
        </div>

        {/* 모바일: 패널 토글 버튼 */}
        {isMobile && (
          <button
            onClick={() => setShowPanel(v => !v)}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: '#0d1b2acc',
              border: '1px solid #1e3a5f',
              borderRadius: 10,
              padding: '5px 10px',
              fontSize: 11,
              color: '#60a5fa',
              fontWeight: 700,
              backdropFilter: 'blur(4px)',
              cursor: 'pointer',
              zIndex: 10,
            }}
          >
            {showPanel ? '✕' : '📊'}
          </button>
        )}
      </div>

      {/* 데스크톱: 오른쪽 고정 패널 / 모바일: 오버레이 패널 */}
      {(!isMobile || showPanel) && (
        <div style={isMobile ? {
          position: 'absolute',
          top: 0,
          right: 0,
          width: '75vw',
          maxWidth: 280,
          height: '100%',
          zIndex: 20,
          background: '#0a1525',
          borderLeft: '1px solid #111e2d',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        } : {
          width: 290,
          flexShrink: 0,
          background: '#0a1525',
          borderLeft: '1px solid #111e2d',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <IntegrationDashboardPanel />
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid #111e2d' }}>
            <IntegrationEventLog />
          </div>
          <WbsProgressPanel />
        </div>
      )}

    </div>
  );
}

// ── 외부 진입점 ────────────────────────────────────────────
export default function IntegrationDashboard({ selectedProject, onBack }) {
  return (
    <IntegrationProvider projectId={selectedProject?.projectId}>
      <DataLoader selectedProject={selectedProject} />
      <StructureLoader />
      <GpsLoader />
      <DashboardLayout selectedProject={selectedProject} />
    </IntegrationProvider>
  );
}
