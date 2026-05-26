import React, { useState, useCallback, useEffect, useRef } from "react";
import AxiosCustom from "../../axios/AxiosCustom";
import GanttChart from "./component/GanttChart";
import WbsTaskTable from "./component/WbsTaskTable";
import ProjectLinkPanel from "./component/ProjectLinkPanel";
import { useT } from "../../i18n/LanguageContext";

// ── 디자인 토큰 ─────────────────────────────────────────────────
const TB = {
  text2: "#8896a4",
  sidebar: "#0a1521",
  card:    "#1c2a3a",
  border:  "#253347",
};

const STATUS_META = {
  PLANNED:     { tKey: "statusPlanned",    color: "#94a3b8", bg: "#1e293b", icon: "📋" },
  IN_PROGRESS: { tKey: "statusInProgress", color: "#60a5fa", bg: "#1e3a5f", icon: "🔨" },
  COMPLETED:   { tKey: "statusCompleted",  color: "#4ade80", bg: "#14532d", icon: "✅" },
  ON_HOLD:     { tKey: "statusOnHold",     color: "#f59e0b", bg: "#451a03", icon: "⏸"  },
};

// ══════════════════════════════════════════════════════════════════
//  프로젝트 생성/편집 모달
// ══════════════════════════════════════════════════════════════════
function ProjectModal({ initial = null, onClose, onSave }) {
  const t = useT('wbs');
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
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }));

  async function handleSave() {
    if (!form.projectName?.trim()) return;
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  }

  const I = "w-full bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
           style={{ backgroundColor: "#0f1e2d", border: "1px solid #253347" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-white">
            {isEdit ? t('modalEdit') : t('modalCreate')}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldProjectName')}</label>
            <input value={form.projectName} onChange={set("projectName")}
                   placeholder={t('fieldProjectNamePh')} autoFocus className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldLocation')}</label>
            <input value={form.location} onChange={set("location")} placeholder={t('fieldLocationPh')} className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldContract')}</label>
            <input value={form.contractAmount} onChange={set("contractAmount")} type="number" placeholder="1000000000" className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldClient')}</label>
            <input value={form.clientName} onChange={set("clientName")} placeholder={t('client')} className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldManager')}</label>
            <input value={form.managerName} onChange={set("managerName")} placeholder={t('siteManager')} className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldStartDate')}</label>
            <input value={form.startDate} onChange={set("startDate")} type="date" className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldEndDate')}</label>
            <input value={form.endDate} onChange={set("endDate")} type="date" className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldStatus')}</label>
            <select value={form.status} onChange={set("status")} className={I}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {t(v.tKey)}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldDescription')}</label>
            <textarea value={form.description} onChange={set("description")}
                      rows={2} placeholder={t('fieldDescriptionPh')}
                      className={`${I} resize-none`} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm"
                  style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}`, color: TB.text2 }}>
            {t('cancel')}
          </button>
          <button onClick={handleSave} disabled={!form.projectName?.trim() || saving}
                  className="flex-[2] py-2.5 rounded-lg text-sm font-semibold text-white"
                  style={{
                    background: form.projectName?.trim() ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : TB.card,
                    border: `1px solid ${form.projectName?.trim() ? "#3b82f6" : TB.border}`,
                  }}>
            {saving ? t('saving') : (isEdit ? t('saveEdit') : t('createSite'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  사이드바 프로젝트 아이템
// ══════════════════════════════════════════════════════════════════
function SidebarItem({ project, selected, onSelect, onEdit, onDelete }) {
  const t = useT('wbs');
  const meta = STATUS_META[project.status] || STATUS_META.PLANNED;
  return (
    <div
      className="group flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all"
      style={{
        backgroundColor: selected ? "#1e3a5f" : "transparent",
        border: `1px solid ${selected ? "#3b82f6" : "transparent"}`,
      }}
      onClick={() => onSelect(project)}
    >
      <span className="text-sm shrink-0 mt-0.5">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-snug truncate"
           style={{ color: selected ? "#60a5fa" : "#e2e8f0" }}>
          {project.projectName}
        </p>
        {project.location && (
          <p className="text-xs truncate mt-0.5" style={{ color: "#475569" }}>
            📍 {project.location}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-xs px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: meta.bg, color: meta.color }}>
            {t(meta.tKey)}
          </span>
          <span className="text-xs" style={{ color: "#475569" }}>
            {t('taskCount', { n: project.taskCount ?? 0 })}
          </span>
        </div>
      </div>
      {/* 호버 액션 */}
      <div className="shrink-0 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
           onClick={e => e.stopPropagation()}>
        <button onClick={() => onEdit(project)}
                className="p-0.5 rounded text-xs hover:text-blue-400 transition"
                style={{ color: "#475569" }}>✏️</button>
        <button onClick={() => onDelete(project.projectId)}
                className="p-0.5 rounded text-xs hover:text-red-400 transition"
                style={{ color: "#475569" }}>🗑</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 대시보드
// ══════════════════════════════════════════════════════════════════
export default function WbsDashboard({ onNavigateToTab }) {
  const t = useT('wbs');

  // ── 데이터 상태 ──────────────────────────────────────────────
  const [projects,   setProjects]   = useState([]);
  const [allTasks,   setAllTasks]   = useState([]);
  const [tasks,      setTasks]      = useState([]);   // 선택 프로젝트 태스크
  const [loading,    setLoading]    = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);

  // ── UI 상태 ──────────────────────────────────────────────────
  const [sidebarOpen,     setSidebarOpen]     = useState(true);
  const [selectedProject, setSelected]        = useState(null);
  const [detailTab,       setDetailTab]       = useState("gantt"); // gantt|table|link
  const [showModal,       setShowModal]       = useState(false);
  const [editingProject,  setEditingProject]  = useState(null);
  const [search,          setSearch]          = useState("");
  const [statusFilter,    setStatusFilter]    = useState(""); // "" | "IN_PROGRESS" | ...

  const sidebarRef = useRef(null);

  const handleNavigate = useCallback((link) => {
    if (onNavigateToTab) onNavigateToTab(link);
  }, [onNavigateToTab]);

  // ── 로드 ─────────────────────────────────────────────────────
  const loadProjects = useCallback(() =>
    AxiosCustom.get("/api/wbs/projects").then(r => setProjects(r.data)).catch(() => {}),
  []);

  const loadAllTasks = useCallback(() =>
    AxiosCustom.get("/api/wbs/tasks").then(r => setAllTasks(r.data)).catch(() => {}),
  []);

  useEffect(() => {
    Promise.all([loadProjects(), loadAllTasks()]).finally(() => setLoading(false));
  }, [loadProjects, loadAllTasks]);

  // ── 프로젝트 선택 (토글) ─────────────────────────────────────
  const selectProject = useCallback(async (project) => {
    if (selectedProject?.projectId === project.projectId) {
      setSelected(null); setTasks([]); return;
    }
    setSelected(project);
    setDetailTab("gantt");
    setTaskLoading(true);
    try {
      const r = await AxiosCustom.get(`/api/wbs/project/${project.projectId}/tasks`);
      setTasks(r.data);
    } finally {
      setTaskLoading(false);
    }
  }, [selectedProject]);

  // ── CRUD ─────────────────────────────────────────────────────
  const handleCreate = useCallback(async (formData) => {
    await AxiosCustom.post("/api/wbs/project", formData);
    await loadProjects(); await loadAllTasks();
  }, [loadProjects, loadAllTasks]);

  const handleUpdate = useCallback(async (formData) => {
    await AxiosCustom.put(`/api/wbs/project/${editingProject.projectId}`, formData);
    await loadProjects(); setEditingProject(null);
    if (selectedProject?.projectId === editingProject.projectId)
      setSelected(prev => ({ ...prev, ...formData }));
  }, [editingProject, loadProjects, selectedProject]);

  const handleDelete = useCallback(async (projectId) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    await AxiosCustom.delete(`/api/wbs/project/${projectId}`);
    setProjects(prev => prev.filter(p => p.projectId !== projectId));
    if (selectedProject?.projectId === projectId) { setSelected(null); setTasks([]); }
    await loadAllTasks();
  }, [selectedProject, loadAllTasks]);

  const handleAddTask = useCallback(async (taskData) => {
    const r = await AxiosCustom.post(`/api/wbs/project/${selectedProject.projectId}/task`, taskData);
    setTasks(prev => [...prev, r.data]);
    setProjects(prev => prev.map(p =>
      p.projectId === selectedProject.projectId
        ? { ...p, taskCount: (p.taskCount || 0) + 1 } : p
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
        ? { ...p, taskCount: Math.max(0, (p.taskCount || 0) - 1) } : p
    ));
    await loadAllTasks();
  }, [selectedProject, loadAllTasks]);

  // ── 필터 ──────────────────────────────────────────────────────
  const filteredProjects = projects.filter(p => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.projectName?.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q);
    }
    return true;
  });

  // 간트에 표시할 작업: 프로젝트 선택 → 해당 작업, 없으면 전체(필터 반영)
  const ganttTasks = selectedProject
    ? tasks
    : (statusFilter
        ? allTasks.filter(t =>
            projects.find(p => p.projectId === t.wbsProjectId)?.status === statusFilter
          )
        : allTasks);

  // 통계
  const stats = {
    total:      projects.length,
    inProgress: projects.filter(p => p.status === "IN_PROGRESS").length,
    completed:  projects.filter(p => p.status === "COMPLETED").length,
    planned:    projects.filter(p => p.status === "PLANNED").length,
    onHold:     projects.filter(p => p.status === "ON_HOLD").length,
  };

  // 선택 프로젝트 meta
  const selMeta = selectedProject
    ? STATUS_META[selectedProject.status] || STATUS_META.PLANNED
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-3">🏗</div>
          <div className="text-sm">{t('loadingWbs')}</div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  렌더
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col gap-0 -mx-2 sm:-mx-4 -mt-4 sm:-mt-6"
         style={{ minHeight: "calc(100vh - 60px)" }}>

      {/* ── 상단 컨트롤 바 ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap"
           style={{
             backgroundColor: "#06111c",
             borderBottom: "1px solid #1a2a3a",
           }}>

        {/* 햄버거 */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? t('sidebarTitle') : t('addSiteBtn')}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition shrink-0"
          style={{
            backgroundColor: sidebarOpen ? "#1e3a5f" : "#1c2a3a",
            border: `1px solid ${sidebarOpen ? "#3b82f6" : "#253347"}`,
          }}>
          <span className="text-base leading-none select-none"
                style={{ color: sidebarOpen ? "#60a5fa" : "#8896a4" }}>
            {sidebarOpen ? "✕" : "☰"}
          </span>
        </button>

        {/* 타이틀 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-base font-bold text-white">🏗 {t('title')}</span>
          <span className="text-sm font-semibold" style={{ color: "#60a5fa" }}>
            {t('ganttPageTitle')}
          </span>
        </div>

        {/* 구분선 */}
        <div className="h-5 w-px shrink-0" style={{ backgroundColor: "#253347" }} />

        {/* 통계 칩 (클릭 → 필터) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { key: "",            label: t('allSites',      { n: stats.total }),      color: "#94a3b8", bg: "#1e293b"  },
            { key: "IN_PROGRESS", label: t('activeCount',   { n: stats.inProgress }), color: "#60a5fa", bg: "#1e3a5f"  },
            { key: "COMPLETED",   label: t('completedCount',{ n: stats.completed }),   color: "#4ade80", bg: "#14532d"  },
            { key: "PLANNED",     label: t('plannedCount',  { n: stats.planned }),     color: "#94a3b8", bg: "#1e293b"  },
            { key: "ON_HOLD",     label: t('onHoldCount',   { n: stats.onHold }),      color: "#f59e0b", bg: "#451a03"  },
          ].map(chip => (
            <button
              key={chip.key}
              onClick={() => setStatusFilter(p => p === chip.key ? "" : chip.key)}
              className="px-2 py-0.5 rounded-full text-xs font-medium transition"
              style={{
                backgroundColor: statusFilter === chip.key ? chip.bg : "transparent",
                color: statusFilter === chip.key ? chip.color : "#64748b",
                border: `1px solid ${statusFilter === chip.key ? chip.color + "80" : "#253347"}`,
              }}>
              {chip.label}
            </button>
          ))}
          <span className="text-xs" style={{ color: "#475569" }}>
            │ {t('taskCount', { n: allTasks.length })}
          </span>
        </div>

        <div className="flex-1" />

        {/* 새 현장 */}
        <button
          onClick={() => { setEditingProject(null); setShowModal(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition shrink-0"
          style={{ backgroundColor: "#1e1040", border: "1px solid #8b5cf6" }}>
          {t('addSite')}
        </button>
      </div>

      {/* ── 본문 레이아웃: 사이드바 + 메인 ── */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* ── 사이드바 ── */}
        {sidebarOpen && (
          <div
            ref={sidebarRef}
            className="shrink-0 flex flex-col overflow-y-auto"
            style={{
              width: 224,
              backgroundColor: TB.sidebar,
              borderRight: `1px solid #1a2a3a`,
            }}>

            {/* 검색 */}
            <div className="px-2 pt-3 pb-2">
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs"
                      style={{ color: "#475569" }}>🔍</span>
                <input
                  type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full pl-6 pr-2 py-1.5 rounded-lg text-xs outline-none"
                  style={{
                    backgroundColor: "#0d1b2a",
                    border: "1px solid #253347",
                    color: "#e2e8f0",
                  }}
                />
              </div>
            </div>

            {/* 프로젝트 목록 헤더 */}
            <div className="flex items-center justify-between px-3 pb-1">
              <span className="text-xs font-semibold" style={{ color: "#475569" }}>
                {t('sidebarTitle')}
              </span>
              <span className="text-xs" style={{ color: "#334155" }}>
                {filteredProjects.length}/{projects.length}
              </span>
            </div>

            {/* 프로젝트 리스트 */}
            <div className="flex-1 px-2 pb-2 flex flex-col gap-0.5 overflow-y-auto">
              {filteredProjects.length > 0 ? (
                filteredProjects.map(p => (
                  <SidebarItem
                    key={p.projectId}
                    project={p}
                    selected={selectedProject?.projectId === p.projectId}
                    onSelect={selectProject}
                    onEdit={proj => { setEditingProject(proj); setShowModal(true); }}
                    onDelete={handleDelete}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-xs" style={{ color: "#334155" }}>
                  {search || statusFilter ? t('noResults') : t('noSites')}
                </div>
              )}
            </div>

            {/* 새 현장 버튼 */}
            <div className="px-2 py-2" style={{ borderTop: "1px solid #1a2a3a" }}>
              <button
                onClick={() => { setEditingProject(null); setShowModal(true); }}
                className="w-full py-1.5 rounded-lg text-xs font-semibold text-blue-400 transition"
                style={{ border: "1px dashed #1d4ed8" }}>
                {t('addSiteBtn')}
              </button>
            </div>
          </div>
        )}

        {/* ── 메인 영역 ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* 선택된 프로젝트 정보 바 + 서브탭 */}
          {selectedProject ? (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 flex-wrap"
                 style={{
                   backgroundColor: "#0a1521",
                   borderBottom: `2px solid ${selMeta?.color}40`,
                 }}>
              {/* 닫기 */}
              <button
                onClick={() => { setSelected(null); setTasks([]); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition shrink-0"
                style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: "#8896a4" }}>
                {t('backToAll')}
              </button>

              {/* 상태 아이콘 */}
              <span className="text-base">{selMeta?.icon}</span>

              {/* 현장명 */}
              <span className="font-bold text-white text-sm truncate max-w-[200px]">
                {selectedProject.projectName}
              </span>

              {/* 상태 뱃지 */}
              <span className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
                    style={{ backgroundColor: selMeta?.bg, color: selMeta?.color }}>
                {selMeta ? t(selMeta.tKey) : ''}
              </span>

              {/* 주요 정보 */}
              <div className="hidden sm:flex items-center gap-3 text-xs shrink-0"
                   style={{ color: "#64748b" }}>
                {selectedProject.location && <span>📍 {selectedProject.location}</span>}
                {selectedProject.contractAmount && (
                  <span>💰 ₩{Number(selectedProject.contractAmount).toLocaleString()}</span>
                )}
                {selectedProject.managerName && <span>👷 {selectedProject.managerName}</span>}
              </div>

              <div className="flex-1" />

              {/* 서브탭 */}
              <div className="flex gap-1 shrink-0">
                {[
                  { key: "gantt", label: t('tabGantt') },
                  { key: "table", label: t('tabWbs')   },
                  { key: "link",  label: t('tabLink')  },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold transition"
                    style={{
                      backgroundColor: detailTab === tab.key ? "#1e3a5f" : "#1c2a3a",
                      border: `1px solid ${detailTab === tab.key ? "#3b82f6" : "#253347"}`,
                      color: detailTab === tab.key ? "#60a5fa" : "#8896a4",
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* 전체 보기 상태 표시 */
            <div className="shrink-0 flex items-center gap-2 px-4 py-1.5"
                 style={{ backgroundColor: "#06111c", borderBottom: "1px solid #1a2a3a" }}>
              <span className="text-xs" style={{ color: "#334155" }}>
                {t('allGanttLabel')}
                {statusFilter && (
                  <span className="ml-2 px-1.5 rounded"
                        style={{ backgroundColor: STATUS_META[statusFilter]?.bg, color: STATUS_META[statusFilter]?.color }}>
                    {t('filterApplied', { status: t(STATUS_META[statusFilter]?.tKey) })}
                  </span>
                )}
                {" "}&nbsp;·&nbsp; {t('taskCount', { n: ganttTasks.length })}
              </span>
              {selectedProject === null && allTasks.length === 0 && projects.length > 0 && (
                <span className="text-xs" style={{ color: "#475569" }}>
                  — {t('selectSiteHint')}
                </span>
              )}
            </div>
          )}

          {/* ── 메인 콘텐츠 ── */}
          <div className="flex-1 overflow-auto px-4 py-4">

            {/* 로딩 */}
            {selectedProject && taskLoading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <div className="text-center">
                  <div className="text-3xl mb-2 animate-pulse">📊</div>
                  <div className="text-sm">{t('loadingWbs')}</div>
                </div>
              </div>

            /* 선택 프로젝트 뷰 */
            ) : selectedProject ? (
              <>
                {/* 프로젝트 요약 카드 행 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: t('contractAmount'), icon: "💰",
                      value: selectedProject.contractAmount
                        ? `₩ ${Number(selectedProject.contractAmount).toLocaleString()}`
                        : "-" },
                    { label: t('client'),       icon: "🏢", value: selectedProject.clientName  || "-" },
                    { label: t('siteManager'),  icon: "👷", value: selectedProject.managerName || "-" },
                    { label: t('wbsTasks'),     icon: "📋", value: t('taskCount', { n: tasks.length }) },
                  ].map(s => (
                    <div key={s.label}
                         className="rounded-xl p-3"
                         style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}` }}>
                      <p className="text-xs mb-0.5" style={{ color: TB.text2 }}>{s.icon} {s.label}</p>
                      <p className="text-sm font-bold text-white truncate">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* 설명 */}
                {selectedProject.description && (
                  <div className="rounded-xl p-3 mb-4 text-sm"
                       style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}`, color: TB.text2 }}>
                    {selectedProject.description}
                  </div>
                )}

                {/* 서브탭 콘텐츠 */}
                <div className="rounded-xl p-4"
                     style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}` }}>
                  {detailTab === "gantt" && (
                    <>
                      <h3 className="text-sm font-semibold text-gray-300 mb-3">
                        {t('ganttOf', { name: selectedProject.projectName })}
                      </h3>
                      {tasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                          <div className="text-4xl mb-3">📊</div>
                          <p className="text-sm">{t('noTasksTitle')}</p>
                          <button onClick={() => setDetailTab("table")}
                                  className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-blue-400"
                                  style={{ border: "1px dashed #1d4ed8" }}>
                            {t('noTasksGanttHint')}
                          </button>
                        </div>
                      ) : (
                        <GanttChart
                          tasks={tasks}
                          groupByProject={false}
                          onTaskClick={() => setDetailTab("table")}
                        />
                      )}
                    </>
                  )}

                  {detailTab === "table" && (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-300">
                          {t('wbsListTitle', { n: tasks.length })}
                        </h3>
                        {tasks.some(tk => tk.source && tk.source !== "MANUAL") && (
                          <div className="flex gap-2 text-xs text-gray-400">
                            <span>{t('sourceInfo')}</span>
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

                  {detailTab === "link" && (
                    <ProjectLinkPanel
                      wbsProjectId={selectedProject.projectId}
                      onNavigate={handleNavigate}
                    />
                  )}
                </div>
              </>

            /* 전체 간트 뷰 (기본) */
            ) : ganttTasks.length === 0 ? (
              /* 빈 상태 */
              <div className="flex flex-col items-center justify-center py-32 text-center">
                <div className="text-6xl mb-5">{projects.length === 0 ? "🏗" : "📊"}</div>
                <p className="text-lg font-semibold text-gray-400 mb-2">
                  {projects.length === 0 ? t('noSitesTitle') : t('noTasksTitle')}
                </p>
                <p className="text-sm mb-4" style={{ color: TB.text2 }}>
                  {projects.length === 0 ? t('noSitesHint') : t('selectSiteHint')}
                </p>
                {projects.length === 0 && (
                  <button
                    onClick={() => { setEditingProject(null); setShowModal(true); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: "linear-gradient(135deg,#1d4ed8,#1e40af)", border: "1px solid #3b82f6" }}>
                    {t('registerFirstSite')}
                  </button>
                )}
              </div>
            ) : (
              /* 전체 통합 간트 */
              <div className="rounded-xl p-4"
                   style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}` }}>
                <GanttChart
                  tasks={ganttTasks}
                  groupByProject
                  onTaskClick={(t) => {
                    const proj = projects.find(p => p.projectId === t.wbsProjectId);
                    if (proj) selectProject(proj);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 모달 ── */}
      {showModal && (
        <ProjectModal
          initial={editingProject}
          onClose={() => { setShowModal(false); setEditingProject(null); }}
          onSave={editingProject ? handleUpdate : handleCreate}
        />
      )}
    </div>
  );
}
