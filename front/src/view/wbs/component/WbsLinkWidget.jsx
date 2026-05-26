import React, { useState, useEffect, useCallback } from "react";
import AxiosCustom from "../../../axios/AxiosCustom";

/**
 * WbsLinkWidget — BIM / Safe / Simulation 카드에서 사용하는 역방향 WBS 연결 위젯
 *
 * props:
 *   linkedType      : "BIM" | "SAFE" | "SIMULATION"
 *   linkedProjectId : string   — 현재 BIM/Safe/Sim 프로젝트 ID
 *   compact         : boolean  — 카드 내 인라인 표시 모드 (기본 false)
 */
export default function WbsLinkWidget({ linkedType, linkedProjectId, compact = false }) {
  const [links,       setLinks]       = useState([]);   // { linkId, wbsProjectId, wbsProjectName, ... }
  const [wbsProjects, setWbsProjects] = useState([]);   // 연결 가능한 WBS 프로젝트 목록
  const [loading,     setLoading]     = useState(true);
  const [open,        setOpen]        = useState(false); // 패널 열기/닫기
  const [adding,      setAdding]      = useState(false); // 추가 폼 표시
  const [selectedWbs, setSelectedWbs] = useState("");
  const [note,        setNote]        = useState("");
  const [saving,      setSaving]      = useState(false);

  // ── 데이터 로드 ─────────────────────────────────────────────────
  const loadLinks = useCallback(() => {
    if (!linkedProjectId) return;
    setLoading(true);
    AxiosCustom.get(`/api/project-link/linked?type=${linkedType}&id=${linkedProjectId}`)
      .then(r => setLinks(r.data || []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, [linkedType, linkedProjectId]);

  const loadWbsProjects = useCallback(() => {
    AxiosCustom.get("/api/wbs/projects")
      .then(r => setWbsProjects(r.data || []))
      .catch(() => setWbsProjects([]));
  }, []);

  useEffect(() => { loadLinks(); }, [loadLinks]);
  useEffect(() => { if (open) loadWbsProjects(); }, [open, loadWbsProjects]);

  // ── 링크 추가 ────────────────────────────────────────────────────
  async function handleAdd() {
    if (!selectedWbs) return;
    setSaving(true);
    try {
      await AxiosCustom.post("/api/project-link", {
        wbsProjectId:    selectedWbs,
        linkedType:      linkedType,
        linkedProjectId: linkedProjectId,
        note,
      });
      setSelectedWbs(""); setNote(""); setAdding(false);
      loadLinks();
    } finally {
      setSaving(false);
    }
  }

  // ── 링크 해제 ────────────────────────────────────────────────────
  async function handleDelete(linkId) {
    if (!window.confirm("WBS 연결을 해제하시겠습니까?")) return;
    await AxiosCustom.delete(`/api/project-link/${linkId}`);
    loadLinks();
  }

  // ── 이미 연결된 WBS 제외 ─────────────────────────────────────────
  const linkedWbsIds = new Set(links.map(l => l.wbsProjectId));
  const candidates   = wbsProjects.filter(p => !linkedWbsIds.has(p.projectId));

  const inputCls = "bg-[#0d1b2a] border border-[#253347] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-blue-500 w-full";

  // ══════════════════════════════════════════════════════════════════
  //  Compact 모드 — 카드 안 인라인 표시
  // ══════════════════════════════════════════════════════════════════
  if (compact) {
    return (
      <div className="mt-2" onClick={e => e.stopPropagation()}>
        {/* 칩 + 열기 버튼 */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition w-full"
          style={{
            backgroundColor: open ? "#1e3a5f" : "#0a1521",
            border: `1px solid ${open ? "#3b82f6" : "#1a2a3a"}`,
            color: links.length > 0 ? "#60a5fa" : "#475569",
          }}
        >
          <span>🔗</span>
          {loading ? (
            <span>…</span>
          ) : links.length > 0 ? (
            <span>WBS {links.length}개 연결됨</span>
          ) : (
            <span>WBS 연결 없음</span>
          )}
          <span className="ml-auto" style={{ color: "#475569" }}>
            {open ? "▲" : "▼"}
          </span>
        </button>

        {/* 확장 패널 */}
        {open && (
          <div className="mt-1 rounded-xl overflow-hidden"
               style={{ border: "1px solid #1e3a5f", backgroundColor: "#0a1521" }}>

            {/* 연결된 WBS 목록 */}
            <div className="px-2.5 py-2">
              {links.length === 0 ? (
                <p className="text-xs text-center py-2" style={{ color: "#334155" }}>
                  연결된 WBS 프로젝트가 없습니다
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {links.map(link => (
                    <div key={link.linkId}
                         className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                         style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>
                      <span className="text-xs">🏗</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {link.wbsProjectName || link.wbsProjectId}
                        </p>
                        {link.note && (
                          <p className="text-xs truncate" style={{ color: "#475569" }}>
                            {link.note}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(link.linkId)}
                        className="shrink-0 px-1.5 py-0.5 rounded text-xs text-red-400 hover:text-red-300 transition"
                        style={{ border: "1px solid #450a0a" }}
                        title="연결 해제"
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 추가 폼 */}
            {adding ? (
              <div className="px-2.5 pb-2.5 flex flex-col gap-1.5 border-t border-[#1e3a5f] pt-2">
                <select value={selectedWbs} onChange={e => setSelectedWbs(e.target.value)}
                        className={inputCls}>
                  <option value="">-- WBS 프로젝트 선택 --</option>
                  {candidates.map(p => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.projectName}
                    </option>
                  ))}
                </select>
                <input type="text" value={note} onChange={e => setNote(e.target.value)}
                       placeholder="연결 메모 (선택)" className={inputCls} />
                <div className="flex gap-1.5">
                  <button onClick={handleAdd} disabled={!selectedWbs || saving}
                          className="flex-1 py-1 rounded-lg text-xs font-semibold text-white transition"
                          style={{
                            background: selectedWbs ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : "#1c2a3a",
                            border: `1px solid ${selectedWbs ? "#3b82f6" : "#253347"}`,
                          }}>
                    {saving ? "추가 중…" : "🔗 연결"}
                  </button>
                  <button onClick={() => { setAdding(false); setSelectedWbs(""); setNote(""); }}
                          className="px-3 py-1 rounded-lg text-xs text-gray-400"
                          style={{ border: "1px solid #253347" }}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-2.5 pb-2" style={{ borderTop: "1px solid #1a2a3a" }}>
                <button
                  onClick={() => setAdding(true)}
                  className="w-full py-1 rounded text-xs font-medium text-blue-400 mt-2 transition hover:text-blue-200"
                  style={{ border: "1px dashed #1d4ed8" }}
                >
                  + WBS 연결 추가
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  Full 모드 — 페이지/패널에 독립 표시
  // ══════════════════════════════════════════════════════════════════
  return (
    <div className="rounded-xl p-4"
         style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          🔗 연결된 WBS 프로젝트
          <span className="px-1.5 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: "#1e3a5f", color: "#60a5fa" }}>
            {links.length}
          </span>
        </h3>
        <button
          onClick={() => setAdding(v => !v)}
          className="px-3 py-1 rounded-lg text-xs font-semibold transition"
          style={{
            backgroundColor: adding ? "#1e3a5f" : "#1c2a3a",
            border: `1px solid ${adding ? "#3b82f6" : "#253347"}`,
            color: adding ? "#60a5fa" : "#8896a4",
          }}
        >
          {adding ? "✕ 닫기" : "+ WBS 연결 추가"}
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <p className="text-xs text-gray-500 py-4 text-center">로드 중…</p>
      ) : links.length === 0 && !adding ? (
        <div className="text-center py-6">
          <p className="text-sm text-gray-500 mb-1">연결된 WBS 프로젝트가 없습니다</p>
          <p className="text-xs text-gray-600">이 프로젝트와 관련된 WBS 공정표를 연결하세요</p>
          <button onClick={() => setAdding(true)}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-blue-400"
                  style={{ border: "1px dashed #1d4ed8" }}>
            + WBS 연결
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map(link => (
            <div key={link.linkId}
                 className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                 style={{ backgroundColor: "#0d1b2a", border: "1px solid #1e3a5f" }}>
              <span className="text-xl shrink-0">🏗</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {link.wbsProjectName || link.wbsProjectId}
                </p>
                {link.wbsLocation && (
                  <p className="text-xs truncate" style={{ color: "#64748b" }}>
                    📍 {link.wbsLocation}
                  </p>
                )}
                {link.note && (
                  <p className="text-xs truncate" style={{ color: "#94a3b8" }}>
                    💬 {link.note}
                  </p>
                )}
              </div>
              <span className="px-1.5 py-0.5 rounded-full text-xs font-medium shrink-0"
                    style={{ backgroundColor: "#1e3a5f", color: "#60a5fa", border: "1px solid #2a5080" }}>
                WBS
              </span>
              <button onClick={() => handleDelete(link.linkId)}
                      className="shrink-0 px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 transition"
                      style={{ border: "1px solid #450a0a" }}>
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 추가 폼 */}
      {adding && (
        <div className="flex flex-col gap-2 mt-3 p-3 rounded-xl"
             style={{ backgroundColor: "#0a1521", border: "1px solid #1e3a5f" }}>
          <p className="text-xs font-semibold text-gray-400 mb-1">+ WBS 프로젝트 연결</p>
          <select value={selectedWbs} onChange={e => setSelectedWbs(e.target.value)}
                  className="bg-[#0d1b2a] border border-[#253347] rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 w-full">
            <option value="">-- WBS 프로젝트 선택 --</option>
            {candidates.map(p => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName}
                {p.location ? ` (${p.location})` : ""}
              </option>
            ))}
          </select>
          {candidates.length === 0 && wbsProjects.length > 0 && (
            <p className="text-xs" style={{ color: "#475569" }}>
              모든 WBS 프로젝트가 이미 연결되어 있습니다
            </p>
          )}
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
                 placeholder="연결 메모 (선택)"
                 className="bg-[#0d1b2a] border border-[#253347] rounded-lg px-2.5 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500 w-full" />
          <button onClick={handleAdd} disabled={!selectedWbs || saving}
                  className="w-full py-2 rounded-lg text-sm font-semibold text-white transition"
                  style={{
                    background: selectedWbs ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : "#1c2a3a",
                    border: `1px solid ${selectedWbs ? "#3b82f6" : "#253347"}`,
                  }}>
            {saving ? "추가 중…" : "🔗 WBS 연결 추가"}
          </button>
        </div>
      )}
    </div>
  );
}
