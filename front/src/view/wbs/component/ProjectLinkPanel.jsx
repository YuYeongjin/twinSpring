import React, { useState, useEffect, useCallback } from "react";
import AxiosCustom from "../../../axios/AxiosCustom";

// ══════════════════════════════════════════════════════════════════
//  설정
// ══════════════════════════════════════════════════════════════════
const TYPE_META = {
  BIM:        { label: "BIM",        icon: "🏗", color: "#60a5fa", bg: "#1e3a5f", border: "#2a5080" },
  SAFE:       { label: "안전",       icon: "🛡", color: "#4ade80", bg: "#14532d", border: "#166534" },
  SIMULATION: { label: "시뮬레이션", icon: "🚜", color: "#c084fc", bg: "#3b0764", border: "#6d28d9" },
};

// ── 링크 카드 ────────────────────────────────────────────────────
function LinkCard({ link, onDelete, onNavigate }) {
  const meta = TYPE_META[link.linkedType] || TYPE_META.BIM;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
         style={{ backgroundColor: "#1c2a3a", border: `1px solid ${meta.border}` }}>
      <span className="text-xl shrink-0">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">
          {link.linkedProjectName || link.linkedProjectId}
        </p>
        {link.linkedLocation && (
          <p className="text-xs truncate" style={{ color: "#64748b" }}>
            📍 {link.linkedLocation}
          </p>
        )}
        {link.note && (
          <p className="text-xs truncate" style={{ color: "#94a3b8" }}>
            💬 {link.note}
          </p>
        )}
      </div>
      <span className="px-1.5 py-0.5 rounded-full text-xs font-medium shrink-0"
            style={{ backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
        {meta.label}
      </span>
      <div className="flex gap-1 shrink-0">
        {onNavigate && (
          <button onClick={() => onNavigate(link)}
                  className="px-2 py-1 rounded text-xs text-blue-400 hover:text-blue-200 transition"
                  style={{ border: "1px solid #1d4ed8" }}>
            이동
          </button>
        )}
        <button onClick={() => onDelete(link.linkId)}
                className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 transition"
                style={{ border: "1px solid #450a0a" }}>
          🗑
        </button>
      </div>
    </div>
  );
}

// ── 프로젝트 선택 드롭다운 ────────────────────────────────────────
function AddLinkForm({ wbsProjectId, onAdded }) {
  const [type,        setType]        = useState("BIM");
  const [candidates,  setCandidates]  = useState([]);
  const [selectedId,  setSelectedId]  = useState("");
  const [note,        setNote]        = useState("");
  const [saving,      setSaving]      = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  // 타입 변경 시 해당 프로젝트 목록 로드
  useEffect(() => {
    setSelectedId("");
    setLoadingList(true);
    const endpoint =
      type === "BIM"        ? "/api/bim/projects" :
      type === "SAFE"       ? "/api/safe/projects" :
                              "/api/simulation/projects";
    AxiosCustom.get(endpoint)
      .then(r => setCandidates(r.data || []))
      .catch(() => setCandidates([]))
      .finally(() => setLoadingList(false));
  }, [type]);

  async function handleAdd() {
    if (!selectedId) return;
    setSaving(true);
    try {
      await AxiosCustom.post("/api/project-link", {
        wbsProjectId,
        linkedType:      type,
        linkedProjectId: selectedId,
        note,
      });
      setSelectedId("");
      setNote("");
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "bg-[#0d1b2a] border border-[#253347] rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500";

  return (
    <div className="flex flex-col gap-2 mt-3 p-3 rounded-xl"
         style={{ backgroundColor: "#0a1521", border: "1px solid #1e3a5f" }}>
      <p className="text-xs font-semibold text-gray-400 mb-1">+ 프로젝트 연결 추가</p>

      {/* 타입 선택 */}
      <div className="flex gap-2">
        {Object.entries(TYPE_META).map(([k, v]) => (
          <button key={k} onClick={() => setType(k)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium transition"
                  style={{
                    backgroundColor: type === k ? v.bg : "#1c2a3a",
                    border: `1px solid ${type === k ? v.border : "#253347"}`,
                    color: type === k ? v.color : "#64748b",
                  }}>
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {/* 프로젝트 선택 */}
      <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              disabled={loadingList}
              className={`${inputCls} w-full`}>
        <option value="">{loadingList ? "로드 중…" : "-- 프로젝트 선택 --"}</option>
        {candidates.map(c => (
          <option key={c.projectId} value={c.projectId}>
            {c.projectName || c.projectId}
          </option>
        ))}
      </select>

      {/* 메모 */}
      <input type="text" value={note} onChange={e => setNote(e.target.value)}
             placeholder="연결 메모 (선택)"
             className={`${inputCls} w-full`} />

      <button onClick={handleAdd} disabled={!selectedId || saving}
              className="w-full py-2 rounded-lg text-sm font-semibold text-white transition"
              style={{
                background: selectedId ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : "#1c2a3a",
                border: `1px solid ${selectedId ? "#3b82f6" : "#253347"}`,
              }}>
        {saving ? "추가 중…" : "🔗 연결 추가"}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 패널
// ══════════════════════════════════════════════════════════════════
/**
 * props:
 *   wbsProjectId : string
 *   onNavigate   : (link: ProjectLinkDTO) => void  — 연결 탭으로 이동
 */
export default function ProjectLinkPanel({ wbsProjectId, onNavigate }) {
  const [links,      setLinks]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showAdd,    setShowAdd]    = useState(false);

  const loadLinks = useCallback(() => {
    if (!wbsProjectId) return;
    setLoading(true);
    AxiosCustom.get(`/api/project-link/wbs/${wbsProjectId}`)
      .then(r => setLinks(r.data || []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, [wbsProjectId]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  async function handleDelete(linkId) {
    if (!window.confirm("연결을 해제하시겠습니까?")) return;
    await AxiosCustom.delete(`/api/project-link/${linkId}`);
    loadLinks();
  }

  // 타입별 그룹화
  const grouped = links.reduce((acc, l) => {
    if (!acc[l.linkedType]) acc[l.linkedType] = [];
    acc[l.linkedType].push(l);
    return acc;
  }, {});

  return (
    <div className="rounded-xl p-4"
         style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          🔗 연결된 프로젝트
          <span className="px-1.5 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: "#1e3a5f", color: "#60a5fa" }}>
            {links.length}
          </span>
        </h3>
        <button onClick={() => setShowAdd(v => !v)}
                className="px-3 py-1 rounded-lg text-xs font-semibold transition"
                style={{
                  backgroundColor: showAdd ? "#1e3a5f" : "#1c2a3a",
                  border: `1px solid ${showAdd ? "#3b82f6" : "#253347"}`,
                  color: showAdd ? "#60a5fa" : "#8896a4",
                }}>
          {showAdd ? "✕ 닫기" : "+ 연결 추가"}
        </button>
      </div>

      {/* 링크 목록 */}
      {loading ? (
        <p className="text-xs text-gray-500 py-4 text-center">로드 중…</p>
      ) : links.length === 0 && !showAdd ? (
        <div className="text-center py-6">
          <p className="text-sm text-gray-500 mb-1">연결된 프로젝트가 없습니다</p>
          <p className="text-xs text-gray-600">BIM · 안전 · 시뮬레이션 프로젝트를 연결하세요</p>
          <button onClick={() => setShowAdd(true)}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-blue-400"
                  style={{ border: "1px dashed #1d4ed8" }}>
            + 프로젝트 연결
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {Object.entries(grouped).map(([type, typeLinks]) => (
            <div key={type}>
              <p className="text-xs font-semibold mb-1.5"
                 style={{ color: TYPE_META[type]?.color || "#94a3b8" }}>
                {TYPE_META[type]?.icon} {TYPE_META[type]?.label} ({typeLinks.length})
              </p>
              <div className="flex flex-col gap-1.5">
                {typeLinks.map(link => (
                  <LinkCard key={link.linkId} link={link}
                            onDelete={handleDelete}
                            onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 추가 폼 */}
      {showAdd && (
        <AddLinkForm
          wbsProjectId={wbsProjectId}
          onAdded={() => { loadLinks(); setShowAdd(false); }}
        />
      )}
    </div>
  );
}
