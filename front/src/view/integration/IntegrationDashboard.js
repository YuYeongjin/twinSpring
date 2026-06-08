import { useEffect }                        from 'react';
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

// ── 메인 대시보드 레이아웃 ─────────────────────────────────
function DashboardLayout({ selectedProject }) {
  const t = useT('integrationProject');

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      background: '#060f18',
    }}>

      <ControlSidebar />

      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <IntegrationScene />

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
      </div>

      <div style={{
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

    </div>
  );
}

// ── 외부 진입점 ────────────────────────────────────────────
export default function IntegrationDashboard({ selectedProject, onBack }) {
  return (
    <IntegrationProvider projectId={selectedProject?.projectId}>
      <DataLoader selectedProject={selectedProject} />
      <StructureLoader />
      <DashboardLayout selectedProject={selectedProject} />
    </IntegrationProvider>
  );
}
