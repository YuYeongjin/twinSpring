import React, { useMemo, useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import { useT } from "../../../i18n/LanguageContext";
import { getBimAutoTaskLabel } from "../bimTaskGenerator";

const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "DELAYED"];
const STATUS_LABEL = {
  NOT_STARTED: { tKey: "taskNotStarted", color: "#64748b", bg: "#1e293b" },
  IN_PROGRESS:  { tKey: "taskInProgress", color: "#60a5fa", bg: "#1e3a5f" },
  COMPLETED:    { tKey: "taskCompleted",  color: "#4ade80", bg: "#14532d" },
  DELAYED:      { tKey: "taskDelayed",    color: "#f87171", bg: "#450a0a" },
};

// 작성자 구분 (MANUAL → User, AGENT_* → Agent)
const AUTHOR_MAP = {
  MANUAL:      "user",
  AGENT_CPM:   "agent",
  AGENT_CRACK: "agent",
  AGENT_AUTO:  "agent",
  BIM_AUTO:    "bim",
};
const AUTHOR_STYLE = {
  user:  { color: "#93c5fd", bg: "#1e3a5f" },
  agent: { color: "#fbbf24", bg: "#292524" },
  bim:   { color: "#4ade80", bg: "#0c2a1a" },
};

const EMPTY_TASK = {
  wbsCode: "",
  taskName: "",
  startDate: null,
  endDate: null,
  duration: 0,
  progress: 0,
  predecessorIds: "",
  status: "NOT_STARTED",
  responsible: "",
  notes: "",
  source: "MANUAL",
  sortOrder: 0,
};

const INPUT_CLS = `
  w-full bg-[#0d1b2a] border border-[#253347] rounded px-1.5 py-0.5
  text-xs text-gray-200 outline-none focus:border-blue-500
`.trim();

// ── 계획 진행률 자동 계산 (날짜 기준) ──────────────────────────
function calcPlanProgress(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(startDate + "T00:00:00");
  const end   = new Date(endDate   + "T00:00:00");
  if (isNaN(start) || isNaN(end) || end <= start) return null;
  const dur     = Math.round((end - start) / 86400000);
  const elapsed = Math.round((today - start) / 86400000);
  if (elapsed <= 0)   return 0;
  if (elapsed >= dur) return 100;
  return Math.round((elapsed / dur) * 100);
}

// ── 시작~종료일 → 기간(일) 자동계산 ──────────────────────────
function calcDuration(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const s = new Date(startDate + "T00:00:00");
  const e = new Date(endDate   + "T00:00:00");
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.round((e - s) / 86400000);
}

// ══════════════════════════════════════════════════════════════════
//  CPM 계산 유틸
// ══════════════════════════════════════════════════════════════════
function getPredIds(t) {
  if (!t?.predecessorIds) return [];
  return t.predecessorIds.split(",").map(s => s.trim()).filter(Boolean);
}

function computeCPM(tasks) {
  if (!tasks || tasks.length === 0) return {};

  const taskMap = Object.fromEntries(tasks.map(t => [t.taskId, t]));
  const succ    = Object.fromEntries(tasks.map(t => [t.taskId, []]));
  tasks.forEach(t => {
    getPredIds(t).forEach(pid => { if (succ[pid]) succ[pid].push(t.taskId); });
  });

  const getDur = (t) => {
    const d = Number(t.duration);
    if (d > 0) return d;
    if (t.startDate && t.endDate) {
      const s = new Date(t.startDate + "T00:00:00");
      const e = new Date(t.endDate   + "T00:00:00");
      if (!isNaN(s) && !isNaN(e)) return Math.max(1, Math.round((e - s) / 86400000));
    }
    return 1;
  };

  // Kahn BFS 위상정렬
  const inDeg = Object.fromEntries(tasks.map(t => [t.taskId, 0]));
  tasks.forEach(t => {
    getPredIds(t).forEach(_ => { if (inDeg[t.taskId] !== undefined) inDeg[t.taskId]++; });
  });
  const q     = tasks.filter(t => inDeg[t.taskId] === 0).map(t => t.taskId);
  const order = [];
  const deg   = { ...inDeg };
  while (q.length) {
    const id = q.shift(); order.push(id);
    (succ[id] || []).forEach(s => { if (--deg[s] === 0) q.push(s); });
  }
  tasks.forEach(t => { if (!order.includes(t.taskId)) order.push(t.taskId); });

  // 순방향 패스
  const ES = {}, EF = {};
  order.forEach(id => {
    const t = taskMap[id]; if (!t) return;
    const preds = getPredIds(t);
    ES[id] = preds.length ? Math.max(...preds.map(p => EF[p] ?? 0)) : 0;
    EF[id] = ES[id] + getDur(t);
  });

  const projEnd = tasks.length > 0 ? Math.max(...tasks.map(t => EF[t.taskId] ?? 0)) : 0;

  // 역방향 패스
  const LF = {}, LS = {};
  [...order].reverse().forEach(id => {
    const t = taskMap[id]; if (!t) return;
    const sIds = succ[id] || [];
    LF[id] = sIds.length ? Math.min(...sIds.map(s => LS[s] ?? projEnd)) : projEnd;
    LS[id] = LF[id] - getDur(t);
  });

  const result = {};
  tasks.forEach(t => {
    const id = t.taskId;
    const tf = Math.round((LS[id] ?? 0) - (ES[id] ?? 0));
    result[id] = { ES: ES[id] ?? 0, EF: EF[id] ?? 0, LS: LS[id] ?? 0, LF: LF[id] ?? 0, totalFloat: tf, isCritical: tf <= 0 };
  });
  return result;
}

