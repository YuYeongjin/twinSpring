import React, { useState, useEffect } from "react";
import { useT } from "../../i18n/LanguageContext";
import WbsLinkWidget from "../wbs/component/WbsLinkWidget";
import AxiosCustom from "../../axios/AxiosCustom";
import IotTab from "./IotTab";

const TB = {
  card:  "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  text1: "#e2e8f0",
  text2: "#8896a4",
};

// ── 모드 정의 (tKey는 safeProjectList 네임스페이스 키) ─────────────
const MODE_META = {
  SAFETY:   { icon: "🛡", tKeyLabel: "modeSafetyLabel",   tKeyDesc: "modeSafetyDesc",   color: "#4ade80", bg: "#14532d", border: "#4ade80" },
  CRACK:    { icon: "🔍", tKeyLabel: "modeCrackLabel",    tKeyDesc: "modeCrackDesc",    color: "#60a5fa", bg: "#1e3a5f", border: "#60a5fa" },
  PROGRESS: { icon: "📐", tKeyLabel: "modeProgressLabel", tKeyDesc: "modeProgressDesc", color: "#c4b5fd", bg: "#1a1040", border: "#a78bfa" },
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

  const SAFE_TABS = [
    { key: "projects", label: t('tabProjects') },
    { key: "iot",      label: t('tabIot') },
  ];
  const [activeTab,      setActiveTab]      = useState("projects");
  const [showModal,      setShowModal]      = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [search,         setSearch]         = useState("");
  const [showAllCameras, setShowAllCameras] = useState(false);

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

  // 전체 카메라 조회 화면
  if (showAllCameras) {
    return (
      <AllCameraView
        projectList={projectList}
        onSelectProject={proj => { onProjectSelect(proj); setViceComponent("safe"); }}
        onBack={() => setShowAllCameras(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200">

      {/* 탭 네비게이션 */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-0 border-b border-[#1a2a3a]">
        {SAFE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-5 py-2.5 text-sm font-semibold rounded-t-lg transition"
            style={{
              backgroundColor: activeTab === tab.key ? "#0d1b2a" : "transparent",
              borderTop:    activeTab === tab.key ? "2px solid #4ade80" : "2px solid transparent",
              borderLeft:   activeTab === tab.key ? "1px solid #1a2a3a" : "1px solid transparent",
              borderRight:  activeTab === tab.key ? "1px solid #1a2a3a" : "1px solid transparent",
              color: activeTab === tab.key ? "#4ade80" : "#8896a4",
              marginBottom: "-1px",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* IoT 탭 */}
      {activeTab === "iot" && (
        <IotTab projectList={projectList} />
      )}

      {/* 프로젝트 탭 */}
      {activeTab === "projects" && (
        <div className="p-6">
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
              <button onClick={() => setShowAllCameras(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                      style={{ backgroundColor: "#1e1a3a", border: "1px solid #818cf8", color: "#c4b5fd" }}>
                📹 전체 카메라 조회
              </button>
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

// ══════════════════════════════════════════════════════════════
// 전체 카메라 조회 화면
// 모든 safe 프로젝트의 카메라를 그리드로 표시.
// 각 카드 클릭 → 해당 프로젝트로 이동.
// ══════════════════════════════════════════════════════════════
function AllCameraView({ projectList, onSelectProject, onBack }) {
  const [camerasByProject, setCamerasByProject] = useState({});
  const [latestSnapByProject, setLatestSnapByProject] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectList.length === 0) { setLoading(false); return; }

    // 모든 프로젝트의 카메라 목록 + 최신 스냅샷 병렬 로드
    Promise.all(
      projectList.map(async proj => {
        const [camRes, snapRes] = await Promise.all([
          fetch(`/api/monitoring/cameras/${proj.projectId}`).catch(() => null),
          fetch(`/api/monitoring/snapshots/${proj.projectId}`).catch(() => null),
        ]);
        const cameras   = camRes?.ok  ? await camRes.json()  : [];
        const snapshots = snapRes?.ok ? await snapRes.json() : [];
        return { projectId: proj.projectId, cameras, latestSnap: snapshots[0] ?? null };
      })
    ).then(results => {
      const camMap  = {};
      const snapMap = {};
      results.forEach(({ projectId, cameras, latestSnap }) => {
        camMap[projectId]  = cameras;
        snapMap[projectId] = latestSnap;
      });
      setCamerasByProject(camMap);
      setLatestSnapByProject(snapMap);
      setLoading(false);
    });
  }, [projectList]);

  // 표시할 카드 목록 생성
  // 카메라가 등록된 경우 → 카메라별 1장,  미등록인 경우 → 프로젝트 cameraUrl로 1장
  const cards = projectList.flatMap(proj => {
    const cameras = camerasByProject[proj.projectId] ?? [];
    const snap    = latestSnapByProject[proj.projectId] ?? null;
    if (cameras.length > 0) {
      return cameras.map(cam => ({
        key:        `${proj.projectId}-${cam.cameraId}`,
        project:    proj,
        cameraName: cam.cameraName,
        cameraUrl:  cam.cameraUrl,
        snap,
      }));
    }
    // 카메라 미등록: 프로젝트 cameraUrl이 있으면 1장, 없으면 빈 카드 1장
    return [{
      key:        proj.projectId,
      project:    proj,
      cameraName: proj.cameraUrl ? '기본 카메라' : '카메라 미등록',
      cameraUrl:  proj.cameraUrl ?? null,
      snap,
    }];
  });

  const isCrack = proj => (proj.mode || 'SAFETY') === 'CRACK';

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack}
          className="text-sm px-3 py-1.5 rounded-lg"
          style={{ background: '#1c2a3a', border: '1px solid #253347', color: '#8896a4' }}>
          ← 프로젝트 목록
        </button>
        <h2 className="text-xl font-bold text-white">📹 전체 카메라 조회</h2>
        <span className="text-sm text-gray-500">
          {cards.length}개 카메라 · {projectList.length}개 프로젝트
        </span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-32 text-gray-500">
          카메라 목록 로딩 중…
        </div>
      )}

      {!loading && cards.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="text-6xl mb-4">📷</div>
          <p className="text-gray-400">등록된 프로젝트가 없습니다.</p>
        </div>
      )}

      {/* 카메라 카드 그리드 */}
      {!loading && cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cards.map(card => (
            <CameraCard
              key={card.key}
              card={card}
              isCrack={isCrack(card.project)}
              onClick={() => onSelectProject(card.project)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 카메라 카드 ────────────────────────────────────────────────
function CameraCard({ card, isCrack, onClick }) {
  const { project, cameraName, cameraUrl, snap } = card;
  const hasSnap   = !!snap?.snapshotId;
  const imgUrl    = hasSnap ? `/api/monitoring/snapshot/${snap.snapshotId}/image` : null;
  const isRtsp    = cameraUrl?.toLowerCase().startsWith('rtsp://');
  const noCamera  = !cameraUrl;

  const modeColor  = isCrack ? '#60a5fa' : '#4ade80';
  const modeBg     = isCrack ? '#1e3a5f' : '#14532d';
  const modeBorder = isCrack ? '#3b82f6' : '#22c55e';

  function fmtAgo(iso) {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }

  return (
    <div
      onClick={onClick}
      className="rounded-xl border overflow-hidden flex flex-col cursor-pointer transition-transform hover:scale-[1.02] hover:shadow-xl"
      style={{ borderColor: '#253347', background: '#0a1525' }}
      title={`${project.projectName} 프로젝트로 이동`}>

      {/* 썸네일 영역 */}
      <div className="relative bg-black" style={{ height: '140px' }}>
        {imgUrl ? (
          <img src={imgUrl} alt="snap"
            className="w-full h-full object-cover"
            onError={e => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2"
            style={{ background: '#060f1c' }}>
            <span className="text-4xl opacity-30">
              {noCamera ? '📵' : isRtsp ? '📡' : '📷'}
            </span>
            <span className="text-xs text-gray-600">
              {noCamera ? '카메라 미등록' : isRtsp ? 'RTSP 스트림' : '스냅샷 없음'}
            </span>
          </div>
        )}

        {/* 상태 오버레이 */}
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
          {/* 모드 배지 */}
          <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
            style={{ background: modeBg, border: `1px solid ${modeBorder}`, color: modeColor, fontSize: '10px' }}>
            {isCrack ? '🔍 균열' : '🛡 안전'}
          </span>
          {/* 프로젝트 상태 배지 */}
          {project.status !== 'ACTIVE' && (
            <span className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: '#1e293b', border: '1px solid #475569', color: '#94a3b8', fontSize: '10px' }}>
              {project.status === 'INACTIVE' ? '🟡 비활성' : '⚫ 보관'}
            </span>
          )}
        </div>

        {/* 카메라 URL 타입 */}
        {cameraUrl && (
          <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded"
            style={{ background: isRtsp ? '#1e1a3a' : '#0d2233',
                     border: `1px solid ${isRtsp ? '#818cf8' : '#0ea5e9'}`,
                     color:  isRtsp ? '#c4b5fd' : '#7dd3fc', fontSize: '10px' }}>
            {isRtsp ? 'RTSP' : 'HTTP'}
          </span>
        )}

        {/* 스냅샷 촬영 시간 */}
        {hasSnap && (
          <div className="absolute bottom-0 left-0 right-0 px-2 py-1"
            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
            <span className="text-xs text-gray-300">{fmtAgo(snap.capturedAt)}</span>
            {snap.isProblem && (
              <span className="ml-2 text-xs text-red-400">⚠ 위험 감지</span>
            )}
          </div>
        )}
      </div>

      {/* 카드 정보 */}
      <div className="px-3 py-2.5 flex flex-col gap-1">
        <p className="text-sm font-semibold text-white truncate" title={cameraName}>
          {cameraName}
        </p>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 truncate flex-1" title={project.projectName}>
            📍 {project.projectName}
          </span>
        </div>
        {project.location && (
          <span className="text-xs text-gray-600 truncate">{project.location}</span>
        )}
      </div>
    </div>
  );
}
