import React, { useMemo, useState } from "react";

const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "DELAYED"];
const STATUS_LABEL = {
  NOT_STARTED: { ko: "미착수", color: "#64748b", bg: "#1e293b" },
  IN_PROGRESS:  { ko: "진행중", color: "#60a5fa", bg: "#1e3a5f" },
  COMPLETED:    { ko: "완료",   color: "#4ade80", bg: "#14532d" },
  DELAYED:      { ko: "지연",   color: "#f87171", bg: "#450a0a" },
};

const SOURCE_BADGE = {
  MANUAL:      { label: "✏️",  color: "#94a3b8" },
  AGENT_CPM:   { label: "🔗",  color: "#f59e0b" },
  AGENT_CRACK: { label: "🔍",  color: "#f87171" },
  AGENT_AUTO:  { label: "🤖",  color: "#a78bfa" },
};

const EMPTY_TASK = {
  wbsCode: "",
  taskName: "",
  startDate: "",
  endDate: "",
  duration: "",
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

  const succ = Object.fromEntries(tasks.map(t => [t.taskId, []]));
  tasks.forEach(t => {
    getPredIds(t).forEach(pid => { if (succ[pid]) succ[pid].push(t.taskId); });
  });

  const getDur = (t) => {
    const d = Number(t.duration);
    if (d > 0) return d;
    if (t.startDate && t.endDate) {
      const s = new Date(t.startDate + "T00:00:00");
      const e = new Date(t.endDate + "T00:00:00");
      if (!isNaN(s) && !isNaN(e)) return Math.max(1, Math.round((e - s) / 86400000));
    }
    return 1;
  };

  // Kahn BFS 위상정렬
  const inDeg = Object.fromEntries(tasks.map(t => [t.taskId, 0]));
  tasks.forEach(t => {
    getPredIds(t).forEach(pid => { if (inDeg[t.taskId] !== undefined) inDeg[t.taskId]++; });
  });
  const q = tasks.filter(t => inDeg[t.taskId] === 0).map(t => t.taskId);
  const order = [];
  const deg = { ...inDeg };
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
    result[id] = {
      ES: ES[id] ?? 0, EF: EF[id] ?? 0,
      LS: LS[id] ?? 0, LF: LF[id] ?? 0,
      totalFloat: tf,
      isCritical: tf <= 0,
    };
  });
  return result;
}

