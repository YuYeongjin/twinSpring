import { useMemo, useState } from 'react';
import { useT } from '../../../i18n/LanguageContext';
import { useIntegration } from '../IntegrationStore';
import { computeWorkPlan } from '../../bim/component/WorkPlanDashboard';

const PHASE_COLOR = {
  design: '#64748b', temporary: '#78716c', earthwork: '#d97706', foundation: '#f97316',
  frame: '#3b82f6', slab: '#06b6d4', wall: '#6366f1', finishing: '#22c55e',
  mep: '#14b8a6', completion: '#a855f7',
};

function fmtD(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getMonth() + 1}/${String(dt.getDate()).padStart(2, '0')}`;
}

function calcProgress(taskStart, taskEnd) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = taskStart instanceof Date ? taskStart : new Date(taskStart);
  const e = taskEnd   instanceof Date ? taskEnd   : new Date(taskEnd);
  if (today < s) return 0;
  if (today > e) return 100;
  return Math.round(((today - s) / (e - s)) * 100);
}

export default function BimWorkPlanPanel({ structure }) {
  const tWp = useT('workPlan');
  const [openIdx, setOpenIdx] = useState(null);
  const { bimSimProgress } = useIntegration();

  const { plan, tasks, overall } = useMemo(() => {
    if (!Array.isArray(structure?.elements) || !structure.elements.length)
      return { plan: null, tasks: [], overall: 0 };

    const p = computeWorkPlan(structure.elements, tWp);
    if (!p) return { plan: null, tasks: [], overall: 0 };

    const ts = p.tasks.map((task, taskIdx) => {
      const simDelta = bimSimProgress?.[`${structure.id}_${taskIdx}`] || 0;
      return { ...task, progress: Math.min(100, calcProgress(task.start, task.end) + simDelta) };
    });
    const ov = Math.round(ts.reduce((s, t) => s + t.progress, 0) / ts.length);
    return { plan: p, tasks: ts, overall: ov };
  }, [structure, tWp, bimSimProgress]);

  if (!plan) return (
    <div style={{
      background: '#060f18', border: '1px solid #1e3a5f',
      borderRadius: 6, padding: '10px 12px', marginBottom: 8,
      fontSize: 9, color: '#374151', textAlign: 'center',
    }}>
      BIM 요소 없음 — 요소를 추가하면 작업계획이 자동 생성됩니다
    </div>
  );

  return (
    <div style={{
      background: '#060f18', border: '1px solid #1e3a5f',
      borderRadius: 6, padding: '8px 10px', marginBottom: 8,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
          🏗 {structure.name}
        </span>
        <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 800, flexShrink: 0 }}>{overall}%</span>
      </div>

      {/* 전체 진도 바 */}
      <div style={{ background: '#111e2d', borderRadius: 3, height: 4, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${overall}%`, background: '#3b82f6', borderRadius: 3, transition: 'width 0.8s ease' }} />
      </div>

      {/* 요약 */}
      <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 8 }}>
        {tasks.length}개 공정 · 총 {plan.totalDays}일 · 최대 {plan.peakWorkers}명
        {plan.floorCount > 0 && ` · ${plan.floorCount}층`}
      </div>

      {/* 태스크 목록 */}
      <div>
        {tasks.map((task, i) => {
          const color = PHASE_COLOR[task.phase] || '#3b82f6';
          const isOpen = openIdx === i;
          const statusColor = task.progress >= 100 ? '#60a5fa' : task.progress > 0 ? '#22c55e' : '#374151';
          const statusLabel = task.progress >= 100 ? '완료' : task.progress > 0 ? '진행' : '예정';

          return (
            <div key={i} style={{ marginBottom: 5 }}>
              <button
                onClick={() => setOpenIdx(isOpen ? null : i)}
                style={{
                  width: '100%', background: isOpen ? '#0a1830' : 'none',
                  border: `1px solid ${isOpen ? '#1e3a5f' : 'transparent'}`,
                  borderRadius: 3, cursor: 'pointer', padding: '3px 4px', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 1, background: color, flexShrink: 0 }} />
                  <span style={{
                    fontSize: 9, color: '#94a3b8', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
                  }}>
                    {task.name}
                  </span>
                  <span style={{ fontSize: 8, color: statusColor, flexShrink: 0 }}>{statusLabel}</span>
                  <span style={{ fontSize: 9, color, fontWeight: 700, flexShrink: 0 }}>{task.progress}%</span>
                </div>
                <div style={{ background: '#111e2d', borderRadius: 2, height: 3, overflow: 'hidden', marginLeft: 11 }}>
                  <div style={{ height: '100%', width: `${task.progress}%`, background: color, borderRadius: 2, transition: 'width 0.8s ease' }} />
                </div>
              </button>

              {isOpen && (
                <div style={{
                  marginLeft: 11, marginTop: 3, padding: '4px 6px',
                  borderLeft: `2px solid ${color}`,
                  fontSize: 8, color: '#6b7280', lineHeight: 1.9,
                  background: '#04080f', borderRadius: '0 3px 3px 0',
                }}>
                  <div>📅 {fmtD(task.start)} ~ {fmtD(task.end)} · {task.days}일</div>
                  <div>👷 {task.workers}명 · <span style={{ color: '#4b5563' }}>{task.roles}</span></div>
                  <div>🔧 <span style={{ color: '#4b5563' }}>{task.equipment}</span></div>
                  {task.volume != null && <div>📦 콘크리트 {task.volume} m³</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
