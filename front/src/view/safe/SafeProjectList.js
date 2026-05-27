import React, { useState } from "react";
import { useT } from "../../i18n/LanguageContext";

const TB = {
  card:    "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  text1:   "#e2e8f0",
  text2:   "#8896a4",
};

const STATUS_META = {
  ACTIVE:   { ko: "운영중",  color: "#4ade80", bg: "#14532d", icon: "🟢" },
  INACTIVE: { ko: "중단",    color: "#f59e0b", bg: "#451a03", icon: "🟡" },
  ARCHIVED: { ko: "보관",    color: "#64748b", bg: "#1e293b", icon: "⚫" },
};

// ── 프로젝트 생성/편집 모달 ────────────────────────────────────
function ProjectModal({ initial = null, onClose, onSave }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(
    initial ?? { projectName: "", location: "", description: "", cameraUrl: "", status: "ACTIVE" }
  );
  const [saving, setSaving] = useState(false);

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }));
  const inputCls = "w-full bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500";

  async function handleSave() {
    if (!form.projectName?.trim()) return;
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
         onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
           style={{ backgroundColor: "#0f1e2d", border: "1px solid #253347" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-white">
            {isEdit ? "🛡 현장 수정" : "🛡 새 안전 현장"}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>현장명 *</label>
            <input value={form.projectName} onChange={set("projectName")}
                   placeholder="예: A동 3층 출입구" autoFocus className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>위치</label>
            <input value={form.location} onChange={set("location")}
                   placeholder="예: 서울 강남구 현장 2구역" className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>카메라 URL (선택)</label>
            <input value={form.cameraUrl} onChange={set("cameraUrl")}
                   placeholder="rtsp://... 또는 http://..." className={inputCls} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>상태</label>
            <select value={form.status} onChange={set("status")} className={inputCls}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.ko}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>설명</label>
            <textarea value={form.description} onChange={set("description")}
                      rows={2} placeholder="카메라 위치, 모니터링 범위 등"
                      className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm"
                  style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
            취소
          </button>
          <button onClick={handleSave} disabled={!form.projectName?.trim() || saving}
                  className="flex-[2] py-2.5 rounded-lg text-sm font-semibold text-white"
                  style={{
                    background: form.projectName?.trim() ? "linear-gradient(135deg,#065f46,#047857)" : "#1c2a3a",
                    border: `1px solid ${form.projectName?.trim() ? "#4ade80" : "#253347"}`,
                  }}>
            {saving ? "저장 중…" : (isEdit ? "💾 수정" : "🛡 현장 추가")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 프로젝트 카드 ─────────────────────────────────────────────
function ProjectCard({ project, selected, onSelect, onEdit, onDelete }) {
  const meta = STATUS_META[project.status] || STATUS_META.ACTIVE;
  return (
    <div
      className="rounded-xl p-4 cursor-pointer transition-all duration-200"
      style={{
        backgroundColor: "#1c2a3a",
        border: `1px solid ${selected ? "#4ade80" : "#253347"}`,
        borderTop: `3px solid ${meta.color}`,
        boxShadow: selected ? "0 0 0 2px #4ade8040" : undefined,
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
      {project.cameraUrl && (
        <p className="text-xs truncate mt-0.5" style={{ color: "#60a5fa" }}>
          📷 카메라 연결됨
        </p>
      )}
      <div className="flex gap-1 mt-3" onClick={e => e.stopPropagation()}>
        <button onClick={() => onSelect(project)}
                className="flex-1 py-1 rounded text-xs font-semibold text-white"
                style={{ backgroundColor: "#065f46", border: "1px solid #4ade80" }}>
          모니터링
        </button>
        <button onClick={() => onEdit(project)}
                className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white"
                style={{ border: "1px solid #253347" }}>
          편집
        </button>
        <button onClick={() => onDelete(project.projectId)}
                className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300"
                style={{ border: "1px solid #450a0a" }}>
          🗑
        </button>
      </div>
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
  const [showModal,       setShowModal]       = useState(false);
  const [editingProject,  setEditingProject]  = useState(null);
  const [search,          setSearch]          = useState("");

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
    if (!window.confirm("현장을 삭제하시겠습니까?")) return;
    await onDeleteProject(projectId);
  }

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            🛡 안전 <span className="text-green-400">모니터링 현장</span>
          </h2>
          <p className="text-sm mt-0.5" style={{ color: TB.text2 }}>
            현장별 카메라 · 헬멧 · 출입금지구역 감지
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: TB.text2 }}>🔍</span>
            <input type="text" value={search}
                   onChange={e => setSearch(e.target.value)}
                   placeholder="현장 검색"
                   className="pl-8 pr-3 py-2 rounded-lg text-sm outline-none w-40"
                   style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text1 }} />
          </div>
          <button onClick={() => setShowModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ backgroundColor: "#065f46", border: "1px solid #4ade80" }}>
            + 현장 추가
          </button>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "전체 현장",  value: stats.total,    color: "#60a5fa", icon: "🛡" },
          { label: "운영중",     value: stats.active,   color: "#4ade80", icon: "🟢" },
          { label: "중단",       value: stats.inactive, color: "#f59e0b", icon: "🟡" },
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
              selected={false}
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
            {search ? `"${search}" 검색 결과 없음` : "등록된 안전 현장이 없습니다"}
          </div>
          <div className="text-sm" style={{ color: TB.text2 }}>
            {search ? "다른 검색어를 입력하세요" : '"+ 현장 추가" 버튼으로 카메라 현장을 등록하세요'}
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
