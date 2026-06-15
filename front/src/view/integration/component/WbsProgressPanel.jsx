import { useMemo, useState, useEffect, useRef } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';
import AxiosCustom from '../../../axios/AxiosCustom';
import { computeWorkPlan } from '../../bim/component/WorkPlanDashboard';

const TASK_STATUS_META = {
  NOT_STARTED: { labelKey: 'taskNotStarted', color: '#94a3b8' },
  IN_PROGRESS: { labelKey: 'taskInProgress', color: '#60a5fa' },
  COMPLETED:   { labelKey: 'taskCompleted',  color: '#4ade80' },
  DELAYED:     { labelKey: 'taskDelayed',    color: '#ef4444' },
};
const WBS_BAR_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];
const PHASE_COLOR = {
  design: '#64748b', temporary: '#78716c', earthwork: '#d97706', foundation: '#f97316',
  frame: '#3b82f6', slab: '#06b6d4', wall: '#6366f1', finishing: '#22c55e',
  mep: '#14b8a6', completion: '#a855f7',
};

function calcBimProgress(taskStart, taskEnd) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = taskStart instanceof Date ? taskStart : new Date(taskStart);
  const e = taskEnd   instanceof Date ? taskEnd   : new Date(taskEnd);
  if (today < s) return 0;
  if (today > e) return 100;
  return Math.round(((today - s) / (e - s)) * 100);
}

// ── 시방서 패널 ──────────────────────────────────────────────
function SpecPanel({ citations, loading, hasData, t }) {
  if (loading) return (
    <div style={{ fontSize: 9, color: '#60a5fa', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
      ⏳ {t('specSearching')}
    </div>
  );
  if (!hasData || !citations?.length) return (
    <div style={{ fontSize: 9, color: '#374151', padding: '4px 0' }}>{t('specNone')}</div>
  );
  return (
    <div style={{ marginTop: 4 }}>
      {citations.map((c, i) => (
        <div key={i} style={{
          marginBottom: 5, padding: '5px 7px',
          background: '#060f18', borderRadius: 3, border: '1px solid #1e3a5f',
        }}>
          <div style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, marginBottom: 2 }}>
            📋 {c.source}
            {c.series && <span style={{ color: '#4b5563', fontWeight: 400 }}> · {c.series}</span>}
          </div>
          <div style={{ fontSize: 8, color: '#94a3b8', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content}
          </div>
        </div>
      ))}
    </div>
  );
}

function useSpecQuery(taskName, status) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState(null);

  const toggle = async (e) => {
    e && e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (data) return;
    setLoading(true);
    try {
      const res = await AxiosCustom.post('/api/chat/wbs-task-spec', {
        taskName: taskName || '', elementType: '', status: status || '',
      });
      setData(res.data);
    } catch {
      setData({ citations: [], hasData: false });
    } finally {
      setLoading(false);
    }
  };
  return { open, loading, data, toggle };
}

