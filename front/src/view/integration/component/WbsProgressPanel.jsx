import { useMemo, useState } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';
import AxiosCustom from '../../../axios/AxiosCustom';
import { detectFloors, getFloorLabel, getElementFloorIndex } from '../floorUtils';

// ── WBS notes → BIM 부재 매핑 헬퍼 ─────────────────────────────
function parseWbsNotes(notes) {
  const pm = (notes || '').match(/^BIM:([^:]+):PLAN:(\d+):([^:]+?)(?::(\d+))?$/);
  if (pm) return { format: 'PLAN', bimProjectId: pm[1], planIdx: parseInt(pm[2]), phase: pm[3], floorIdx: pm[4] != null ? parseInt(pm[4]) : null };
  const fm = (notes || '').match(/^BIM:([^:]+):FLOOR:(\d+):(FRAME|SLAB)$/);
  if (fm) return { format: 'FLOOR', bimProjectId: fm[1], floorIdx: parseInt(fm[2]), workType: fm[3] };
  return null;
}
const PHASE_TO_ELEM_TYPES = {
  slab:      new Set(['IfcSlab']),
  frame:     new Set(['IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPier']),
  wall:      new Set(['IfcWall', 'IfcCurtainWall', 'IfcRailing']),
  finishing: new Set(['IfcDoor', 'IfcWindow', 'IfcStair', 'IfcRoof']),
  mep:       new Set(['IfcPipe', 'IfcDuct', 'IfcFlowSegment', 'IfcFlowFitting']),
};
const FLOOR_FRAME_TYPES = new Set(['IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPier', 'IfcWall']);
const FLOOR_SLAB_TYPES  = new Set(['IfcSlab']);
const PHASE_LABEL_KO = {
  earthwork:'토공사', foundation:'기초공사', slab:'슬래브', frame:'골조',
  wall:'벽체', finishing:'마감', mep:'설비·전기', completion:'준공',
};

function WbsElementCard({ task, structures, t }) {
  const parsed      = parseWbsNotes(task.notes);
  const bimProjectId = parsed?.bimProjectId ?? null;
  const phase        = parsed?.format === 'PLAN' ? (parsed.phase ?? null) : null;
  const workType     = parsed?.format === 'FLOOR' ? (parsed.workType ?? null) : null;
  const floorIdx     = parsed?.floorIdx ?? null;

  const struct   = useMemo(
    () => bimProjectId ? structures.find(s => String(s.bimProjectId) === String(bimProjectId)) : null,
    [bimProjectId, structures],
  );
  const allElems = struct?.elements || [];
  const floors   = useMemo(() => detectFloors(allElems), [allElems]);

  const matchTypes = useMemo(() => {
    if (phase) return PHASE_TO_ELEM_TYPES[phase] ?? null;
    if (workType === 'FRAME') return FLOOR_FRAME_TYPES;
    if (workType === 'SLAB')  return FLOOR_SLAB_TYPES;
    return null;
  }, [phase, workType]);

  const matched = useMemo(() => {
    if (!matchTypes) return [];
    return allElems.filter(el => {
      if (!matchTypes.has(el.elementType)) return false;
      if (floorIdx != null && floors.length > 0) {
        return getElementFloorIndex(el, floors) === floorIdx;
      }
      return true;
    });
  }, [allElems, matchTypes, floorIdx, floors]);

  const byType = useMemo(() => {
    const m = {};
    matched.forEach(el => { m[el.elementType] = (m[el.elementType] || 0) + 1; });
    return m;
  }, [matched]);

  if (!parsed) return null;

  const floorLabel = floorIdx !== null ? getFloorLabel(floorIdx, floors, t) : null;
  const phaseKo    = phase
    ? (PHASE_LABEL_KO[phase] || phase)
    : workType === 'FRAME' ? '골조공사' : workType === 'SLAB' ? '슬래브공사' : '';

  return (
    <div style={{ margin:'4px 0 3px', padding:'7px 9px', background:'#071828', border:'1px solid #22d3ee40', borderRadius:4, borderLeft:'2px solid #22d3ee' }}>
      <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:5 }}>
        {struct && (
          <span style={{ fontSize:8, color:'#94a3b8', background:'#0f2336', padding:'2px 6px', borderRadius:3 }}>
            🏗 {struct.name.length > 16 ? struct.name.slice(0,16)+'…' : struct.name}
          </span>
        )}
        {floorLabel && (
          <span style={{ fontSize:8, color:'#22d3ee', background:'#0a2a30', padding:'2px 6px', borderRadius:3 }}>
            {floorLabel}
          </span>
        )}
        <span style={{ fontSize:8, color:'#f59e0b', background:'#1c1500', padding:'2px 6px', borderRadius:3 }}>
          {phaseKo}
        </span>
      </div>
        <>
          <div style={{ fontSize:8, color:'#22d3ee', fontWeight:700, marginBottom:3 }}>
            ✦ 하이라이트 부재 {matched.length}개
          </div>
          {Object.entries(byType).length > 0
            ? Object.entries(byType).map(([type, cnt]) => (
                <div key={type} style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#64748b', marginBottom:2, paddingLeft:4 }}>
                  <span style={{ color:'#38bdf8' }}>{type}</span>
                  <span style={{ color:'#94a3b8' }}>{cnt}개</span>
                </div>
              ))
            : <div style={{ fontSize:8, color:'#374151' }}>
                {allElems.length === 0 ? 'BIM 부재 로딩 중…' : '해당 층·공종 부재 없음'}
              </div>
          }
        </>

    </div>
  );
}

