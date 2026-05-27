import React, { useState, useEffect } from "react";
import { useT } from "../../i18n/LanguageContext";
import WbsLinkWidget from "../wbs/component/WbsLinkWidget";
import AxiosCustom from "../../axios/AxiosCustom";

const TB = {
  card:  "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  text1: "#e2e8f0",
  text2: "#8896a4",
};

// ── 모드 정의 (tKey는 safeProjectList 네임스페이스 키) ─────────────
const MODE_META = {
  SAFETY: { icon: "🛡", tKeyLabel: "modeSafetyLabel", tKeyDesc: "modeSafetyDesc", color: "#4ade80", bg: "#14532d", border: "#4ade80" },
  CRACK:  { icon: "🔍", tKeyLabel: "modeCrackLabel",  tKeyDesc: "modeCrackDesc",  color: "#60a5fa", bg: "#1e3a5f", border: "#60a5fa" },
};

// ── 상태 정의 (tKey는 safeProjectList 네임스페이스 키) ─────────────
const STATUS_META = {
  ACTIVE:   { tKey: "statusActive",   color: "#4ade80", bg: "#14532d", icon: "🟢" },
  INACTIVE: { tKey: "statusInactive", color: "#f59e0b", bg: "#451a03", icon: "🟡" },
  ARCHIVED: { tKey: "statusArchived", color: "#64748b", bg: "#1e293b", icon: "⚫" },
};