// ── WBS 태스크 바 ─────────────────────────────────────────────
function WbsBar({ task, color, tWbs, t }) {
  const sm = TASK_STATUS_META[task.status];
  const spec = useSpecQuery(task.taskName, task.status);
  const p = task.progress ?? 0;

  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#8896a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
          {task.taskName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {sm && <span style={{ fontSize: 8, color: sm.color, fontWeight: 700 }}>{tWbs(sm.labelKey) || sm.labelKey}</span>}
          <span style={{ fontSize: 10, fontWeight: 700, color }}>{Math.round(p)}%</span>
          <button onClick={spec.toggle} title={t('specQueryTitle')} style={{
            background: 'none', border: '1px solid #1e3a5f', borderRadius: 3,
            cursor: 'pointer', color: spec.open ? '#93c5fd' : '#4b6a8a',
            fontSize: 8, padding: '1px 4px', lineHeight: 1.4,
          }}>📋</button>
        </div>
      </div>
      <div style={{ background: '#111e2d', borderRadius: 4, height: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, p)}%`, background: color, borderRadius: 4, transition: 'width 1.2s ease' }} />
      </div>
      {spec.open && <SpecPanel citations={spec.data?.citations} loading={spec.loading} hasData={spec.data?.hasData} t={t} />}
    </div>
  );
}

// ── BIM 작업계획 태스크 바 ────────────────────────────────────
function BimTaskBar({ task, structName }) {
  const tWp = useT('workPlan');
  const [open, setOpen] = useState(false);
  const color = PHASE_COLOR[task.phase] || '#3b82f6';
  const p = task.progress ?? 0;

  const fmtD = (d) => {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getMonth() + 1}/${String(dt.getDate()).padStart(2, '0')}`;
  };

  return (
    <div style={{ marginBottom: 9 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', flex: 1 }}>
            <div style={{ width: 6, height: 6, borderRadius: 1, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#8896a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 8, color: '#3b82f6', fontWeight: 600 }}>BIM</span>
            <span style={{ fontSize: 10, fontWeight: 700, color }}>{Math.round(p)}%</span>
          </div>
        </div>
        <div style={{ background: '#111e2d', borderRadius: 4, height: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, p)}%`, background: color, borderRadius: 4, transition: 'width 1.2s ease' }} />
        </div>
      </button>

      {open && (
        <div style={{
          marginTop: 4, paddingLeft: 11, paddingTop: 4,
          borderLeft: `2px solid ${color}`,
          fontSize: 8, color: '#6b7280', lineHeight: 1.9,
        }}>
          <div style={{ color: '#4b5563', fontSize: 8, marginBottom: 2 }}>📁 {structName}</div>
          <div>📅 {fmtD(task.start)} ~ {fmtD(task.end)} · {tWp('valDays', { n: task.days })}</div>
          <div>👷 {tWp('valPersons', { n: task.workers })} · {task.roles}</div>
          <div>🔧 {task.equipment}</div>
          {task.volume != null && <div>📦 {tWp('concreteVol', { vol: task.volume })}</div>}
        </div>
      )}
    </div>
  );
}

// ── 구분선 레이블 ─────────────────────────────────────────────
function SectionLabel({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 6px' }}>
      <div style={{ flex: 1, height: 1, background: '#111e2d' }} />
      <span style={{ fontSize: 8, color: '#374151', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#111e2d' }} />
    </div>
  );
}

// ── 메인 패널 ────────────────────────────────────────────────
// 1 real minute = 24 construction hours (24x 압축)
// 5분 틱 기준: simTickDays = (5 * 60 * 24) / (24 * 60) = 5일치 진행
const TICK_MS      = 5 * 60 * 1000;   // 5분
const SIM_DAYS_PER_REAL_MIN = 24 / 60; // 1 real min = 0.4 sim days (24x 압축)

export default function WbsProgressPanel() {
  const t    = useT('integrationProject');
  const tWbs = useT('wbs');
  const tWp  = useT('workPlan');
  const { wbsTasks, structures, isLoading, simulationRunning, equipment, workers, bimSimProgress } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const isAutoRunning = simulationRunning && Array.isArray(equipment) && equipment.some(e => e.mode === 'auto');

  // stale-closure 방지용 refs
  const isAutoRunningRef = useRef(isAutoRunning);
  useEffect(() => { isAutoRunningRef.current = isAutoRunning; }, [isAutoRunning]);

  // 구조물별 태스크 정보 — bimSimProgress 변화와 독립된 stable 데이터
  const stableTaskInfo = useMemo(() => {
    return (structures || [])
      .filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0)
      .map(s => {
        const plan = computeWorkPlan(s.elements, tWp);
        if (!plan) return null;
        return {
          structureId: s.id,
          tasks: plan.tasks.map((task, taskIdx) => ({
            key: `${s.id}_${taskIdx}`,
            days: task.days || 1,
            planned: task.workers || 1,
          })),
        };
      })
      .filter(Boolean);
  }, [structures, tWp]);

  const stableTaskInfoRef = useRef(stableTaskInfo);
  useEffect(() => { stableTaskInfoRef.current = stableTaskInfo; }, [stableTaskInfo]);

  const workerCountRef = useRef((workers || []).length);
  useEffect(() => { workerCountRef.current = (workers || []).length; }, [workers]);

  const bimSimProgressRef = useRef(bimSimProgress);
  useEffect(() => { bimSimProgressRef.current = bimSimProgress; }, [bimSimProgress]);

  // 인터벌 — 구조물별로 첫 번째 미완료 태스크만 틱 (토공사 → 기초 → 골조 순서)
  useEffect(() => {
    const id = setInterval(() => {
      if (!isAutoRunningRef.current) return;
      const simTickDays = (TICK_MS / 1000 / 60) * SIM_DAYS_PER_REAL_MIN;
      const wCount = workerCountRef.current || 1;
      const curProg = bimSimProgressRef.current || {};

      const updates = [];
      stableTaskInfoRef.current.forEach(({ tasks }) => {
        // 순서대로: 이미 100% 완료된 태스크 건너뛰고 첫 미완료 태스크에만 진척
        const active = tasks.find(({ key }) => (curProg[key] || 0) < 100);
        if (!active) return;
        const { key, days, planned } = active;
        const workerFactor = Math.min(2.0, wCount / planned);
        updates.push({ key, delta: (simTickDays / days) * 100 * workerFactor });
      });
      if (updates.length) dispatch({ type: 'BIM_PROGRESS_TICK', updates });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [dispatch]);

  // WBS 태스크 전체 진도
  const wbsOverall = wbsTasks.length > 0
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / wbsTasks.length)
    : null;

  // BIM 구조물 → computed 작업계획 태스크 (날짜 기반 + 자동 작업 시뮬 누적)
  const bimPlans = useMemo(() => {
    return (structures || [])
      .filter(s => s.type === 'bim' && Array.isArray(s.elements) && s.elements.length > 0)
      .map(s => {
        const plan = computeWorkPlan(s.elements, tWp);
        if (!plan) return null;
        const tasks = plan.tasks.map((task, taskIdx) => {
          const simDelta = bimSimProgress?.[`${s.id}_${taskIdx}`] || 0;
          return { ...task, progress: Math.min(100, calcBimProgress(task.start, task.end) + simDelta) };
        });
        const overall = Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length);
        return { structureId: s.id, structureName: s.name, tasks, overall };
      })
      .filter(Boolean);
  }, [structures, tWp, bimSimProgress]);

  // 전체 통합 진도 (WBS + BIM 합산)
  const allProgresses = [
    ...wbsTasks.map(tk => tk.progress || 0),
    ...bimPlans.flatMap(p => p.tasks.map(t => t.progress)),
  ];
  const totalOverall = allProgresses.length > 0
    ? Math.round(allProgresses.reduce((s, v) => s + v, 0) / allProgresses.length)
    : 0;

  const hasContent = wbsTasks.length > 0 || bimPlans.length > 0;

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #111e2d', flexShrink: 0, maxHeight: 420, overflowY: 'auto' }}>
      {/* 타이틀 */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4b5563', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        {t('wbsProgressTitle')}
      </div>

      {isLoading && (
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>{t('loading')}</div>
      )}

      {!isLoading && !hasContent && (
        <div style={{ color: '#374151', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>{t('wbsNoTasks')}</div>
      )}

      {!isLoading && hasContent && (
        <>
          {/* 전체 통합 진도 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: '#8896a4' }}>{t('wbsOverall')}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa' }}>{totalOverall}%</span>
            </div>
            <div style={{ background: '#111e2d', borderRadius: 4, height: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${totalOverall}%`, background: '#60a5fa', borderRadius: 4, transition: 'width 1.2s ease' }} />
            </div>
          </div>

          {/* WBS 태스크 */}
          {wbsTasks.length > 0 && (
            <>
              <SectionLabel label="WBS" />
              {wbsTasks.map((tk, i) => (
                <WbsBar
                  key={tk.taskId}
                  task={tk}
                  color={WBS_BAR_COLORS[i % WBS_BAR_COLORS.length]}
                  tWbs={tWbs}
                  t={t}
                />
              ))}
            </>
          )}

          {/* BIM 작업계획 태스크 */}
          {bimPlans.map(plan => (
            <div key={plan.structureId}>
              <SectionLabel label={`BIM · ${plan.structureName}`} />
              {plan.tasks.map((task, i) => (
                <BimTaskBar key={i} task={task} structName={plan.structureName} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