// ══════════════════════════════════════════════════════════════════
//  인라인 편집 셀
// ══════════════════════════════════════════════════════════════════
function EditCell({ value, onChange, type = "text", options, min, max }) {
  if (options) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
              className={INPUT_CLS} style={{ minWidth: 80 }}>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  return (
    <input type={type} value={value}
           min={min} max={max}
           onChange={e => onChange(e.target.value)}
           className={INPUT_CLS} />
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════════════════
/**
 * props:
 *   tasks    : WbsTaskDTO[]
 *   onAdd    : (task) => Promise
 *   onUpdate : (taskId, task) => Promise
 *   onDelete : (taskId) => Promise
 *   readOnly : boolean
 */
export default function WbsTaskTable({ tasks = [], onAdd, onUpdate, onDelete, readOnly = false }) {

  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData]   = useState({});
  const [addMode, setAddMode]     = useState(false);
  const [newTask, setNewTask]     = useState({ ...EMPTY_TASK });
  const [saving, setSaving]       = useState(false);
  const [showCpm, setShowCpm]     = useState(false);

  // CPM 계산 (메모이즈)
  const cpmResult = useMemo(() => computeCPM(tasks), [tasks]);

  const criticalCount  = tasks.filter(t => cpmResult[t.taskId]?.isCritical).length;
  const projectDuration = tasks.length > 0
    ? Math.max(...tasks.map(t => cpmResult[t.taskId]?.EF ?? 0))
    : 0;

  // ── 편집 ───────────────────────────────────────────────────────
  function startEdit(task) { setEditingId(task.taskId); setEditData({ ...task }); }
  function cancelEdit()    { setEditingId(null); setEditData({}); }

  async function saveEdit() {
    if (!editData.taskName?.trim()) return;
    setSaving(true);
    try { await onUpdate(editingId, editData); setEditingId(null); }
    finally { setSaving(false); }
  }

  // ── 신규 추가 ──────────────────────────────────────────────────
  async function saveNew() {
    if (!newTask.taskName?.trim()) return;
    setSaving(true);
    try {
      await onAdd({ ...newTask, sortOrder: tasks.length });
      setNewTask({ ...EMPTY_TASK }); setAddMode(false);
    } finally { setSaving(false); }
  }

  // ── 삭제 ───────────────────────────────────────────────────────
  async function handleDelete(taskId) {
    if (!window.confirm("태스크를 삭제하시겠습니까?")) return;
    await onDelete(taskId);
  }

  function setField(setter) {
    return (field) => (val) => setter(prev => ({ ...prev, [field]: val }));
  }
  const setEdit = setField(setEditData);
  const setNew  = setField(setNewTask);

  // ── 열 정의 ────────────────────────────────────────────────────
  const COL = [
    { key: "wbsCode",        label: "WBS코드",  w: 70  },
    { key: "taskName",       label: "작업명",   w: 160 },
    { key: "startDate",      label: "시작일",   w: 96, type: "date" },
    { key: "endDate",        label: "종료일",   w: 96, type: "date" },
    { key: "duration",       label: "일수",     w: 50, type: "number" },
    { key: "progress",       label: "진행%",    w: 60, type: "number", min: 0, max: 100 },
    { key: "status",         label: "상태",     w: 90 },
    { key: "responsible",    label: "담당자",   w: 80 },
    { key: "predecessorIds", label: "선행작업", w: 90 },
    { key: "notes",          label: "비고",     w: 120 },
  ];

  const statusOptions = STATUS_OPTIONS.map(s => ({ value: s, label: STATUS_LABEL[s].ko }));

  function renderCell(task, col, data, setter) {
    if (col.key === "status") {
      return (
        <EditCell value={data[col.key] || "NOT_STARTED"}
                  onChange={setter(col.key)} options={statusOptions} />
      );
    }
    return (
      <EditCell value={data[col.key] ?? ""} onChange={setter(col.key)}
                type={col.type || "text"} min={col.min} max={col.max} />
    );
  }

  function renderReadCell(task, col) {
    if (col.key === "status") {
      const s = STATUS_LABEL[task.status] || STATUS_LABEL.NOT_STARTED;
      return (
        <span className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: s.bg, color: s.color }}>{s.ko}</span>
      );
    }
    if (col.key === "progress") {
      return (
        <div className="flex items-center gap-1">
          <div className="flex-1 h-1.5 rounded-full bg-[#1e3a5f] overflow-hidden">
            <div className="h-full rounded-full bg-blue-400"
                 style={{ width: `${task.progress || 0}%` }} />
          </div>
          <span className="text-xs text-gray-400">{task.progress ?? 0}</span>
        </div>
      );
    }
    return <span className="text-xs text-gray-300">{task[col.key] ?? ""}</span>;
  }

  return (
    <div>
      {/* ── CPM 분석 토글 버튼 ── */}
      {tasks.length > 0 && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs">
            {criticalCount > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                🔴 주공정 {criticalCount}개
              </span>
            )}
            <span style={{ color: "#94a3b8" }}>
              CPM 공기 <strong style={{ color: "#60a5fa" }}>{projectDuration}일</strong>
            </span>
          </div>
          <button
            onClick={() => setShowCpm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition"
            style={{
              backgroundColor: showCpm ? "#1e3a5f" : "#1c2a3a",
              border: `1px solid ${showCpm ? "#3b82f6" : "#253347"}`,
              color: showCpm ? "#60a5fa" : "#8896a4",
            }}
          >
            📊 {showCpm ? "CPM 숨기기" : "CPM 분석 보기"}
          </button>
        </div>
      )}

      {/* ── WBS 입력 테이블 ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr style={{ backgroundColor: "#0a1521" }}>
              {COL.map(c => (
                <th key={c.key}
                    className="px-2 py-2 text-left font-semibold text-gray-400 border-b border-[#1e3a5f] whitespace-nowrap"
                    style={{ minWidth: c.w }}>
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2 text-gray-400 border-b border-[#1e3a5f]" style={{ minWidth: 40 }}>
                소스
              </th>
              {!readOnly && (
                <th className="px-2 py-2 border-b border-[#1e3a5f]" style={{ minWidth: 80 }} />
              )}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, idx) => {
              const isEditing  = editingId === task.taskId;
              const isCritical = cpmResult[task.taskId]?.isCritical;
              const rowBg = isCritical
                ? (idx % 2 === 0 ? "#1a0a0a" : "#160808")
                : (idx % 2 === 0 ? "#0d1b2a" : "#0a1521");

              return (
                <tr key={task.taskId}
                    style={{ backgroundColor: rowBg }}
                    className="hover:bg-[#1e2d3d] transition-colors">
                  {COL.map(col => (
                    <td key={col.key}
                        className="px-2 py-1.5 border-b border-[#1a2a3a]"
                        style={{
                          minWidth: col.w,
                          borderLeft: col.key === "wbsCode" && isCritical
                            ? "2px solid #ef4444" : undefined,
                        }}>
                      {isEditing && !readOnly
                        ? renderCell(task, col, editData, setEdit)
                        : renderReadCell(task, col)
                      }
                    </td>
                  ))}
                  {/* 소스 배지 */}
                  <td className="px-2 py-1.5 border-b border-[#1a2a3a] text-center">
                    {SOURCE_BADGE[task.source] && (
                      <span title={task.source} style={{ color: SOURCE_BADGE[task.source].color }}>
                        {SOURCE_BADGE[task.source].label}
                      </span>
                    )}
                  </td>
                  {/* 액션 */}
                  {!readOnly && (
                    <td className="px-2 py-1.5 border-b border-[#1a2a3a]">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <button onClick={saveEdit} disabled={saving}
                                  className="px-2 py-0.5 rounded text-xs font-medium text-white"
                                  style={{ backgroundColor: "#1d4ed8" }}>
                            {saving ? "…" : "✓"}
                          </button>
                          <button onClick={cancelEdit}
                                  className="px-2 py-0.5 rounded text-xs text-gray-400"
                                  style={{ border: "1px solid #253347" }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={() => startEdit(task)}
                                  className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-white transition"
                                  style={{ border: "1px solid #253347" }}>
                            편집
                          </button>
                          <button onClick={() => handleDelete(task.taskId)}
                                  className="px-2 py-0.5 rounded text-xs text-red-400 hover:text-red-300 transition"
                                  style={{ border: "1px solid #450a0a" }}>
                            🗑
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}

            {/* 신규 행 입력 */}
            {!readOnly && addMode && (
              <tr style={{ backgroundColor: "#1e3a5f30" }}>
                {COL.map(col => (
                  <td key={col.key} className="px-2 py-1.5 border-b border-[#1e3a5f]">
                    {renderCell(null, col, newTask, setNew)}
                  </td>
                ))}
                <td className="px-2 py-1.5 border-b border-[#1e3a5f] text-xs text-gray-500">✏️</td>
                <td className="px-2 py-1.5 border-b border-[#1e3a5f]">
                  <div className="flex gap-1">
                    <button onClick={saveNew}
                            disabled={saving || !newTask.taskName?.trim()}
                            className="px-2 py-0.5 rounded text-xs font-medium text-white"
                            style={{ backgroundColor: "#1d4ed8" }}>
                      {saving ? "…" : "+ 추가"}
                    </button>
                    <button onClick={() => { setAddMode(false); setNewTask({ ...EMPTY_TASK }); }}
                            className="px-2 py-0.5 rounded text-xs text-gray-400"
                            style={{ border: "1px solid #253347" }}>
                      취소
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
        <button
          onClick={() => setAddMode(true)}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-400 hover:text-white transition"
          style={{ border: "1px dashed #1d4ed8" }}>
          + 태스크 추가
        </button>
      )}

      {tasks.length === 0 && !addMode && (
        <div className="py-12 text-center text-gray-500 text-sm">
          <div className="text-3xl mb-2">📋</div>
          <p>등록된 WBS 태스크가 없습니다.</p>
          {!readOnly && (
            <p className="text-xs mt-1 text-gray-600">위 "+ 태스크 추가" 버튼으로 작업을 추가하세요.</p>
          )}
        </div>
      )}

      {/* ══ CPM 분석 패널 ══════════════════════════════════════════ */}
      {showCpm && tasks.length > 0 && (
        <div className="mt-4 rounded-xl overflow-hidden"
             style={{ border: "1px solid #1e3a5f", backgroundColor: "#0a1521" }}>

          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-2.5"
               style={{ backgroundColor: "#0d1b2a", borderBottom: "1px solid #1e3a5f" }}>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-sm text-blue-400">📊 CPM 네트워크 분석</span>
              <span className="text-xs" style={{ color: "#94a3b8" }}>
                총 공기 <strong style={{ color: "#60a5fa" }}>{projectDuration}일</strong>
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                🔴 주공정 {criticalCount}개
              </span>
            </div>
            <p className="text-xs" style={{ color: "#475569" }}>
              ES=최조착수 · EF=최조완료 · LS=최지착수 · LF=최지완료 · TF=여유공기
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ backgroundColor: "#0d1b2a" }}>
                  {[
                    { label: "WBS코드", w: 70 },
                    { label: "작업명",  w: 160 },
                    { label: "기간(일)", w: 60 },
                    { label: "ES",      w: 50 },
                    { label: "EF",      w: 50 },
                    { label: "LS",      w: 50 },
                    { label: "LF",      w: 50 },
                    { label: "여유공기(TF)", w: 80 },
                    { label: "구분",    w: 80 },
                  ].map(c => (
                    <th key={c.label}
                        className="px-3 py-2 text-left font-semibold border-b border-[#1e3a5f] whitespace-nowrap"
                        style={{ minWidth: c.w, color: "#8896a4" }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, idx) => {
                  const cpm = cpmResult[task.taskId];
                  if (!cpm) return null;
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

                  return (
                    <tr key={task.taskId}
                        style={{ backgroundColor: rowBg }}
                        className="hover:bg-[#1e2d3d] transition-colors">
                      <td className="px-3 py-2 border-b border-[#1a2a3a]"
                          style={{
                            color: "#64748b",
                            borderLeft: cpm.isCritical ? "2px solid #ef4444" : undefined,
                          }}>
                        {task.wbsCode || "-"}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] font-medium"
                          style={{ color: cpm.isCritical ? "#fca5a5" : "#e2e8f0" }}>
                        {task.taskName}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center"
                          style={{ color: "#94a3b8" }}>
                        {dur}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-blue-300">
                        {cpm.ES}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-blue-300">
                        {cpm.EF}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-purple-300">
                        {cpm.LS}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center text-purple-300">
                        {cpm.LF}
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a] text-center">
                        <span className={`font-bold ${cpm.isCritical ? "text-red-400" : "text-green-400"}`}>
                          {cpm.totalFloat}일
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-[#1a2a3a]">
                        {cpm.isCritical ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                                style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                            🔴 주공정
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs"
                                style={{ backgroundColor: "#14532d", color: "#4ade80", border: "1px solid #166534" }}>
                            여유 {cpm.totalFloat}일
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 범례 */}
          <div className="px-4 py-2.5 flex items-center gap-4 text-xs flex-wrap"
               style={{ borderTop: "1px solid #1e3a5f", color: "#475569" }}>
            <span>💡 선행작업(predecessorIds) 칼럼에 쉼표로 구분된 taskId를 입력하면 CPM이 자동 계산됩니다.</span>
            <span style={{ color: "#60a5fa" }}>ES/EF = 순방향 패스</span>
            <span style={{ color: "#a78bfa" }}>LS/LF = 역방향 패스</span>
            <span style={{ color: "#ef4444" }}>TF=0 → 주공정(지연 불가)</span>
          </div>
        </div>
      )}
    </div>
  );
}