// ── WBS 프로젝트 선택 드롭다운 패널 ──────────────────────────────
function WbsProjectPicker({ selectedId, onChange, wbsProjects, loading, t }) {
  const [open, setOpen] = useState(false);
  const selected = wbsProjects.find(p => p.projectId === selectedId);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition"
              style={{
                backgroundColor: open ? "#0d2040" : "#0d1b2a",
                border: `1px solid ${selectedId ? "#3b82f6" : open ? "#3b82f6" : "#253347"}`,
                color: selectedId ? "#93c5fd" : "#6b7280",
              }}>
        <span className="flex items-center gap-2">
          <span>{selectedId ? "🔗" : "⭕"}</span>
          <span>{loading ? t('wbsLoading') : selected ? selected.projectName : t('wbsNone')}</span>
        </span>
        <span style={{ color: "#374151" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
             style={{ backgroundColor: "#0a1521", border: "1px solid #1e3a5f", maxHeight: "220px" }}>
          <div style={{ overflowY: "auto", maxHeight: "220px" }}>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-[#0d1b2a] transition"
                    style={{ borderBottom: "1px solid #1a2a3a", color: !selectedId ? "#60a5fa" : "#6b7280" }}>
              <span>⭕</span>
              <span>{t('wbsNone')}</span>
              {!selectedId && <span className="ml-auto text-blue-400">✓</span>}
            </button>
            {wbsProjects.length === 0 && !loading && (
              <div className="px-3 py-4 text-xs text-center" style={{ color: "#374151" }}>
                {t('wbsEmpty')}
              </div>
            )}
            {wbsProjects.map(p => (
              <button key={p.projectId} type="button"
                      onClick={() => { onChange(p.projectId); setOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-[#0d1b2a] transition"
                      style={{ borderBottom: "1px solid #1a2a3a", color: selectedId === p.projectId ? "#60a5fa" : "#d1d5db" }}>
                <span>🏗</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.projectName}</div>
                  {p.location && (
                    <div className="text-xs truncate" style={{ color: "#4b5563" }}>📍 {p.location}</div>
                  )}
                </div>
                {selectedId === p.projectId && <span className="shrink-0 text-blue-400">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

// ── 프로젝트 생성/편집 모달 ────────────────────────────────────
function ProjectModal({ initial = null, onClose, onSave }) {
  const t = useT('safeProjectList');
  const isEdit = !!initial;
  const [form, setForm] = useState(
    initial ?? { projectName: "", location: "", description: "", cameraUrl: "", status: "ACTIVE", mode: "SAFETY" }
  );
  const [saving,      setSaving]      = useState(false);
  const [wbsProjects, setWbsProjects] = useState([]);
  const [wbsLoading,  setWbsLoading]  = useState(true);
  const [selectedWbs, setSelectedWbs] = useState("");

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }));
  const inputCls = "w-full bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500";

  useEffect(() => {
    setWbsLoading(true);
    AxiosCustom.get("/api/wbs/projects")
      .then(r => setWbsProjects(r.data || []))
      .catch(() => setWbsProjects([]))
      .finally(() => setWbsLoading(false));
  }, []);

  async function handleSave() {
    if (!form.projectName?.trim()) return;
    setSaving(true);
    try {
      const result = await onSave(form);
      if (!isEdit && selectedWbs && result?.projectId) {
        try {
          await AxiosCustom.post("/api/project-link", {
            wbsProjectId:    selectedWbs,
            linkedType:      "SAFE",
            linkedProjectId: result.projectId,
            note:            "",
          });
        } catch (e) {
          console.warn("WBS link create failed (project was saved):", e);
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const currentMode = form.mode || "SAFETY";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl flex flex-col"
           style={{ backgroundColor: "#0f1e2d", border: "1px solid #253347", maxHeight: "90vh" }}>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h3 className="text-base font-bold text-white">
            {isEdit ? t('modalEdit') : t('modalCreate')}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl">✕</button>
        </div>

        {/* 스크롤 영역 */}
        <div className="flex flex-col gap-4 px-6 pb-2 overflow-y-auto">

          {/* 프로젝트 유형 */}
          <div>
            <label className="text-xs mb-2 block font-semibold" style={{ color: TB.text2 }}>
              {t('fieldType')}
              {isEdit && <span className="ml-1 font-normal opacity-50">{t('typeNoChange')}</span>}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(MODE_META).map(([key, meta]) => {
                const selected = currentMode === key;
                return (
                  <button key={key} type="button"
                    disabled={isEdit}
                    onClick={() => !isEdit && setForm(prev => ({ ...prev, mode: key }))}
                    className="rounded-xl p-3 text-left transition-all"
                    style={{
                      backgroundColor: selected ? meta.bg : "#0d1b2a",
                      border: `2px solid ${selected ? meta.border : "#253347"}`,
                      cursor: isEdit ? "not-allowed" : "pointer",
                      opacity: isEdit && !selected ? 0.4 : 1,
                    }}>
                    <div className="text-lg mb-1">{meta.icon}</div>
                    <div className="text-xs font-bold" style={{ color: selected ? meta.color : "#8896a4" }}>
                      {t(meta.tKeyLabel)}
                    </div>
                    <div className="text-xs mt-0.5 leading-tight" style={{ color: "#4b5563" }}>
                      {t(meta.tKeyDesc)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 프로젝트명 */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldName')}</label>
            <input value={form.projectName} onChange={set("projectName")}
                   placeholder={t('namePlaceholder')} autoFocus className={inputCls} />
          </div>

          {/* 위치 */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldLocation')}</label>
            <input value={form.location} onChange={set("location")}
                   placeholder={t('locationPlaceholder')} className={inputCls} />
          </div>

          {/* 카메라 URL (안전 감시 모드만) */}
          {currentMode === "SAFETY" && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldCameraUrl')}</label>
              <input value={form.cameraUrl} onChange={set("cameraUrl")}
                     placeholder={t('cameraPlaceholder')} className={inputCls} />
            </div>
          )}

          {/* 상태 */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldStatus')}</label>
            <select value={form.status} onChange={set("status")} className={inputCls}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {t(v.tKey)}</option>
              ))}
            </select>
          </div>

          {/* 설명 */}
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldDescription')}</label>
            <textarea value={form.description} onChange={set("description")}
                      rows={2} placeholder={t('descPlaceholder')}
                      className={`${inputCls} resize-none`} />
          </div>

          {/* WBS 연결 */}
          <div>
            <label className="text-xs mb-2 block font-semibold flex items-center gap-1.5"
                   style={{ color: TB.text2 }}>
              {t('fieldWbs')}
              <span className="font-normal opacity-60">{t('wbsOptional')}</span>
            </label>
            {isEdit ? (
              <WbsLinkWidget linkedType="SAFE" linkedProjectId={initial.projectId} />
            ) : (
              <WbsProjectPicker
                selectedId={selectedWbs}
                onChange={setSelectedWbs}
                wbsProjects={wbsProjects}
                loading={wbsLoading}
                t={t}
              />
            )}
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="flex gap-3 px-6 py-5 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm"
                  style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
            {t('btnCancel')}
          </button>
          <button onClick={handleSave} disabled={!form.projectName?.trim() || saving}
                  className="flex-[2] py-2.5 rounded-lg text-sm font-semibold text-white"
                  style={{
                    background: form.projectName?.trim() ? "linear-gradient(135deg,#065f46,#047857)" : "#1c2a3a",
                    border: `1px solid ${form.projectName?.trim() ? "#4ade80" : "#253347"}`,
                  }}>
            {saving ? t('btnSaving') : isEdit ? t('btnSave') : t('btnCreate')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 프로젝트 카드 ─────────────────────────────────────────────
function ProjectCard({ project, onSelect, onEdit, onDelete, t }) {
  const statusMeta = STATUS_META[project.status] || STATUS_META.ACTIVE;
  const modeMeta   = MODE_META[project.mode || "SAFETY"] || MODE_META.SAFETY;
  return (
    <div className="rounded-xl p-4 cursor-pointer transition-all duration-200"
         style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", borderTop: `3px solid ${statusMeta.color}` }}
         onClick={() => onSelect(project)}>

      {/* 상단: 상태 + 모드 배지 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xl">{statusMeta.icon}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: modeMeta.bg, color: modeMeta.color, border: `1px solid ${modeMeta.border}40` }}>
            {modeMeta.icon} {t(modeMeta.tKeyLabel)}
          </span>
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: statusMeta.bg, color: statusMeta.color }}>
          {t(statusMeta.tKey)}
        </span>
      </div>

      {/* 프로젝트명 */}
      <h3 className="font-bold text-white text-sm leading-tight mb-1 line-clamp-2">
        {project.projectName}
      </h3>
      <p className="text-xs truncate" style={{ color: TB.text2 }}>
        📍 {project.location || t('locationUnset')}
      </p>
      {project.cameraUrl && (
        <p className="text-xs truncate mt-0.5" style={{ color: "#60a5fa" }}>
          {t('cameraConnected')}
        </p>
      )}

      {/* 액션 버튼 */}
      <div className="flex gap-1 mt-3" onClick={e => e.stopPropagation()}>
        <button onClick={() => onSelect(project)}
                className="flex-1 py-1 rounded text-xs font-semibold text-white"
                style={{ backgroundColor: "#065f46", border: "1px solid #4ade80" }}>
          {t('monitoring')}
        </button>
        <button onClick={() => onEdit(project)}
                className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white"
                style={{ border: "1px solid #253347" }}>
          {t('edit')}
        </button>
        <button onClick={() => onDelete(project.projectId)}
                className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300"
                style={{ border: "1px solid #450a0a" }}>
          🗑
        </button>
      </div>

      {/* WBS 연결 위젯 */}
      <WbsLinkWidget linkedType="SAFE" linkedProjectId={project.projectId} compact />
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function SafeProjectList({
  setViceComponent,
  projectList = [],
  onProjectSelect,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
}) {
  const t = useT('safeProjectList');
  const [showModal,      setShowModal]      = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [search,         setSearch]         = useState("");

  const filtered = projectList.filter(p =>
    p.projectName?.toLowerCase().includes(search.toLowerCase()) ||
    p.location?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total:    projectList.length,
    active:   projectList.filter(p => p.status === "ACTIVE").length,
    inactive: projectList.filter(p => p.status === "INACTIVE").length,
  };

  async function handleDelete(projectId) {
    if (!window.confirm(t('deleteConfirm'))) return;
    await onDeleteProject(projectId);
  }

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            {t('title')}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: TB.text2 }}>
            {t('subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: TB.text2 }}>🔍</span>
            <input type="text" value={search}
                   onChange={e => setSearch(e.target.value)}
                   placeholder={t('searchPlaceholder')}
                   className="pl-8 pr-3 py-2 rounded-lg text-sm outline-none w-44"
                   style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text1 }} />
          </div>
          <button onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: "#065f46", border: "1px solid #4ade80" }}>
            {t('addProject')}
          </button>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: t('total'),    value: stats.total,    color: "#60a5fa", icon: "🛡" },
          { label: t('active'),   value: stats.active,   color: "#4ade80", icon: "🟢" },
          { label: t('inactive'), value: stats.inactive, color: "#f59e0b", icon: "🟡" },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center"
               style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-0.5" style={{ color: TB.text2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 카드 그리드 */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => (
            <ProjectCard
              key={p.projectId}
              project={p}
              t={t}
              onSelect={(proj) => { onProjectSelect(proj); setViceComponent("safe"); }}
              onEdit={(proj) => { setEditingProject(proj); setShowModal(true); }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="text-7xl mb-5">{search ? "🔍" : "🛡"}</div>
          <div className="text-lg font-semibold text-gray-400 mb-2">
            {search ? t('noResults', { search }) : t('noSites')}
          </div>
          <div className="text-sm" style={{ color: TB.text2 }}>
            {search ? t('searchPlaceholder') : t('noSitesHint')}
          </div>
        </div>
      )}

      {showModal && (
        <ProjectModal
          initial={editingProject}
          onClose={() => { setShowModal(false); setEditingProject(null); }}
          onSave={editingProject
            ? (f) => onUpdateProject(editingProject.projectId, f)
            : onCreateProject}
        />
      )}
    </div>
  );
}