const TASK_STATUS_META = {
  NOT_STARTED: { labelKey: 'taskNotStarted', color: '#94a3b8' },
  IN_PROGRESS: { labelKey: 'taskInProgress', color: '#60a5fa' },
  COMPLETED:   { labelKey: 'taskCompleted',  color: '#4ade80' },
  DELAYED:     { labelKey: 'taskDelayed',    color: '#ef4444' },
};
const WBS_BAR_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#a855f7', '#f97316', '#06b6d4'];

// ── 시방서 패널 ──────────────────────────────────────────────
function SpecPanel({ citations, loading, hasData, t }) {
  if (loading) return (
    <div style={{ fontSize: 9, color: '#60a5fa', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
      ⏳ {t('specSearching')}
    </div>
  );
  if (!hasData || !citations?.length) return (
    <div style={{ fontSize: 9, color: '#374151', padding: '3px 0' }}>{t('specNone')}</div>
  );
  return (
    <div style={{ marginTop: 3 }}>
      {citations.map((c, i) => (
        <div key={i} style={{ marginBottom: 4, padding: '4px 6px', background: '#060f18', borderRadius: 3, border: '1px solid #1e3a5f' }}>
          <div style={{ fontSize: 8, color: '#60a5fa', fontWeight: 700, marginBottom: 2 }}>
            📋 {c.source}
            {c.series && <span style={{ color: '#4b5563', fontWeight: 400 }}> · {c.series}</span>}
          </div>
          <div style={{ fontSize: 8, color: '#94a3b8', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {c.content.length > 180 ? c.content.slice(0, 180) + '…' : c.content}
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

// ── WBS 트리 빌더 ────────────────────────────────────────────
function buildTree(tasks) {
  const byId = {};
  tasks.forEach(t => { byId[t.taskId] = { ...t, children: [] }; });
  const roots = [];
  tasks.forEach(t => {
    if (t.parentTaskId && byId[t.parentTaskId]) {
      byId[t.parentTaskId].children.push(byId[t.taskId]);
    } else {
      roots.push(byId[t.taskId]);
    }
  });
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    nodes.forEach(n => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

// ── WBS 트리 노드 ────────────────────────────────────────────
function WbsTreeNode({ node, depth, color, tWbs, t }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const dispatch = useIntegrationDispatch();
  const { selectedWbsTaskId, structures } = useIntegration();
  const isBimTask  = /^BIM:[^:]+:(PLAN|FLOOR|ROOT):/.test(node.notes || '');
  const isSelected = selectedWbsTaskId === node.taskId;
  const hasChildren = node.children.length > 0;
  const p  = Math.min(100, node.progress ?? 0);
  const sm = TASK_STATUS_META[node.status];
  const spec = useSpecQuery(node.taskName, node.status);
  const indent = depth * 10;

  const handleRowClick = () => {
    if (hasChildren) setExpanded(v => !v);
    if (isBimTask) dispatch({ type: 'SELECT_WBS_TASK', taskId: node.taskId });
  };

  return (
    <div>
      {/* 태스크 헤더 행 */}
      <div
        onClick={handleRowClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          paddingLeft: 4 + indent, paddingRight: 4, paddingTop: 3, paddingBottom: 2,
          borderRadius: 3, marginBottom: 1,
          cursor: (hasChildren || isBimTask) ? 'pointer' : 'default',
          background: isSelected ? '#0a2a30' : 'transparent',
          border: isSelected ? '1px solid #22d3ee40' : '1px solid transparent',
          transition: 'background 0.12s',
        }}
      >
        <span style={{ fontSize: 8, color: '#374151', flexShrink: 0, width: 10, textAlign: 'center' }}>
          {hasChildren ? (expanded ? '▾' : '▸') : '·'}
        </span>
        {isBimTask && <span style={{ fontSize: 8, opacity: 0.55, flexShrink: 0 }}>🔗</span>}
        <span style={{
          fontSize: depth === 0 ? 10 : 9,
          fontWeight: depth === 0 ? 600 : 400,
          color: isSelected ? '#22d3ee' : depth === 0 ? '#cbd5e1' : '#8896a4',
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          transition: 'color 0.12s',
        }}>
          {node.taskName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {sm && depth === 0 && (
            <span style={{ fontSize: 7, color: sm.color, fontWeight: 700 }}>{tWbs(sm.labelKey)}</span>
          )}
          <span style={{ fontSize: depth === 0 ? 10 : 9, fontWeight: 700, color }}>{Math.round(p)}%</span>
          <button
            onClick={e => { e.stopPropagation(); spec.toggle(e); }}
            title={t('specQueryTitle')}
            style={{
              background: 'none', border: '1px solid #1e3a5f', borderRadius: 3,
              cursor: 'pointer', color: spec.open ? '#93c5fd' : '#4b6a8a',
              fontSize: 8, padding: '1px 4px', lineHeight: 1.4,
            }}
          >📋</button>
        </div>
      </div>

      {/* 진도 바 */}
      <div style={{ marginBottom: 4, paddingLeft: 14 + indent, paddingRight: 4 }}>
        <div style={{ background: '#1a2d44', borderRadius: 3, height: depth === 0 ? 4 : 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${p}%`,
            background: isSelected ? '#22d3ee' : color,
            borderRadius: 3, transition: 'width 1.2s ease, background 0.2s',
          }} />
        </div>
      </div>

      {/* 시방서 패널 */}
      {spec.open && (
        <div style={{ paddingLeft: 14 + indent, paddingRight: 4 }}>
          <SpecPanel citations={spec.data?.citations} loading={spec.loading} hasData={spec.data?.hasData} t={t} />
        </div>
      )}

      {/* BIM 부재 카드 — PLAN/FLOOR 태스크에서만 (ROOT 제외) */}
      {isSelected && /^BIM:[^:]+:(PLAN|FLOOR):/.test(node.notes || '') && (
        <div style={{ paddingLeft: 14 + indent, paddingRight: 4 }}>
          <WbsElementCard task={node} structures={structures} t={t} />
        </div>
      )}

      {/* 자식 노드들 */}
      {expanded && hasChildren && (
        <div style={{ borderLeft: `1px solid ${color}25`, marginLeft: 9 + indent }}>
          {node.children.map(child => (
            <WbsTreeNode key={child.taskId} node={child} depth={depth + 1} color={color} tWbs={tWbs} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 메인 패널 ────────────────────────────────────────────────
export default function WbsProgressPanel() {
  const t    = useT('integrationProject');
  const tWbs = useT('wbs');
  const { wbsTasks, isLoading } = useIntegration();

  const wbsOverall = wbsTasks.length > 0
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / wbsTasks.length)
    : 0;

  const wbsTree = useMemo(() => buildTree(wbsTasks), [wbsTasks]);

  const hasContent = wbsTasks.length > 0;

  return (
    <div style={{ padding: '10px 12px', borderTop: '2px solid #1e3a5f', flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {/* 타이틀 */}
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        {t('wbsProgressTitle')}
      </div>

      {isLoading && (
        <div style={{ color: '#6b7280', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>{t('loading')}</div>
      )}

      {!isLoading && !hasContent && (
        <div style={{ color: '#6b7280', fontSize: 10, textAlign: 'center', padding: '8px 0' }}>{t('wbsNoTasks')}</div>
      )}

      {!isLoading && hasContent && (
        <>
          {/* 전체 진도 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{t('wbsOverall')}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa' }}>{wbsOverall}%</span>
            </div>
            <div style={{ background: '#1a2d44', borderRadius: 4, height: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${wbsOverall}%`, background: '#60a5fa', borderRadius: 4, transition: 'width 1.2s ease' }} />
            </div>
          </div>

          {/* WBS 트리 */}
          {wbsTree.map((root, i) => (
            <WbsTreeNode
              key={root.taskId}
              node={root}
              depth={0}
              color={WBS_BAR_COLORS[i % WBS_BAR_COLORS.length]}
              tWbs={tWbs}
              t={t}
            />
          ))}
        </>
      )}
    </div>
  );
}
