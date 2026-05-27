import React, { useState, useCallback, useEffect } from "react";
import AxiosCustom from "../../axios/AxiosCustom";
import GanttChart from "./component/GanttChart";
import WbsTaskTable from "./component/WbsTaskTable";
import ProjectLinkPanel from "./component/ProjectLinkPanel";
import { useT } from "../../i18n/LanguageContext";

// ══════════════════════════════════════════════════════════════════
//  디자인 토큰
// ══════════════════════════════════════════════════════════════════
const TB = {
  card:    "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  text1:   "#e2e8f0",
  text2:   "#8896a4",
  accent:  "#60a5fa",
  warning: "#f59e0b",
  danger:  "#f87171",
  success: "#4ade80",
};

const STATUS_META = {
  PLANNED:     { ko: "계획",   color: "#94a3b8", bg: "#1e293b", icon: "📋" },
  IN_PROGRESS: { ko: "진행중", color: "#60a5fa", bg: "#1e3a5f", icon: "🔨" },
  COMPLETED:   { ko: "완료",   color: "#4ade80", bg: "#14532d", icon: "✅" },
  ON_HOLD:     { ko: "보류",   color: "#f59e0b", bg: "#451a03", icon: "⏸" },
};

// ══════════════════════════════════════════════════════════════════
//  프로젝트 생성/편집 모달
// ══════════════════════════════════════════════════════════════════
function ProjectModal({ initial = null, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(
    initial ?? {
      projectName: "", location: "", contractAmount: "",
      status: "PLANNED", description: "",
      startDate: "", endDate: "",
      clientName: "", managerName: "",
    }
  );
  const [saving, setSaving] = useState(false);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  async function handleSave() {
    if (!form.projectName?.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = `
    w-full bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-2
    text-sm text-gray-200 outline-none focus:border-blue-500
  `.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
           style={{ backgroundColor: "#0f1e2d", border: "1px solid #253347" }}>

        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-white">
            {isEdit ? "🏗 프로젝트 수정" : "🏗 새 현장 프로젝트"}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>프로젝트명 *</label>
            <input value={form.projectName} onChange={set("projectName")}
                   placeholder="예: 한강대교 교량 보수공사"
                   autoFocus className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>장소/현장주소</label>
            <input value={form.location} onChange={set("location")}
                   placeholder="서울 마포구 한강로…" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>계약금액 (원)</label>
            <input value={form.contractAmount} onChange={set("contractAmount")}
                   type="number" placeholder="1000000000" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>발주처</label>
            <input value={form.clientName} onChange={set("clientName")}
                   placeholder="국토교통부" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>현장소장</label>
            <input value={form.managerName} onChange={set("managerName")}
                   placeholder="홍길동" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>공사 시작일</label>
            <input value={form.startDate} onChange={set("startDate")}
                   type="date" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>공사 종료일</label>
            <input value={form.endDate} onChange={set("endDate")}
                   type="date" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>진행상태</label>
            <select value={form.status} onChange={set("status")} className={inputCls}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.ko}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>설명</label>
            <textarea value={form.description} onChange={set("description")}
                      rows={2} placeholder="공사 개요 및 특이사항"
                      className={`${inputCls} resize-none`} />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm transition"
                  style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
            취소
          </button>
          <button onClick={handleSave} disabled={!form.projectName?.trim() || saving}
                  className="flex-[2] py-2.5 rounded-lg text-sm font-semibold text-white transition"
                  style={{
                    background: form.projectName?.trim() ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : "#1c2a3a",
                    border: `1px solid ${form.projectName?.trim() ? "#3b82f6" : "#253347"}`,
                  }}>
            {saving ? "저장 중…" : (isEdit ? "💾 수정 저장" : "🏗 프로젝트 생성")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  프로젝트 카드
// ══════════════════════════════════════════════════════════════════
function ProjectCard({ project, selected, onSelect, onEdit, onDelete }) {
  const meta = STATUS_META[project.status] || STATUS_META.PLANNED;
  const amt  = project.contractAmount
    ? `₩ ${Number(project.contractAmount).toLocaleString()}`
    : "-";

  return (
    <div
      className="rounded-xl p-4 cursor-pointer transition-all duration-200"
      style={{
        backgroundColor: "#1c2a3a",
        border: `1px solid ${selected ? "#3b82f6" : "#253347"}`,
        borderTop: `3px solid ${meta.color}`,
        boxShadow: selected ? "0 0 0 2px #3b82f640, 0 4px 20px rgba(59,130,246,0.15)" : undefined,
      }}
      onClick={() => onSelect(project)}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xl">{meta.icon}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: meta.bg, color: meta.color }}>
          {meta.ko}
        </span>
      </div>

      <h3 className="font-bold text-white text-sm leading-tight mb-1 line-clamp-2">
        {project.projectName}
      </h3>
      <p className="text-xs truncate" style={{ color: TB.text2 }}>
        📍 {project.location || "위치 미지정"}
      </p>
      <p className="text-xs mt-0.5" style={{ color: TB.text2 }}>
        💰 {amt}
      </p>

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs" style={{ color: TB.text2 }}>
          <span>📋 {project.taskCount ?? 0}개 작업</span>
        </div>
        <div className="text-xs" style={{ color: TB.text2 }}>
          {project.startDate?.slice(0, 7)} ~
        </div>
      </div>

      <div className="flex gap-1 mt-3" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => onSelect(project)}
          className="flex-1 py-1 rounded text-xs font-semibold text-white transition"
          style={{ backgroundColor: "#1d4ed8" }}>
          WBS 보기
        </button>
        <button
          onClick={() => onEdit(project)}
          className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white transition"
          style={{ border: "1px solid #253347" }}>
          편집
        </button>
        <button
          onClick={() => onDelete(project.projectId)}
          className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 transition"
          style={{ border: "1px solid #450a0a" }}>
          🗑
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 대시보드
// ══════════════════════════════════════════════════════════════════
export default function WbsDashboard({ onNavigateToTab }) {
  const [projects, setProjects]       = useState([]);
  const [selectedProject, setSelected] = useState(null);
  const [tasks, setTasks]             = useState([]);
  const [allTasks, setAllTasks]       = useState([]);
  const [ganttMode, setGanttMode]     = useState("project"); // "project" | "gantt" | "link"
  const [view, setView]               = useState("list");    // "list" | "wbs" | "gantt-all"
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [search, setSearch]           = useState("");

  // ── 연결 프로젝트 이동 핸들러 ────────────────────────────────
  const handleNavigateToLink = useCallback((link) => {
    if (onNavigateToTab) onNavigateToTab(link);
  }, [onNavigateToTab]);

  // ── 프로젝트 목록 로드 ───────────────────────────────────────
  const loadProjects = useCallback(() => {
    return AxiosCustom.get("/api/wbs/projects")
      .then(r => setProjects(r.data))
      .catch(() => {});
  }, []);

  // ── 전체 태스크 로드 (통합 간트) ────────────────────────────
  const loadAllTasks = useCallback(() => {
    return AxiosCustom.get("/api/wbs/tasks")
      .then(r => setAllTasks(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([loadProjects(), loadAllTasks()])
      .finally(() => setLoading(false));
  }, [loadProjects, loadAllTasks]);

  // ── 프로젝트 선택 → 태스크 로드 ─────────────────────────────
  const selectProject = useCallback(async (project) => {
    setSelected(project);
    setView("wbs");
    setTaskLoading(true);
    try {
      const r = await AxiosCustom.get(`/api/wbs/project/${project.projectId}/tasks`);
      setTasks(r.data);
    } finally {
      setTaskLoading(false);
    }
  }, []);

  // ── CRUD 핸들러 ──────────────────────────────────────────────
  const handleCreateProject = useCallback(async (formData) => {
    await AxiosCustom.post("/api/wbs/project", formData);
    await loadProjects();
    await loadAllTasks();
  }, [loadProjects, loadAllTasks]);

  const handleUpdateProject = useCallback(async (formData) => {
    await AxiosCustom.put(`/api/wbs/project/${editingProject.projectId}`, formData);
    await loadProjects();
    setEditingProject(null);
    if (selectedProject?.projectId === editingProject.projectId) {
      setSelected(prev => ({ ...prev, ...formData }));
    }
  }, [editingProject, loadProjects, selectedProject]);

  const handleDeleteProject = useCallback(async (projectId) => {
    if (!window.confirm("프로젝트를 삭제하시겠습니까? (WBS 태스크도 모두 삭제됩니다)")) return;
    await AxiosCustom.delete(`/api/wbs/project/${projectId}`);
    setProjects(prev => prev.filter(p => p.projectId !== projectId));
    if (selectedProject?.projectId === projectId) {
      setSelected(null);
      setView("list");
    }
    await loadAllTasks();
  }, [selectedProject, loadAllTasks]);

  const handleAddTask = useCallback(async (taskData) => {
    const r = await AxiosCustom.post(`/api/wbs/project/${selectedProject.projectId}/task`, taskData);
    setTasks(prev => [...prev, r.data]);
    setProjects(prev => prev.map(p =>
      p.projectId === selectedProject.projectId
        ? { ...p, taskCount: (p.taskCount || 0) + 1 }
        : p
    ));
    await loadAllTasks();
  }, [selectedProject, loadAllTasks]);

  const handleUpdateTask = useCallback(async (taskId, taskData) => {
    await AxiosCustom.put(`/api/wbs/task/${taskId}`, taskData);
    setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, ...taskData } : t));
    await loadAllTasks();
  }, [loadAllTasks]);

  const handleDeleteTask = useCallback(async (taskId) => {
    await AxiosCustom.delete(`/api/wbs/task/${taskId}`);
    setTasks(prev => prev.filter(t => t.taskId !== taskId));
    setProjects(prev => prev.map(p =>
      p.projectId === selectedProject?.projectId
        ? { ...p, taskCount: Math.max(0, (p.taskCount || 0) - 1) }
        : p
    ));
    await loadAllTasks();
  }, [selectedProject, loadAllTasks]);

  // ── 필터 ────────────────────────────────────────────────────
  const filtered = projects.filter(p =>
    p.projectName?.toLowerCase().includes(search.toLowerCase()) ||
    p.location?.toLowerCase().includes(search.toLowerCase())
  );

  // ── 요약 통계 ────────────────────────────────────────────────
  const stats = {
    total:      projects.length,
    inProgress: projects.filter(p => p.status === "IN_PROGRESS").length,
    completed:  projects.filter(p => p.status === "COMPLETED").length,
    onHold:     projects.filter(p => p.status === "ON_HOLD").length,
    taskCount:  projects.reduce((s, p) => s + (p.taskCount || 0), 0),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-3">🏗</div>
          <div className="text-sm">WBS 로드 중…</div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  통합 간트 뷰
  // ══════════════════════════════════════════════════════════════
  if (view === "gantt-all") {
    return (
      <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-4">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setView("list")}
            className="px-3 py-1.5 rounded-lg text-sm transition"
            style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
            ← 목록
          </button>
          <h2 className="text-xl font-bold text-white">📊 전체 현장 통합 간트 차트</h2>
          <span className="text-sm text-gray-400">({allTasks.length}개 작업)</span>
        </div>
        {allTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-500">
            <div className="text-5xl mb-4">📊</div>
            <p>등록된 WBS 태스크가 없습니다.</p>
          </div>
        ) : (
          <div className={TB.card + " p-4"}>
            <GanttChart
              tasks={allTasks}
              groupByProject
              onTaskClick={(t) => {
                const proj = projects.find(p => p.projectId === t.wbsProjectId);
                if (proj) selectProject(proj);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  프로젝트별 WBS + 간트 뷰
  // ══════════════════════════════════════════════════════════════
  if (view === "wbs" && selectedProject) {
    return (
      <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-4">
        {/* 상단 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setView("list"); setSelected(null); }}
              className="px-3 py-1.5 rounded-lg text-sm transition"
              style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
              ← 목록
            </button>
            <div>
              <h2 className="text-xl font-bold text-white">{selectedProject.projectName}</h2>
              <p className="text-xs mt-0.5" style={{ color: TB.text2 }}>
                📍 {selectedProject.location || "위치 미지정"} &nbsp;|&nbsp;
                {selectedProject.startDate} ~ {selectedProject.endDate}
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: STATUS_META[selectedProject.status]?.bg,
                    color: STATUS_META[selectedProject.status]?.color,
                  }}>
              {STATUS_META[selectedProject.status]?.icon} {STATUS_META[selectedProject.status]?.ko}
            </span>
          </div>

          {/* 서브탭: WBS 테이블 / 간트 / 연결 */}
          <div className="flex gap-2">
            {[
              { key: "project", label: "📋 WBS 목록" },
              { key: "gantt",   label: "📊 간트 차트" },
              { key: "link",    label: "🔗 연결 프로젝트" },
            ].map(tab => (
              <button key={tab.key}
                onClick={() => setGanttMode(tab.key)}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold transition"
                style={{
                  backgroundColor: ganttMode === tab.key ? "#1e3a5f" : "#1c2a3a",
                  border: `1px solid ${ganttMode === tab.key ? "#3b82f6" : "#253347"}`,
                  color: ganttMode === tab.key ? "#60a5fa" : TB.text2,
                }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 프로젝트 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "계약금액", value: selectedProject.contractAmount
                ? `₩ ${Number(selectedProject.contractAmount).toLocaleString()}`
                : "-", icon: "💰" },
            { label: "발주처",  value: selectedProject.clientName  || "-", icon: "🏢" },
            { label: "현장소장", value: selectedProject.managerName || "-", icon: "👷" },
            { label: "WBS 작업", value: `${tasks.length}개`,              icon: "📋" },
          ].map(s => (
            <div key={s.label} className={TB.card + " p-3"}>
              <p className="text-xs mb-1" style={{ color: TB.text2 }}>{s.icon} {s.label}</p>
              <p className="text-sm font-bold text-white truncate">{s.value}</p>
            </div>
          ))}
        </div>

        {/* 설명 */}
        {selectedProject.description && (
          <div className={TB.card + " p-3 mb-4 text-sm"} style={{ color: TB.text2 }}>
            {selectedProject.description}
          </div>
        )}

        {/* WBS 목록 / 간트 */}
        <div className={TB.card + " p-4"}>
          {taskLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <div className="text-sm">WBS 로드 중…</div>
            </div>
          ) : ganttMode === "gantt" ? (
            <>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                📊 간트 차트 — {selectedProject.projectName}
              </h3>
              <GanttChart
                tasks={tasks}
                groupByProject={false}
                onTaskClick={() => setGanttMode("project")}
              />
            </>
          ) : ganttMode === "link" ? (
            <ProjectLinkPanel
              wbsProjectId={selectedProject.projectId}
              onNavigate={handleNavigateToLink}
            />
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">
                  📋 WBS 목록 ({tasks.length}개 작업)
                </h3>
                {tasks.some(t => t.source && t.source !== "MANUAL") && (
                  <div className="flex gap-2 text-xs text-gray-400">
                    <span>🔗 CPM Agent</span>
                    <span>🔍 균열감지</span>
                    <span>🤖 자동추가</span>
                  </div>
                )}
              </div>
              <WbsTaskTable
                tasks={tasks}
                onAdd={handleAddTask}
                onUpdate={handleUpdateTask}
                onDelete={handleDeleteTask}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  프로젝트 목록 뷰 (기본)
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

      {/* ── 페이지 헤더 ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            🏗 WBS <span className="text-blue-400">현장 프로젝트</span>
          </h2>
          <p className="text-sm mt-0.5" style={{ color: TB.text2 }}>
            건설현장 WBS 입력 · 간트 차트 · Agent 연동
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 검색 */}
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm" style={{ color: TB.text2 }}>🔍</span>
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="현장명, 장소 검색"
              className="pl-8 pr-3 py-2 rounded-lg text-sm outline-none w-44"
              style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text1 }}
            />
          </div>

          {/* 전체 간트 */}
          <button
            onClick={() => setView("gantt-all")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition"
            style={{ backgroundColor: "#1c2a3a", border: "1px solid #1d4ed8" }}>
            📊 전체 간트
          </button>

          {/* 새 프로젝트 */}
          <button
            onClick={() => setShowProjectModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition"
            style={{ backgroundColor: "#1e1040", border: "1px solid #8b5cf6" }}>
            + 새 현장
          </button>
        </div>
      </div>

      {/* ── 요약 통계 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: "전체 현장",  value: stats.total,      color: "#60a5fa", icon: "🏗" },
          { label: "진행중",     value: stats.inProgress, color: "#60a5fa", icon: "🔨" },
          { label: "완료",       value: stats.completed,  color: "#4ade80", icon: "✅" },
          { label: "보류",       value: stats.onHold,     color: "#f59e0b", icon: "⏸" },
          { label: "전체 작업",  value: stats.taskCount,  color: "#a78bfa", icon: "📋" },
        ].map(s => (
          <div key={s.label}
               className="rounded-xl p-3 text-center"
               style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-0.5" style={{ color: TB.text2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── 상태 필터 칩 ── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs" style={{ color: TB.text2 }}>필터:</span>
        {Object.entries(STATUS_META).map(([k, v]) => {
          const cnt = projects.filter(p => p.status === k).length;
          return (
            <button
              key={k}
              onClick={() => setSearch(prev => prev === k ? "" : k)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition"
              style={{
                backgroundColor: search === k ? `${v.color}20` : "#1c2a3a",
                border: `1px solid ${search === k ? v.color : "#253347"}`,
                color: search === k ? v.color : TB.text2,
              }}>
              {v.icon} {v.ko} ({cnt})
            </button>
          );
        })}
        {search && !Object.keys(STATUS_META).includes(search) && (
          <button onClick={() => setSearch("")}
                  className="px-2 py-1 rounded-full text-xs transition"
                  style={{ border: "1px solid #253347", color: TB.text2 }}>
            ✕ 초기화
          </button>
        )}
      </div>

      {/* ── 프로젝트 카드 그리드 ── */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(project => (
            <ProjectCard
              key={project.projectId}
              project={project}
              selected={selectedProject?.projectId === project.projectId}
              onSelect={selectProject}
              onEdit={p => { setEditingProject(p); setShowProjectModal(true); }}
              onDelete={handleDeleteProject}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="text-7xl mb-5">{search ? "🔍" : "🏗"}</div>
          <div className="text-lg font-semibold text-gray-400 mb-2">
            {search ? `"${search}" 검색 결과 없음` : "등록된 현장이 없습니다"}
          </div>
          <div className="text-sm" style={{ color: TB.text2 }}>
            {search
              ? "다른 검색어를 입력하거나 필터를 초기화하세요"
              : '"+ 새 현장" 버튼으로 건설현장 WBS 프로젝트를 등록하세요'}
          </div>
        </div>
      )}

      {/* ── 프로젝트 생성/편집 모달 ── */}
      {showProjectModal && (
        <ProjectModal
          initial={editingProject}
          onClose={() => { setShowProjectModal(false); setEditingProject(null); }}
          onSave={editingProject ? handleUpdateProject : handleCreateProject}
        />
      )}
    </div>
  );
}