// ══════════════════════════════════════════════════════════════════
//  선행작업 다중선택 드롭다운 (Portal + fixed positioning)
// ══════════════════════════════════════════════════════════════════
function PredecessorSelect({ value, onChange, tasks, currentTaskId }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0, width: 220 });
  const triggerRef = useRef(null);

  const selected = value ? value.split(",").map(s => s.trim()).filter(Boolean) : [];
  const options   = tasks.filter(t => t.taskId && t.taskId !== currentTaskId);

  useEffect(() => {
    if (!open) return;
    function onOut(e) { if (!triggerRef.current?.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [open]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const r    = triggerRef.current.getBoundingClientRect();
      const w    = Math.max(220, r.width);
      const left = Math.min(r.left, window.innerWidth - w - 8);
      setPos({ top: r.bottom + 4, left: Math.max(8, left), width: w });
    }
    setOpen(v => !v);
  }

  function toggle(taskId) {
    const next = selected.includes(taskId)
      ? selected.filter(id => id !== taskId)
      : [...selected, taskId];
    onChange(next.join(","));
  }

  const label = selected.length > 0
    ? options.filter(t => selected.includes(t.taskId)).map(t => t.wbsCode || t.taskName).join(", ")
    : "—";

  return (
    <div ref={triggerRef} style={{ minWidth: 100 }}>
      <button type="button" onClick={handleToggle}
              className="w-full flex items-center justify-between text-left text-xs rounded px-1.5 py-0.5 outline-none"
              style={{
                backgroundColor: "#0d1b2a", border: "1px solid #253347",
                color: selected.length > 0 ? "#93c5fd" : "#4b5563", cursor: "pointer", minHeight: 24,
              }}>
        <span className="truncate">{label}</span>
        <span className="ml-1 flex-shrink-0" style={{ color: "#475569", fontSize: 10 }}>▾</span>
      </button>
      {open && ReactDOM.createPortal(
        <div style={{
          position: "fixed", top: pos.top, left: pos.left, width: pos.width,
          zIndex: 9999, backgroundColor: "#0d1b2a", border: "1px solid #253347",
          borderRadius: 8, maxHeight: 200, overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        }}>
          {options.length === 0
            ? <div className="px-3 py-2 text-xs text-gray-500">선행 작업 없음</div>
            : options.map(tk => (
              <label key={tk.taskId}
                     className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#1c2a3a] select-none">
                <input type="checkbox" checked={selected.includes(tk.taskId)}
                       onChange={() => toggle(tk.taskId)} className="accent-blue-500 flex-shrink-0" />
                <span className="text-xs truncate">
                  {tk.wbsCode && <span className="text-blue-400 mr-1 font-mono">{tk.wbsCode}</span>}
                  <span className="text-gray-200">{tk.taskName}</span>
                </span>
              </label>
            ))
          }
        </div>,
        document.body
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  계획 / 실행 이중 진행률 셀
// ══════════════════════════════════════════════════════════════════
function ProgressCell({ startDate, endDate, execProgress, isEditing, onExecChange }) {
  const t = useT('wbs');
  const plan  = calcPlanProgress(startDate, endDate);
  const exec  = Number(execProgress) || 0;
  const delta = plan !== null ? exec - plan : null;

  const deltaColor = delta === null ? "#94a3b8" : delta > 0 ? "#4ade80" : delta < 0 ? "#f87171" : "#60a5fa";
  const deltaShort = delta === null ? null : delta > 0 ? `▲ +${delta}%` : delta < 0 ? `▼ ${delta}%` : t('deltaEqual');
  const deltaTitle = delta === null ? "" : delta > 0 ? t('deltaFaster') : delta < 0 ? t('deltaSlower') : t('deltaSame');

  return (
    <div className="flex flex-col gap-1" style={{ minWidth: 130 }}>
      <div className="flex items-center gap-1">
        <span style={{ fontSize: 9, color: "#64748b", width: 22, flexShrink: 0, textAlign: "right" }}>{t('planLabel')}</span>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#1e293b", minWidth: 40 }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${plan ?? 0}%`, backgroundColor: "#3b82f6" }} />
        </div>
        <span className="font-mono flex-shrink-0" style={{ fontSize: 10, minWidth: 30, textAlign: "right", color: "#60a5fa" }}>
          {plan !== null ? `${plan}%` : "—"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span style={{ fontSize: 9, color: "#64748b", width: 22, flexShrink: 0, textAlign: "right" }}>실행</span>
        {isEditing ? (
          <input type="number" min={0} max={100} value={execProgress}
                 onChange={e => onExecChange(e.target.value)}
                 className="rounded px-1 py-0.5 outline-none focus:border-blue-500"
                 style={{ flex: 1, maxWidth: 58, fontSize: 11, backgroundColor: "#0d1b2a", border: "1px solid #253347", color: "#e2e8f0" }} />
        ) : (
          <>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#1e293b", minWidth: 40 }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${exec}%`, backgroundColor: "#22c55e" }} />
            </div>
            <span className="font-mono flex-shrink-0" style={{ fontSize: 10, minWidth: 30, textAlign: "right", color: "#4ade80" }}>
              {exec}%
            </span>
          </>
        )}
      </div>
      {!isEditing && deltaShort !== null && (
        <div className="flex justify-end">
          <span title={deltaTitle} className="font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ color: deltaColor, backgroundColor: deltaColor + "20", fontSize: 10 }}>
            {deltaShort}
          </span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  일반 편집 셀
// ══════════════════════════════════════════════════════════════════
function EditCell({ value, onChange, type = "text", options, min, max }) {
  if (options) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
              className={INPUT_CLS} style={{ minWidth: 80 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input type={type} value={value ?? ""} min={min} max={max}
           onChange={e => onChange(e.target.value)} className={INPUT_CLS} />
  );
}

// ══════════════════════════════════════════════════════════════════
//  CPM 셀 인라인 편집 (클릭하여 값 직접 입력)
// ══════════════════════════════════════════════════════════════════
function CpmCell({ value, field, taskId, isOverridden, editCell, editVal, onStart, onValChange, onSave, onCancel }) {
  const isEditing = editCell?.taskId === taskId && editCell?.field === field;

  if (isEditing) {
    return (
      <input
        type="number"
        value={editVal}
        autoFocus
        onChange={e => onValChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
        style={{
          width: 52, fontSize: 11, textAlign: "center",
          backgroundColor: "#0d1b2a", border: "1px solid #3b82f6",
          color: "#e2e8f0", borderRadius: 4, padding: "1px 4px", outline: "none",
        }}
      />
    );
  }

  return (
    <span
      title="클릭하여 수동 입력"
      onClick={() => onStart(taskId, field, value)}
      className="cursor-pointer rounded px-1"
      style={{
        color: isOverridden ? "#fbbf24" : undefined,
        textDecoration: isOverridden ? "underline dotted #fbbf2480" : undefined,
      }}
    >
      {value}
      {isOverridden && <span style={{ color: "#fbbf24", fontSize: 8, marginLeft: 2 }}>●</span>}
    </span>
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════════════════
export default function WbsTaskTable({ tasks = [], onAdd, onUpdate, onDelete, readOnly = false }) {
  const t   = useT('wbs');
  const tWp = useT('workPlan');

  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData]   = useState({});
  const [addMode, setAddMode]     = useState(false);
  const [newTask, setNewTask]     = useState({ ...EMPTY_TASK });
  const [saving, setSaving]       = useState(false);
  const [showCpm, setShowCpm]     = useState(false);

  // CPM 수동 재정의
  const [cpmOverrides, setCpmOverrides] = useState({});     // { taskId: { ES?, EF?, LS?, LF?, totalFloat? } }
  const [cpmEditCell, setCpmEditCell]   = useState(null);   // { taskId, field }
  const [cpmEditVal, setCpmEditVal]     = useState("");

  // BIM 태스크 접기/펼치기 (BIM 루트만 기본 표시)
  const [expandedBimRoots, setExpandedBimRoots] = useState(new Set());

  // BIM 루트 taskId Set — notes 가 BIM:*:ROOT 또는 BIM:*:ROOT:* 인 태스크
  const bimRootTaskIds = useMemo(
    () => new Set(
      tasks.filter(t => t.source === 'BIM_AUTO' && /^BIM:[^:]+:ROOT(:[^:]+)?$/.test(t.notes || ''))
           .map(t => t.taskId)
    ),
    [tasks]
  );

  // BIM 태스크 중 표시할 것만 필터링
  // 루트는 항상 표시, 자식(parentTaskId 가 루트)은 해당 루트가 펼쳐진 경우만 표시
  const visibleTasks = useMemo(() => {
    return tasks.filter(task => {
      if (task.source !== 'BIM_AUTO') return true;
      if (bimRootTaskIds.has(task.taskId)) return true;
      return expandedBimRoots.has(task.parentTaskId); // 직접 부모 루트가 펼쳐진 경우
    });
  }, [tasks, bimRootTaskIds, expandedBimRoots]);

  // 자동 CPM 계산
  const cpmResult = useMemo(() => computeCPM(tasks), [tasks]);

  // 자동 + 수동 재정의 병합
  const mergedCpm = useMemo(() => {
    const merged = {};
    tasks.forEach(tk => {
      const auto = cpmResult[tk.taskId] || {};
      const over = cpmOverrides[tk.taskId] || {};
      const tf   = over.totalFloat !== undefined ? over.totalFloat : auto.totalFloat ?? 0;
      merged[tk.taskId] = {
        ...auto,
        ...over,
        totalFloat:  tf,
        isCritical:  over.isCritical !== undefined ? over.isCritical : tf <= 0,
        isOverridden: Object.keys(over).length > 0,
      };
    });
    return merged;
  }, [cpmResult, cpmOverrides, tasks]);

  const criticalCount   = tasks.filter(tk => mergedCpm[tk.taskId]?.isCritical).length;
  const projectDuration = tasks.length > 0
    ? Math.max(...tasks.map(tk => mergedCpm[tk.taskId]?.EF ?? 0))
    : 0;

  // ── CPM 셀 편집 핸들러 ─────────────────────────────────────────
  function startCpmEdit(taskId, field, val) {
    setCpmEditCell({ taskId, field });
    setCpmEditVal(String(val ?? ""));
  }

  function saveCpmEdit() {
    if (!cpmEditCell) return;
    const { taskId, field } = cpmEditCell;
    const num = Number(cpmEditVal);
    setCpmOverrides(prev => {
      const next = { ...(prev[taskId] || {}), [field]: num };
      if (field === "totalFloat") next.isCritical = num <= 0;
      return { ...prev, [taskId]: next };
    });
    setCpmEditCell(null);
  }

  function cancelCpmEdit() { setCpmEditCell(null); }

  function resetCpmOverride(taskId) {
    setCpmOverrides(prev => { const n = { ...prev }; delete n[taskId]; return n; });
  }

  // ── 날짜 변경 → 기간 자동계산 ──────────────────────────────────
  function applyDateChange(setter, prev, field, val) {
    const next = { ...prev, [field]: val };
    const s = field === "startDate" ? val : prev.startDate;
    const e = field === "endDate"   ? val : prev.endDate;
    const dur = calcDuration(s, e);
    if (dur > 0) next.duration = dur;
    setter(next);
  }

  // ── 편집 ──────────────────────────────────────────────────────
  function startEdit(task) { setEditingId(task.taskId); setEditData({ ...task }); }
  function cancelEdit()    { setEditingId(null); setEditData({}); }

  async function saveEdit() {
    if (!editData.taskName?.trim()) return;
    setSaving(true);
    try { await onUpdate(editingId, editData); setEditingId(null); }
    finally { setSaving(false); }
  }

  // ── 신규 추가 ─────────────────────────────────────────────────
  async function saveNew() {
    if (!newTask.taskName?.trim()) return;
    setSaving(true);
    try {
      await onAdd({ ...newTask, sortOrder: tasks.length });
      setNewTask({ ...EMPTY_TASK }); setAddMode(false);
    } finally { setSaving(false); }
  }

  // ── 삭제 ─────────────────────────────────────────────────────
  async function handleDelete(taskId) {
    if (!window.confirm(t('deleteTaskConfirm'))) return;
    await onDelete(taskId);
  }

  // ── 세터 팩토리 ────────────────────────────────────────────────
  function makeEditSetter(field) {
    return (val) => {
      if (field === "startDate" || field === "endDate") {
        applyDateChange(setEditData, editData, field, val);
      } else {
        setEditData(prev => ({ ...prev, [field]: val }));
      }
    };
  }

  function makeNewSetter(field) {
    return (val) => {
      if (field === "startDate" || field === "endDate") {
        setNewTask(prev => {
          const next = { ...prev, [field]: val };
          const s = field === "startDate" ? val : prev.startDate;
          const e = field === "endDate"   ? val : prev.endDate;
          const dur = calcDuration(s, e);
          if (dur > 0) next.duration = dur;
          return next;
        });
      } else {
        setNewTask(prev => ({ ...prev, [field]: val }));
      }
    };
  }

  // ── 선행작업 읽기 표시 ─────────────────────────────────────────
  function renderPredLabel(predecessorIds) {
    if (!predecessorIds) return <span className="text-gray-600">—</span>;
    const ids = predecessorIds.split(",").map(s => s.trim()).filter(Boolean);
    return (
      <div className="flex flex-wrap gap-0.5">
        {ids.map(id => {
          const found = tasks.find(tk => tk.taskId === id);
          const lb    = found ? (found.wbsCode || found.taskName) : id;
          return (
            <span key={id} className="px-1 py-0.5 rounded font-mono"
                  style={{ backgroundColor: "#1e3a5f", color: "#93c5fd", fontSize: 10 }}>
              {lb}
            </span>
          );
        })}
      </div>
    );
  }

  // ── 작성자 배지 ───────────────────────────────────────────────
  function renderAuthorBadge(source) {
    const type  = AUTHOR_MAP[source] || "user";
    const style = AUTHOR_STYLE[type];
    const label = type === "bim" ? "🏗 BIM" : type === "user" ? t('authorUser') : t('authorAgent');
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap"
            style={{ backgroundColor: style.bg, color: style.color }}>
        {label}
      </span>
    );
  }

  // ── 열 정의 ───────────────────────────────────────────────────
  const COL = [
    { key: "wbsCode",        label: t('colCode'),         w: 64,  sticky: true },
    { key: "taskName",       label: t('colName'),         w: 160 },
    { key: "startDate",      label: t('colStart'),        w: 96,  type: "date" },
    { key: "endDate",        label: t('colEnd'),          w: 96,  type: "date" },
    { key: "duration",       label: t('colDays'),         w: 50,  type: "number" },
    { key: "progress",       label: t('colProgress'),     w: 150, custom: true },
    { key: "status",         label: t('colStatus'),       w: 90  },
    { key: "responsible",    label: t('colResponsible'),  w: 80  },
    { key: "predecessorIds", label: t('colPredecessors'), w: 110, custom: true },
    { key: "notes",          label: t('colNotes'),        w: 120 },
  ];

  const statusOptions = STATUS_OPTIONS.map(s => ({ value: s, label: t(STATUS_LABEL[s].tKey) }));

  function renderEditCell(task, col, data, makeSetter) {
    if (col.key === "progress") {
      return (
        <ProgressCell startDate={data.startDate} endDate={data.endDate}
                      execProgress={data.progress ?? 0} isEditing
                      onExecChange={makeSetter("progress")} />
      );
    }
    if (col.key === "predecessorIds") {
      return (
        <PredecessorSelect value={data.predecessorIds || ""} onChange={makeSetter("predecessorIds")}
                           tasks={tasks} currentTaskId={task?.taskId} />
      );
    }
    if (col.key === "status") {
      return <EditCell value={data.status || "NOT_STARTED"} onChange={makeSetter("status")} options={statusOptions} />;
    }
    return (
      <EditCell value={data[col.key] ?? ""} onChange={makeSetter(col.key)}
                type={col.type || "text"} min={col.min} max={col.max} />
    );
  }

  function renderReadCell(task, col) {
    if (col.key === "progress") {
      const isBimLinked = /^BIM:[^:]+:[^:]+/.test(task.notes || '');
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ProgressCell startDate={task.startDate} endDate={task.endDate}
                        execProgress={task.progress ?? 0} isEditing={false} />
          {isBimLinked && (
            <span style={{
              fontSize: 8, color: '#4ade80', background: '#0c2a1a',
              border: '1px solid #22c55e30', borderRadius: 3,
              padding: '0 4px', lineHeight: '14px', alignSelf: 'flex-start',
              whiteSpace: 'nowrap',
            }}>
              통합관제
            </span>
          )}
        </div>
      );
    }
    if (col.key === "predecessorIds") return renderPredLabel(task.predecessorIds);
    if (col.key === "status") {
      const s = STATUS_LABEL[task.status] || STATUS_LABEL.NOT_STARTED;
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap"
              style={{ backgroundColor: s.bg, color: s.color }}>{t(s.tKey)}</span>
      );
    }
    if (col.key === "taskName") {
      const isChild = !!task.parentTaskId;
      const label = getBimAutoTaskLabel(task, tWp) || task.taskName || "";
      const isBimRoot  = bimRootTaskIds.has(task.taskId);
      const hasChildren = isBimRoot && tasks.some(t => t.parentTaskId === task.taskId);
      const isExpanded  = expandedBimRoots.has(task.taskId);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: isChild ? 12 : 0 }}>
          {isChild && <span style={{ color: '#253347', fontSize: 10, flexShrink: 0 }}>└</span>}
          {isBimRoot && hasChildren && (
            <button
              onClick={e => {
                e.stopPropagation();
                setExpandedBimRoots(prev => {
                  const next = new Set(prev);
                  if (next.has(task.taskId)) next.delete(task.taskId); else next.add(task.taskId);
                  return next;
                });
              }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '0 2px', color: '#3b82f6', fontSize: 11, flexShrink: 0, lineHeight: 1,
              }}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          )}
          <span className="text-xs break-all" style={{ color: isChild ? '#94a3b8' : '#e2e8f0' }}>
            {label}
          </span>
        </div>
      );
    }
    if (col.key === "wbsCode") {
      const isChild = !!task.parentTaskId;
      return (
        <span className="text-xs font-mono"
              style={{ color: isChild ? '#475569' : '#93c5fd' }}>
          {task.wbsCode ?? ""}
        </span>
      );
    }
    if (col.key === "notes") {
      const val = task[col.key];
      return (
        <span
          className="text-xs text-gray-300"
          style={{
            display: "block",
            maxWidth: 200,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            textDecoration: val ? "underline" : "none",
            textDecorationColor: "#475569",
            textDecorationStyle: "dotted",
          }}
          title={val || ""}
        >
          {val || "—"}
        </span>
      );
    }
    return <span className="text-xs text-gray-300 break-all">{task[col.key] ?? ""}</span>;
  }

  // sticky 스타일 헬퍼
  function stickyThStyle(col) {
    if (!col.sticky) return { minWidth: col.w };
    return { minWidth: col.w, position: "sticky", left: 0, zIndex: 3, backgroundColor: "#0a1521", boxShadow: "2px 0 6px rgba(0,0,0,0.4)" };
  }
  function stickyTdStyle(col, rowBg, isCritical) {
    const base = { minWidth: col.w, borderLeft: col.key === "wbsCode" && isCritical ? "2px solid #ef4444" : undefined };
    if (!col.sticky) return base;
    return { ...base, position: "sticky", left: 0, zIndex: 1, backgroundColor: rowBg, boxShadow: "2px 0 6px rgba(0,0,0,0.4)" };
  }

  // ── 액션 버튼 스타일 ───────────────────────────────────────────
  const btnEdit = {
    className: "px-2 py-1 rounded text-xs font-medium transition whitespace-nowrap",
    style:     { border: "1px solid #253347", color: "#93c5fd", backgroundColor: "transparent" },
  };
  const btnDel = {
    className: "px-2 py-1 rounded text-xs font-medium transition whitespace-nowrap",
    style:     { border: "1px solid #450a0a", color: "#f87171", backgroundColor: "transparent" },
  };
  const btnSave = {
    className: "px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap",
    style:     { backgroundColor: "#1d4ed8" },
  };
  const btnCancel = {
    className: "px-2 py-1 rounded text-xs font-medium transition whitespace-nowrap",
    style:     { border: "1px solid #253347", color: "#64748b" },
  };

  return (
    <div>
      {/* ── CPM 분석 툴바 ── */}
      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {criticalCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                    style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                {t('cpmCriticalBadge')} ×{criticalCount}
              </span>
            )}
            <span className="whitespace-nowrap" style={{ color: "#94a3b8" }}>
              {t('cpmAnalysis')} <strong style={{ color: "#60a5fa" }}>{t('cpmDays', { n: projectDuration })}</strong>
            </span>
          </div>
          <button onClick={() => setShowCpm(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap"
                  style={{
                    backgroundColor: showCpm ? "#1e3a5f" : "#1c2a3a",
                    border: `1px solid ${showCpm ? "#3b82f6" : "#253347"}`,
                    color: showCpm ? "#60a5fa" : "#8896a4",
                  }}>
            {showCpm ? t('cpmHideBtn') : t('cpmShowBtn')}
          </button>
        </div>
      )}

      {/* ── WBS 테이블 ── */}
      <div className="overflow-x-auto rounded-lg" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="border-collapse text-xs" style={{ minWidth: "max-content", width: "100%" }}>
          <thead>
            <tr style={{ backgroundColor: "#0a1521" }}>
              {COL.map(c => (
                <th key={c.key}
                    className="px-2 py-2 text-left font-semibold text-gray-400 border-b border-[#1e3a5f] whitespace-nowrap"
                    style={stickyThStyle(c)}>
                  {c.key === "progress"
                    ? <span>{t('colProgress')}<span className="ml-1 font-normal" style={{ color: "#475569", fontSize: 10 }}>(계획/실행)</span></span>
                    : c.label}
                </th>
              ))}
              {/* 작성자 열 */}
              <th className="px-2 py-2 text-left font-semibold text-gray-400 border-b border-[#1e3a5f] whitespace-nowrap"
                  style={{ minWidth: 56 }}>
                {t('colAuthor')}
              </th>
              {!readOnly && (
                <th className="px-2 py-2 border-b border-[#1e3a5f]" style={{ minWidth: 100 }} />
              )}
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((task, idx) => {
              const isEditing  = editingId === task.taskId;
              const isCritical = mergedCpm[task.taskId]?.isCritical;
              const isChild    = !!task.parentTaskId;
              const rowBg = isCritical
                ? (idx % 2 === 0 ? "#1a0a0a" : "#160808")
                : isChild
                  ? (idx % 2 === 0 ? "#08121e" : "#060f1a")
                  : (idx % 2 === 0 ? "#0d1b2a" : "#0a1521");

              return (
                <tr key={task.taskId} style={{ backgroundColor: rowBg }}
                    className="hover:bg-[#1e2d3d] transition-colors">
                  {COL.map(col => (
                    <td key={col.key} className="px-2 py-2 border-b border-[#1a2a3a] align-top"
                        style={stickyTdStyle(col, rowBg, isCritical)}>
                      {isEditing && !readOnly
                        ? renderEditCell(task, col, editData, makeEditSetter)
                        : renderReadCell(task, col)}
                    </td>
                  ))}
                  {/* 작성자 */}
                  <td className="px-2 py-2 border-b border-[#1a2a3a] align-top">
                    {renderAuthorBadge(task.source)}
                  </td>
                  {/* 액션 버튼 */}
                  {!readOnly && (
                    <td className="px-2 py-2 border-b border-[#1a2a3a] align-top">
                      {isEditing ? (
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={saveEdit} disabled={saving} {...btnSave}>
                            {saving ? "…" : t('saveBtn')}
                          </button>
                          <button onClick={cancelEdit} {...btnCancel}>{t('cancel')}</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 flex-wrap">
                          <button onClick={() => startEdit(task)} {...btnEdit}>{t('editBtn')}</button>
                          <button onClick={() => handleDelete(task.taskId)} {...btnDel}>{t('deleteBtn')}</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}

            {/* 신규 행 */}
            {!readOnly && addMode && (
              <tr style={{ backgroundColor: "#1e3a5f22" }}>
                {COL.map(col => (
                  <td key={col.key} className="px-2 py-2 border-b border-[#1e3a5f] align-top"
                      style={{ minWidth: col.w }}>
                    {renderEditCell(null, col, newTask, makeNewSetter)}
                  </td>
                ))}
                <td className="px-2 py-2 border-b border-[#1e3a5f] align-top">
                  {renderAuthorBadge("MANUAL")}
                </td>
                <td className="px-2 py-2 border-b border-[#1e3a5f] align-top">
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={saveNew} disabled={saving || !newTask.taskName?.trim()} {...btnSave}>
                      {saving ? "…" : t('addTask')}
                    </button>
                    <button onClick={() => { setAddMode(false); setNewTask({ ...EMPTY_TASK }); }} {...btnCancel}>
                      {t('cancel')}
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 행 추가 버튼 */}
      {!readOnly && !addMode && (
        <button onClick={() => setAddMode(true)}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-400 hover:text-white transition"
                style={{ border: "1px dashed #1d4ed8" }}>
          {t('addTask')}
        </button>
      )}

      {tasks.length === 0 && !addMode && (
        <div className="py-12 text-center text-gray-500 text-sm">
          <div className="text-3xl mb-2">📋</div>
          <p>{t('noTasksMsg')}</p>
          {!readOnly && <p className="text-xs mt-1 text-gray-600">{t('noTasksAddHint')}</p>}
        </div>
      )}

      {/* ══ CPM 분석 패널 ══════════════════════════════════════════ */}
      {showCpm && tasks.length > 0 && (
        <div className="mt-4 rounded-xl overflow-hidden"
             style={{ border: "1px solid #1e3a5f", backgroundColor: "#0a1521" }}>

          {/* 헤더 */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
               style={{ backgroundColor: "#0d1b2a", borderBottom: "1px solid #1e3a5f" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm text-blue-400 whitespace-nowrap">{t('cpmPanelTitle')}</span>
              <span className="text-xs whitespace-nowrap" style={{ color: "#94a3b8" }}>
                {t('criticalDays', { n: projectDuration })}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                    style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                {t('criticalCount', { n: criticalCount })}
              </span>
              {Object.keys(cpmOverrides).length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ backgroundColor: "#292524", color: "#fbbf24", border: "1px solid #78350f" }}>
                  {t('cpmManualTag')} {Object.keys(cpmOverrides).length}건
                </span>
              )}
            </div>
            <p className="text-xs hidden sm:block whitespace-nowrap flex-shrink-0" style={{ color: "#475569" }}>
              ES/EF · LS/LF · TF=0→주공정
            </p>
          </div>

          {/* 안내 문구 */}
          <div className="px-4 py-1.5 text-xs" style={{ color: "#64748b", backgroundColor: "#0d1b2a", borderBottom: "1px solid #1a2a3a" }}>
            💡 {t('cpmManualHint')}
          </div>

          {/* CPM 테이블 */}
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="text-xs border-collapse" style={{ minWidth: "max-content", width: "100%" }}>
              <thead>
                <tr style={{ backgroundColor: "#0d1b2a" }}>
                  {[
                    { label: t('colCode'),        w: 64  },
                    { label: t('colName'),        w: 160 },
                    { label: t('cpmColDuration'), w: 56  },
                    { label: t('cpmColEs'),       w: 56  },
                    { label: t('cpmColEf'),       w: 56  },
                    { label: t('cpmColLs'),       w: 56  },
                    { label: t('cpmColLf'),       w: 56  },
                    { label: t('cpmColFloat'),    w: 80  },
                    { label: t('cpmColType'),     w: 80  },
                    { label: "",                  w: 60  },  // 초기화 버튼
                  ].map((c, i) => (
                    <th key={i}
                        className="px-3 py-2 text-left font-semibold border-b border-[#1e3a5f] whitespace-nowrap"
                        style={{ minWidth: c.w, color: "#8896a4" }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, idx) => {
                  const cpm = mergedCpm[task.taskId];
                  if (!cpm) return null;
                  const isOver = cpm.isOverridden;
                  const over   = cpmOverrides[task.taskId] || {};
                  const dur = Number(task.duration) || (() => {
                    if (task.startDate && task.endDate) {
                      const s = new Date(task.startDate + "T00:00:00");
                      const e = new Date(task.endDate   + "T00:00:00");
                      return Math.max(1, Math.round((e - s) / 86400000));
                    }
                    return 1;
                  })();
                  const rowBg = cpm.isCritical
                    ? (idx % 2 === 0 ? "#1a0a0a" : "#160808")
                    : (idx % 2 === 0 ? "#0a1521" : "#0d1b2a");

                  // 공통 CpmCell props
                  const cpmCellProps = { taskId: task.taskId, editCell: cpmEditCell, editVal: cpmEditVal, onStart: startCpmEdit, onValChange: setCpmEditVal, onSave: saveCpmEdit, onCancel: cancelCpmEdit };

                  return (
                    <tr key={task.taskId} style={{ backgroundColor: rowBg }}
                        className="hover:bg-[#1e2d3d] transition-colors">
                      {/* WBS 코드 */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] font-mono"
                          style={{ color: "#64748b", borderLeft: cpm.isCritical ? "2px solid #ef4444" : undefined }}>
                        {task.wbsCode || "-"}
                      </td>
                      {/* 작업명 */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] font-medium"
                          style={{ color: cpm.isCritical ? "#fca5a5" : "#e2e8f0" }}>
                        {task.taskName}
                        {isOver && (
                          <span className="ml-1 text-xs px-1 py-0.5 rounded font-normal"
                                style={{ backgroundColor: "#292524", color: "#fbbf24", fontSize: 9 }}>
                            {t('cpmManualTag')}
                          </span>
                        )}
                      </td>
                      {/* 기간 */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center" style={{ color: "#94a3b8" }}>{dur}</td>
                      {/* ES */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-blue-300">
                        <CpmCell value={cpm.ES} field="ES" isOverridden={over.ES !== undefined} {...cpmCellProps} />
                      </td>
                      {/* EF */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-blue-300">
                        <CpmCell value={cpm.EF} field="EF" isOverridden={over.EF !== undefined} {...cpmCellProps} />
                      </td>
                      {/* LS */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-purple-300">
                        <CpmCell value={cpm.LS} field="LS" isOverridden={over.LS !== undefined} {...cpmCellProps} />
                      </td>
                      {/* LF */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-purple-300">
                        <CpmCell value={cpm.LF} field="LF" isOverridden={over.LF !== undefined} {...cpmCellProps} />
                      </td>
                      {/* TF */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center">
                        <span className={`font-bold ${cpm.isCritical ? "text-red-400" : "text-green-400"}`}>
                          <CpmCell value={cpm.totalFloat} field="totalFloat"
                                   isOverridden={over.totalFloat !== undefined} {...cpmCellProps} />
                        </span>
                      </td>
                      {/* 구분 */}
                      <td className="px-3 py-2 border-b border-[#1a2a3a]">
                        {cpm.isCritical ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap"
                                style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                            {t('cpmCriticalBadge')}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs whitespace-nowrap"
                                style={{ backgroundColor: "#14532d", color: "#4ade80", border: "1px solid #166534" }}>
                            {t('cpmFloatBadge', { n: cpm.totalFloat })}
                          </span>
                        )}
                      </td>
                      {/* 초기화 버튼 */}
                      <td className="px-2 py-2 border-b border-[#1a2a3a] text-center">
                        {isOver && (
                          <button onClick={() => resetCpmOverride(task.taskId)}
                                  className="px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap transition"
                                  style={{ border: "1px solid #78350f", color: "#fbbf24", backgroundColor: "transparent" }}>
                            {t('cpmReset')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 범례 */}
          <div className="px-4 py-2.5 flex items-center gap-3 text-xs flex-wrap"
               style={{ borderTop: "1px solid #1e3a5f", color: "#475569" }}>
            <span className="hidden sm:inline">💡 {t('cpmHint')}</span>
            <span className="sm:hidden">💡 CPM 분석</span>
            <span style={{ color: "#60a5fa" }}>{t('cpmForward')}</span>
            <span style={{ color: "#a78bfa" }}>{t('cpmBackward')}</span>
            <span style={{ color: "#ef4444" }}>{t('cpmDef')}</span>
            <span style={{ color: "#fbbf24" }}>● = {t('cpmManualTag')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
