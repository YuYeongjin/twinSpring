import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useIntegration } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';
import AxiosCustom from '../../../axios/AxiosCustom';
import { getEquipTaskMap } from '../progressEngine';
import TemplateEditor, { loadBlockConfig, generateHtml } from './DailyReportTemplateEditor';

const EQUIP_TYPE_KEY  = { excavator: 'equipExcavator', dump: 'equipDump', crane: 'equipCrane', vehicle: 'equipVehicle', other: 'equipOther' };
const EQUIP_ICON      = { excavator: '🚜', dump: '🚛', crane: '🏗', vehicle: '🚗', other: '🔧' };
const ZONE_TYPE_KEY   = { excavation: 'drZoneExcavation', restricted: 'drZoneRestricted', hazard: 'drZoneHazard' };
const MODE_KEY        = { auto: 'drModeAuto', standby: 'drModeStandby', gps: 'drModeGps' };
const STATUS_COLOR    = { NOT_STARTED: '#94a3b8', IN_PROGRESS: '#60a5fa', COMPLETED: '#4ade80', DELAYED: '#ef4444' };
const STATUS_I18N_KEY = { NOT_STARTED: 'drStatusNotStarted', IN_PROGRESS: 'drStatusInProgress', COMPLETED: 'drStatusCompleted', DELAYED: 'drStatusDelayed' };
const PROG_COLOR     = p => p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#374151';
const TODAY          = new Date().toISOString().slice(0, 10);

/* ── 증감 배지 ── */
function DeltaBadge({ delta }) {
  if (delta == null || isNaN(delta)) return null;
  const d = Math.round(delta * 10) / 10;
  if (d === 0) return <span style={{ fontSize: 8, color: '#4b5563', marginLeft: 4 }}>±0</span>;
  const up = d > 0;
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, marginLeft: 4,
      color: up ? '#22c55e' : '#f97316',
    }}>
      {up ? `▲+${d}%` : `▼${d}%`}
    </span>
  );
}

/* ── 공통 테이블 ── */
const CELL = { border: '1px solid #1e3a5f', padding: '6px 8px', fontSize: 10, color: '#c8d8e8' };
const HEAD = { ...CELL, background: '#0c1e35', color: '#60a5fa', fontWeight: 700, fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center' };
const TD   = { ...CELL, background: '#060f18' };
const TDA  = { ...TD, textAlign: 'center' };

function Col({ center, children }) { return <td style={center ? TDA : TD}>{children}</td>; }

function ReportTable({ headers, rows, noDataKey, t }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
      <thead><tr>{headers.map((h, i) => <th key={i} style={HEAD}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0
          ? <tr><td colSpan={headers.length} style={{ ...TD, textAlign: 'center', color: '#374151' }}>{t(noDataKey)}</td></tr>
          : rows.map((cols, ri) => <tr key={ri}>{cols}</tr>)}
      </tbody>
    </table>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 0 5px', borderBottom: '2px solid #1e3a5f', marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/* ── Excel 내보내기 (단일 시트 2페이지 레이아웃) ── */
function exportExcel(t, date, data, tasks, equip, workers, dangers, prevTasks) {
  const prevMap = {};
  prevTasks.forEach(pt => { prevMap[pt.taskId] = pt.progress || 0; });

  const overallDelta = data.prevOverallProgress != null
    ? Math.round(((data.overallProgress || 0) - data.prevOverallProgress) * 10) / 10
    : null;

  // 8개 컬럼 (A=0 … H=7) 사용
  const NC = 8;
  const rows = [];
  const merges = [];
  let r = 0;

  const blank  = () => Array(NC).fill('');
  const addRow = (...cells) => { rows.push(cells.concat(Array(NC - cells.length).fill(''))); r++; };
  const addBlank = () => { rows.push(blank()); r++; };

  const merge = (fromC, toC) => merges.push({ s: { r, c: fromC }, e: { r, c: toC } });
  const addFull = (text) => { const row = blank(); row[0] = text; rows.push(row); merge(0, NC - 1); r++; };
  const addSection = (text) => { const row = blank(); row[0] = text; rows.push(row); merge(0, NC - 1); r++; };

  // ━━━ 제목 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addFull(t('dailyReportTitle'));
  addBlank();

  // ━━━ 기본 정보 (2행 4칸 그리드) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    const r1 = blank();
    r1[0] = t('drSite'); r1[1] = data.siteName || '—';
    r1[4] = t('drDate'); r1[5] = date;
    rows.push(r1); merge(1, 3); merge(5, 7); r++;

    const r2 = blank();
    r2[0] = t('drLocation'); r2[1] = data.locationStr || '—';
    r2[4] = t('drWeather');  r2[5] = '—';
    rows.push(r2); merge(1, 3); merge(5, 7); r++;
  }
  addBlank();

  // ━━━ 1. 작업 현황 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addSection(`1. ${t('drWorkStatus')}`);
  addRow(t('drNo'), t('drWorkName'), t('drWorkerCount'), t('drEquipCount'), t('drPrevProgress'), t('drProgress'), t('drDeltaCol'), t('drStatus'));

  if (tasks.length === 0) {
    addFull(t('drNoTasks'));
  } else {
    tasks.forEach((tk, i) => {
      const prev  = prevMap[tk.taskId];
      const curr  = Math.round(tk.progress || 0);
      const delta = prev != null ? Math.round((curr - prev) * 10) / 10 : null;
      addRow(
        i + 1, tk.taskName || '—',
        data.workerCount, data.equipCount,
        prev != null ? `${Math.round(prev)}%` : '—',
        `${curr}%`,
        delta != null ? (delta >= 0 ? `+${delta}%` : `${delta}%`) : '—',
        t(STATUS_I18N_KEY[tk.status] || 'drStatusNotStarted'),
      );
    });
  }
  addBlank();

  // ━━━ 2. 장비 현황 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addSection(`2. ${t('drEquipStatus')}`);
  { const h = blank(); h[0]=t('drNo'); h[1]=t('drEquipName'); h[2]=t('drEquipType'); h[3]=t('drEquipMode'); h[4]=t('drEquipHours'); h[5]=t('drEquipTask'); rows.push(h); merge(5,7); r++; }

  if (equip.length === 0) {
    addFull('—');
  } else {
    equip.forEach((e, i) => {
      const row = blank();
      row[0]=i+1; row[1]=e.name||'—'; row[2]=t(EQUIP_TYPE_KEY[e.type]||'equipOther');
      row[3]=t(MODE_KEY[e.mode]||'drModeAuto');
      row[4]=e.hours ? `${e.hours}${t('drHoursUnit')}` : '—';
      row[5]=e.taskDesc||'—';
      rows.push(row); merge(5,7); r++;
    });
  }

  // ━━━ 페이지 브레이크 (1페이지 끝) ━━━━━━━━━━━━━━━━━━━━━━━━━━
  const pageBreakRow = r;
  addBlank();

  // ━━━ 3. 작업자 현황 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addSection(`3. ${t('drWorkerStatus')}`);
  addRow(t('drNo'), t('drWorkerName'), t('drWorkerGear'));

  if (workers.length === 0) {
    addFull('—');
  } else {
    workers.forEach((w, i) => addRow(i+1, w.name||'—', w.gear ? t('drGearOn') : t('drGearOff')));
  }
  addBlank();

  // ━━━ 4. 위험 작업 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addSection(`4. ${t('drDangerWork')}`);
  { const h=blank(); h[0]=t('drNo'); h[1]=t('drZoneName'); h[2]=t('drZoneType'); h[3]=t('drZoneRadius'); h[4]=t('drZoneAction'); rows.push(h); merge(4,7); r++; }

  if (dangers.length === 0) {
    addFull(t('drNoDanger'));
  } else {
    dangers.forEach((z, i) => {
      const row=blank();
      row[0]=i+1; row[1]=z.name||'—';
      row[2]=t(ZONE_TYPE_KEY[z.type]||'drZoneHazard');
      row[3]=`${((z.halfSize||[4])[0])*2}m`;
      row[4]=t('drZoneActionDefault');
      rows.push(row); merge(4,7); r++;
    });
  }
  addBlank();

  // ━━━ 종합 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  addSection(t('drSummary'));
  {
    const su = blank();
    su[0]=t('drTotalWorkers'); su[1]=`${data.workerCount}${t('drUnitPerson')}`;
    su[2]=t('drTotalEquip');   su[3]=`${data.equipCount}${t('drUnitEquip')}`;
    su[4]=t('drTotalProgress');
    su[5]=`${Math.round(data.overallProgress||0)}%${overallDelta!=null ? ` (${overallDelta>=0?'+':''}${overallDelta}%)` : ''}`;
    su[6]=overallDelta!=null ? `vs ${data.prevDate||'—'}` : '';
    rows.push(su); r++;
  }
  addBlank();
  addBlank();

  // ━━━ 서명란 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  { const s=blank(); s[0]=t('drAuthor'); s[3]=t('drSupervisor'); s[6]=t('drApprover'); rows.push(s); merge(0,2); merge(3,5); merge(6,7); r++; }
  for (let i=0; i<3; i++) { const s=blank(); rows.push(s); merge(0,2); merge(3,5); merge(6,7); r++; }

  // ━━━ 워크시트 조립 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 5  }, // A: No
    { wch: 24 }, // B: 이름/작업명
    { wch: 12 }, // C: 종류
    { wch: 12 }, // D: 모드/장비수
    { wch: 12 }, // E: 시간/전일%
    { wch: 12 }, // F: 진척도/담당업무
    { wch: 10 }, // G: 증감/담당업무
    { wch: 16 }, // H: 상태/담당업무
  ];
  ws['!rows'] = [{ hpx: 26 }, { hpx: 4 }]; // 제목행 높이
  ws['!rowBreaks'] = [pageBreakRow];         // 페이지 브레이크

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t('drSheetSummary'));
  XLSX.writeFile(wb, `${t('drFilePrefix')}_${date}.xlsx`);
}

const roundHalf = v => Math.round(Number(v) * 2) / 2; // 0.5 단위 반올림

/* ── 메인 컴포넌트 ── */
export default function DailyReport({ onClose }) {
  const t = useT('integrationProject');
  const { projectMeta, workers: liveWorkers, equipment: liveEquip, dangerZones: liveDangers, wbsTasks: liveTasks, surveyOrigin, referencePoint, equipActiveSecs = {} } = useIntegration();
  const projectId = projectMeta?.projectId;

  const [reportDate,     setReportDate]     = useState(TODAY);
  const [availableDates, setAvailableDates] = useState([]);
  const [reportData,     setReportData]     = useState(null);
  const [status,         setStatus]         = useState('loading');
  const [equipExtras,    setEquipExtras]    = useState({}); // { [equipId]: { hours, taskDesc } }
  const [mode,           setMode]           = useState('view'); // 'view' | 'template'
  const savedToday = useRef(false);

  const parse = (str) => { try { return JSON.parse(str || '[]'); } catch { return []; } };

  /* 진행 중 BIM 태스크 기반 장비 타입 → 담당 업무 자동 매핑 */
  const equipTaskMap = useMemo(() => getEquipTaskMap(liveTasks), [liveTasks]);

  /* 장비 id → 자동 계산 시간 (0.5h 단위) */
  const autoHoursOf = useCallback(id => roundHalf((equipActiveSecs[id] || 0) / 3600), [equipActiveSecs]);

  const updateEquipExtra = (id, field, value) =>
    setEquipExtras(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));

  /* reportData 로드 시 equipExtras 초기화 (저장값 우선, 없으면 자동값) */
  useEffect(() => {
    if (!reportData) return;
    const eq = parse(reportData.equipSnapshot);
    const extras = {};
    eq.forEach(e => {
      extras[e.id] = {
        hours:    e.hours    !== undefined && e.hours    !== '' ? e.hours    : autoHoursOf(e.id),
        taskDesc: e.taskDesc !== undefined && e.taskDesc !== '' ? e.taskDesc : (equipTaskMap[e.type] || ''),
      };
    });
    setEquipExtras(extras);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportData]);

  /* 라이브 데이터 스냅샷 */
  const buildSnapshot = useCallback(() => {
    const overall = liveTasks.length > 0
      ? Math.round(liveTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / liveTasks.length)
      : 0;
    const locationStr = surveyOrigin
      ? `${surveyOrigin.label||'기준점'} (X:${surveyOrigin.x.toFixed(1)}, Y:${surveyOrigin.y.toFixed(1)})`
      : `${referencePoint.lat.toFixed(4)}°N, ${referencePoint.lng.toFixed(4)}°E`;
    return {
      siteName:        projectMeta?.projectName || '—',
      locationStr,
      workerCount:     liveEquip.length > 0 ? liveWorkers.length : 0,
      equipCount:      liveEquip.length,
      overallProgress: overall,
      taskSnapshot:    JSON.stringify(liveTasks.map(tk => ({ taskId: tk.taskId, taskName: tk.taskName, progress: tk.progress, status: tk.status }))),
      equipSnapshot:   JSON.stringify(liveEquip.map(e  => {
        const extra = equipExtras[e.id] || {};
        return {
          id: e.id, name: e.name, type: e.type, mode: e.mode,
          hours:    extra.hours    !== '' && extra.hours    !== undefined ? extra.hours    : autoHoursOf(e.id),
          taskDesc: extra.taskDesc !== '' && extra.taskDesc !== undefined ? extra.taskDesc : (equipTaskMap[e.type] || ''),
        };
      })),
      workerSnapshot:  JSON.stringify(liveWorkers.map(w => ({ id: w.id, name: w.name, gear: w.gear }))),
      dangerSnapshot:  JSON.stringify(liveDangers.filter(z => z.active).map(z => ({ id: z.id, name: z.name, type: z.type, halfSize: z.halfSize }))),
    };
  }, [projectMeta, liveWorkers, liveEquip, liveDangers, liveTasks, surveyOrigin, referencePoint, equipExtras, equipTaskMap, autoHoursOf]);

  const fetchDates = useCallback(async () => {
    if (!projectId) return;
    try { const r = await AxiosCustom.get(`/api/integration/project/${projectId}/daily-report/dates`); setAvailableDates(r.data || []); } catch { /* 무시 */ }
  }, [projectId]);

  const fetchReport = useCallback(async (date) => {
    if (!projectId) return;
    setStatus('loading'); setReportData(null);
    try {
      const r = await AxiosCustom.get(`/api/integration/project/${projectId}/daily-report/${date}`);
      setReportData(r.data); setStatus('ready');
    } catch (e) { setStatus(e.response?.status === 404 ? 'nodata' : 'nodata'); }
  }, [projectId]);

  const saveReport = useCallback(async (date) => {
    if (!projectId) return;
    setStatus('saving');
    try {
      await AxiosCustom.post(`/api/integration/project/${projectId}/daily-report`, { ...buildSnapshot(), reportDate: date });
      await fetchDates();
      await fetchReport(date);
    } catch { setStatus('nodata'); }
  }, [projectId, buildSnapshot, fetchDates, fetchReport]);


  useEffect(() => {
    if (!projectId || savedToday.current) return;
    savedToday.current = true;
    saveReport(TODAY).then(() => fetchDates());
  }, [projectId, saveReport, fetchDates]);

  useEffect(() => { fetchReport(reportDate); }, [reportDate, fetchReport]);

  const tasks   = parse(reportData?.taskSnapshot);
  const equip   = parse(reportData?.equipSnapshot);
  const workers = parse(reportData?.workerSnapshot);
  const dangers = parse(reportData?.dangerSnapshot);
  const prevTasks = parse(reportData?.prevTaskSnapshot);

  /* 전일 태스크 진척도 맵 */
  const prevMap = {};
  prevTasks.forEach(pt => { prevMap[pt.taskId] = pt.progress || 0; });

  const overallDelta = reportData?.prevOverallProgress != null
    ? Math.round(((reportData.overallProgress || 0) - reportData.prevOverallProgress) * 10) / 10
    : null;

  const isToday = reportDate === TODAY;

  const handlePrint = () => {
    if (!reportData) return;
    const config = loadBlockConfig(projectId);
    const html = generateHtml(config, { date: reportDate, data: reportData, tasks, equip, workers, dangers, prevTasks });
    const win = window.open('', '_blank', 'width=960,height=760');
    if (!win) return;
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => win.print(), 400);
  };

  /* 템플릿 편집 시 미리보기에 넘길 샘플 데이터 */
  const sampleData = useMemo(() => reportData ? {
    date: reportDate, data: reportData, tasks, equip, workers, dangers, prevTasks,
  } : null, [reportData, reportDate, tasks, equip, workers, dangers, prevTasks]);

  const handleExcel = () => {
    if (!reportData) return;
    exportExcel(t, reportDate, reportData, tasks, equip, workers, dangers, prevTasks);
  };

  /* 템플릿 편집 모드: 전체 화면 오버레이 */
  if (mode === 'template') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#060f18', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 (템플릿 모드) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #1e3a5f', background: '#0a1525', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#93c5fd' }}>{t('dailyReportTitle')}</div>
            <div style={{ fontSize: 10, color: '#374151', marginTop: 2 }}>{projectMeta?.projectName || '—'}</div>
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button onClick={() => setMode('view')}
              style={{ background: '#2d1b6b', border: '1px solid #a78bfa', borderRadius: 6, color: '#c4b5fd', fontSize: 11, fontWeight: 700, padding: '6px 12px', cursor: 'pointer' }}>
              🎨 편집 중
            </button>
            <button onClick={onClose}
              style={{ background: '#1a0a0a', border: '1px solid #ef4444', borderRadius: 6, color: '#f87171', fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}>
              ✕ {t('drClose')}
            </button>
          </div>
        </div>
        {/* 편집기 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <TemplateEditor
            projectId={projectId}
            sampleData={sampleData}
            onClose={() => setMode('view')}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,10,20,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 20, overflowY: 'auto' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 860, margin: '0 16px 40px', background: '#0a1525', border: '1px solid #1e3a5f', borderRadius: 12, boxShadow: '0 8px 40px #000a' }}
      >

        {/* ── 헤더 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #1e3a5f', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#93c5fd', letterSpacing: '0.04em' }}>{t('dailyReportTitle')}</div>
            <div style={{ fontSize: 10, color: '#374151', marginTop: 2 }}>{projectMeta?.projectName || '—'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {mode === 'view' && <>
              <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                style={{ background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 6, color: '#93c5fd', fontSize: 11, padding: '5px 8px', outline: 'none' }} />
              {isToday && (
                <button onClick={() => saveReport(TODAY)} disabled={status === 'saving'}
                  style={{ background: '#0f2a1a', border: '1px solid #22c55e', borderRadius: 6, color: '#22c55e', fontSize: 11, fontWeight: 700, padding: '6px 12px', cursor: 'pointer' }}>
                  {status === 'saving' ? t('drSaving') : `📥 ${t('drSaveNow')}`}
                </button>
              )}
              <button onClick={handleExcel} disabled={!reportData}
                style={{ background: '#0f2a10', border: '1px solid #22c55e', borderRadius: 6, color: '#4ade80', fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: reportData ? 'pointer' : 'not-allowed', opacity: reportData ? 1 : 0.4 }}>
                📊 Excel
              </button>
              <button onClick={handlePrint} disabled={!reportData}
                style={{ background: '#1e3a5f', border: 'none', borderRadius: 6, color: '#93c5fd', fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: reportData ? 'pointer' : 'not-allowed', opacity: reportData ? 1 : 0.4 }}>
                {t('drPrint')}
              </button>
            </>}
            {/* 템플릿 편집 토글 */}
            <button onClick={() => setMode(m => m === 'template' ? 'view' : 'template')}
              style={{ background: mode === 'template' ? '#2d1b6b' : 'none', border: `1px solid ${mode === 'template' ? '#a78bfa' : '#374151'}`, borderRadius: 6, color: mode === 'template' ? '#c4b5fd' : '#6b7280', fontSize: 11, fontWeight: mode === 'template' ? 700 : 400, padding: '6px 12px', cursor: 'pointer' }}>
              🎨 {mode === 'template' ? '편집 중' : '템플릿'}
            </button>
            <button onClick={onClose}
              style={{ background: '#1a0a0a', border: '1px solid #ef4444', borderRadius: 6, color: '#f87171', fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}>
              ✕ {t('drClose')}
            </button>
          </div>
        </div>

        {/* ── 저장된 날짜 배지 ── */}
        {availableDates.length > 0 && (
          <div style={{ padding: '8px 20px', borderBottom: '1px solid #0d1b2a', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#374151', marginRight: 2 }}>{t('drSavedDates')}:</span>
            {availableDates.slice(0, 20).map(d => (
              <button key={d} onClick={() => setReportDate(d)}
                style={{ background: d === reportDate ? '#1e3a5f' : '#0d1b2a', border: `1px solid ${d === reportDate ? '#60a5fa' : '#1e3a5f'}`, borderRadius: 10, color: d === reportDate ? '#93c5fd' : '#4b5563', fontSize: 9, padding: '2px 8px', cursor: 'pointer' }}>
                {d.slice(5)}
              </button>
            ))}
          </div>
        )}

        {/* ── 본문 ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto' }}>

          {status === 'loading' && (
            <div style={{ textAlign: 'center', color: '#4b5563', padding: '40px 0', fontSize: 12 }}>{t('loading')}</div>
          )}

          {status === 'nodata' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 16 }}>{t('drNoDataFor').replace('{date}', reportDate)}</div>
              {isToday && (
                <button onClick={() => saveReport(TODAY)}
                  style={{ background: '#1e3a5f', border: 'none', borderRadius: 8, color: '#93c5fd', fontSize: 12, fontWeight: 700, padding: '10px 24px', cursor: 'pointer' }}>
                  📥 {t('drSaveNow')}
                </button>
              )}
            </div>
          )}

          {status === 'ready' && reportData && (<>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              {/* 전날 비교 배지 */}
              {reportData.prevDate && (
                <div style={{ fontSize: 9, color: '#4b5563' }}>
                  {t('drPrevDayDiff')} ({reportData.prevDate}):
                  <span style={{ fontWeight: 700, color: overallDelta >= 0 ? '#22c55e' : '#f97316', marginLeft: 4 }}>
                    {Math.round(reportData.prevOverallProgress||0)}% → {Math.round(reportData.overallProgress||0)}%
                    {overallDelta != null && ` (${overallDelta >= 0 ? '+' : ''}${overallDelta}%)`}
                  </span>
                </div>
              )}
              <div style={{ fontSize: 9, color: '#253347', textAlign: 'right' }}>
                {t('drCreatedAt')}: {reportData.createdAt} · {t('drUpdatedAt')}: {reportData.updatedAt}
              </div>
            </div>

            {/* 현장 기본 정보 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #1e3a5f', borderRadius: 6, overflow: 'hidden', marginBottom: 20 }}>
              {[[t('drSite'), reportData.siteName||'—'], [t('drDate'), reportDate], [t('drLocation'), reportData.locationStr||'—'], [t('drWeather'), '—']]
                .map(([label, value], i) => (
                  <div key={i} style={{ padding: '8px 14px', borderRight: i%2===0?'1px solid #1e3a5f':'none', borderBottom: i<2?'1px solid #1e3a5f':'none', background: '#060f18' }}>
                    <div style={{ fontSize: 8, color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 11, color: '#d1d5db', fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
            </div>

            {/* 작업 현황 (전일 대비 포함) */}
            <Section title={t('drWorkStatus')}>
              <ReportTable t={t} noDataKey="drNoTasks"
                headers={[t('drNo'), t('drWorkName'), t('drWorkerCount'), t('drEquipCount'), t('drPrevProgress'), t('drProgress'), t('drDeltaCol'), t('drStatus')]}
                rows={tasks.map((tk, i) => {
                  const prev  = prevMap[tk.taskId];
                  const curr  = Math.round(tk.progress || 0);
                  const delta = prev != null ? Math.round((curr - prev) * 10) / 10 : null;
                  return [
                    <Col center>{i+1}</Col>,
                    <Col>{tk.taskName||'—'}</Col>,
                    <Col center>{reportData.workerCount}{t('drUnitPerson')}</Col>,
                    <Col center>{reportData.equipCount}{t('drUnitEquip')}</Col>,
                    <Col center><span style={{ color: '#4b5563' }}>{prev!=null?`${Math.round(prev)}%`:'—'}</span></Col>,
                    <Col center><span style={{ color: PROG_COLOR(curr), fontWeight: 700 }}>{curr}%</span></Col>,
                    <Col center><DeltaBadge delta={delta} /></Col>,
                    <Col center><span style={{ color: STATUS_COLOR[tk.status]||'#6b7280', fontSize: 9, fontWeight: 700 }}>{t(STATUS_I18N_KEY[tk.status]||'drStatusNotStarted')}</span></Col>,
                  ];
                })}
              />
            </Section>

            {/* 장비 현황 (업무 시간·담당 업무 — 당일만 편집 가능) */}
            <Section title={t('drEquipStatus')}>
              {!isToday && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 9, color: '#4b5563' }}>
                  <span style={{ fontSize: 13 }}>🔒</span>
                  {t('drPastLocked')}
                </div>
              )}
              {equip.length === 0
                ? <div style={{ ...TD, textAlign: 'center', color: '#374151', padding: '10px 0' }}>{t('drNoTasks')}</div>
                : (<>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: isToday ? 6 : 0 }}>
                      <thead>
                        <tr>
                          {[t('drNo'), t('drEquipName'), t('drEquipType'), t('drEquipMode'), t('drEquipHours'), t('drEquipTask')].map((h, i) => (
                            <th key={i} style={HEAD}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {equip.map((e, i) => {
                          const extra = equipExtras[e.id] || {};
                          const autoH = autoHoursOf(e.id);
                          const autoT = equipTaskMap[e.type] || '';
                          return (
                            <tr key={e.id || i}>
                              <td style={TDA}>{i+1}</td>
                              <td style={TD}>{EQUIP_ICON[e.type]||'🔧'} {e.name||'—'}</td>
                              <td style={TDA}>{t(EQUIP_TYPE_KEY[e.type]||'equipOther')}</td>
                              <td style={TDA}>
                                <span style={{ color: e.mode==='standby'?'#4b5563':'#22c55e', fontSize: 9, fontWeight: 700 }}>
                                  {t(MODE_KEY[e.mode]||'drModeAuto')}
                                </span>
                              </td>
                              <td style={TDA}>
                                {isToday ? (
                                  <>
                                    <input
                                      type="number" min="0" max="24" step="0.5"
                                      value={extra.hours ?? ''}
                                      onChange={ev => updateEquipExtra(e.id, 'hours', ev.target.value)}
                                      placeholder={autoH > 0 ? String(autoH) : t('drEquipHoursPlaceholder')}
                                      style={{ width: 54, background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#93c5fd', fontSize: 10, padding: '2px 4px', textAlign: 'center', outline: 'none' }}
                                    />
                                    <span style={{ fontSize: 9, color: '#4b5563', marginLeft: 3 }}>{t('drHoursUnit')}</span>
                                    {autoH > 0 && (!extra.hours || extra.hours === '') && (
                                      <span style={{ fontSize: 8, color: '#22c55e', marginLeft: 3 }}>↺{t('drAutoFilled')}</span>
                                    )}
                                  </>
                                ) : (
                                  <span style={{ color: '#93c5fd', fontSize: 10 }}>
                                    {extra.hours ? `${extra.hours}${t('drHoursUnit')}` : '—'}
                                  </span>
                                )}
                              </td>
                              <td style={TD}>
                                {isToday ? (
                                  <input
                                    type="text"
                                    value={extra.taskDesc ?? ''}
                                    onChange={ev => updateEquipExtra(e.id, 'taskDesc', ev.target.value)}
                                    placeholder={autoT || t('drEquipTaskPlaceholder')}
                                    style={{ width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#c8d8e8', fontSize: 10, padding: '2px 6px', outline: 'none' }}
                                  />
                                ) : (
                                  <span style={{ color: '#c8d8e8', fontSize: 10 }}>
                                    {extra.taskDesc || '—'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {isToday && (
                      <div style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => saveReport(TODAY)}
                          disabled={status === 'saving'}
                          style={{ background: '#0f2a1a', border: '1px solid #22c55e', borderRadius: 6, color: '#22c55e', fontSize: 10, fontWeight: 700, padding: '4px 14px', cursor: 'pointer' }}>
                          {status === 'saving' ? t('drSaving') : `💾 ${t('drSaveNow')}`}
                        </button>
                      </div>
                    )}
                  </>)
              }
            </Section>

            {/* 작업자 현황 */}
            <Section title={t('drWorkerStatus')}>
              <ReportTable t={t} noDataKey="drNoTasks"
                headers={[t('drNo'), t('drWorkerName'), t('drWorkerGear')]}
                rows={workers.map((w, i) => [
                  <Col center>{i+1}</Col>,
                  <Col>{w.name||'—'}</Col>,
                  <Col center><span style={{ color: w.gear?'#22c55e':'#ef4444', fontSize: 9, fontWeight: 700 }}>{w.gear?t('drGearOn'):t('drGearOff')}</span></Col>,
                ])}
              />
            </Section>

            {/* 위험 작업 */}
            <Section title={t('drDangerWork')}>
              <ReportTable t={t} noDataKey="drNoDanger"
                headers={[t('drNo'), t('drZoneName'), t('drZoneType'), t('drZoneRadius'), t('drZoneAction')]}
                rows={dangers.map((z, i) => [
                  <Col center>{i+1}</Col>,
                  <Col><span style={{ color: '#fca5a5' }}>⚠ {z.name||'—'}</span></Col>,
                  <Col center>{t(ZONE_TYPE_KEY[z.type]||'drZoneHazard')}</Col>,
                  <Col center>{((z.halfSize||[4])[0])*2}m</Col>,
                  <Col>{t('drZoneActionDefault')}</Col>,
                ])}
              />
            </Section>

            {/* 종합 */}
            <Section title={t('drSummary')}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  [t('drTotalWorkers'), `${reportData.workerCount}${t('drUnitPerson')}`, '#60a5fa', null],
                  [t('drTotalEquip'),   `${reportData.equipCount}${t('drUnitEquip')}`,  '#a78bfa', null],
                  [t('drTotalProgress'), `${Math.round(reportData.overallProgress||0)}%`,
                    PROG_COLOR(reportData.overallProgress||0), overallDelta],
                ].map(([label, value, color, delta], i) => (
                  <div key={i} style={{ background: '#060f18', border: '1px solid #1e3a5f', borderRadius: 6, padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                    {delta != null && <DeltaBadge delta={delta} />}
                  </div>
                ))}
              </div>
            </Section>

            {/* 서명란 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              {[t('drAuthor'), t('drSupervisor'), t('drApprover')].map((role, i) => (
                <div key={i} style={{ background: '#060f18', border: '1px solid #1e3a5f', borderRadius: 6, padding: '10px 12px', minHeight: 64 }}>
                  <div style={{ fontSize: 9, color: '#4b5563', fontWeight: 700, marginBottom: 4 }}>{role}</div>
                </div>
              ))}
            </div>

          </>)}
        </div>
      </div>
    </div>
  );
}
