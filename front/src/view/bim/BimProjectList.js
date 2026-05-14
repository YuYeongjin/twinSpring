import React, { useState, useRef, useEffect } from "react";

// ================================================================
// 디자인 토큰
// ================================================================
const TB = {
  card:    "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  accent:  "#2196f3",
  success: "#4caf50",
  warning: "#ff9800",
  danger:  "#f44336",
  text1:   "#e2e8f0",
  text2:   "#8896a4",
};

const PROJECT_TYPES = [
  { type: "Bridge",   icon: "🌉", label: "Bridge",   color: "#0ea5e9", bg: "#0c2a3a" },
  { type: "Building", icon: "🏢", label: "Building", color: "#8b5cf6", bg: "#1e1040" },
];

/** 이름이 유효하지 않은 경우 (null, undefined, "", "null", "?", "??…") */
function isInvalidName(name) {
  if (!name) return true;
  const trimmed = name.trim();
  return (
    trimmed === "" ||
    trimmed.toLowerCase() === "null" ||
    /^\?+$/.test(trimmed)
  );
}

// ================================================================
// 인라인 이름 편집 컴포넌트
// ================================================================
function InlineNameEditor({ projectId, currentName, onSave, onCancel }) {
  const [value, setValue] = useState(isInvalidName(currentName) ? "" : currentName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    onSave(projectId, trimmed, (ok) => {
      setSaving(false);
      if (ok) onCancel();
    });
  }

  return (
    <div
      className="flex items-center gap-1.5 mt-1"
      onClick={e => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Enter project name..."
        className="flex-1 px-2 py-1 rounded text-xs outline-none min-w-0"
        style={{
          backgroundColor: "#0d1b2a",
          border: "1px solid #3b82f6",
          color: TB.text1,
        }}
      />
      <button
        onClick={handleSave}
        disabled={!value.trim() || saving}
        title="Save (Enter)"
        className="flex-shrink-0 px-2 py-1 rounded text-xs font-medium transition"
        style={{
          backgroundColor: value.trim() && !saving ? "#1d4ed8" : "#1c2a3a",
          color: value.trim() && !saving ? "#fff" : TB.text2,
          border: "1px solid #3b82f6",
          cursor: !value.trim() || saving ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "…" : "✓"}
      </button>
      <button
        onClick={onCancel}
        title="Cancel (Esc)"
        className="flex-shrink-0 px-2 py-1 rounded text-xs transition"
        style={{
          backgroundColor: "#1c2a3a",
          border: "1px solid #253347",
          color: TB.text2,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ================================================================
// 프로젝트 카드
// ================================================================
function ProjectCard({ item, onOpen, onRename }) {
  const typeInfo = PROJECT_TYPES.find(t => t.type === item.structureType) ?? PROJECT_TYPES[0];
  const [editing, setEditing] = useState(false);
  const invalid = isInvalidName(item.projectName);

  // 이름이 유효하지 않은 카드는 처음에 편집 모드로 시작
  useEffect(() => {
    if (invalid) setEditing(true);
  }, [invalid]);

  function handleRenameClick(e) {
    e.stopPropagation();
    setEditing(true);
  }

  return (
    <div
      className="text-left rounded-xl p-5 transition-all duration-200 group hover:scale-[1.02] hover:shadow-2xl w-full relative"
      style={{
        backgroundColor: "#1c2a3a",
        border: invalid ? `1px solid ${TB.warning}` : "1px solid #253347",
        borderTop: `3px solid ${invalid ? TB.warning : typeInfo.color}`,
      }}
    >
      {/* 아이콘 */}
      <div className="text-4xl mb-3">{typeInfo.icon}</div>

      {/* 프로젝트 이름 */}
      {editing ? (
        <>
          {invalid && (
            <div
              className="text-xs mb-1.5 flex items-center gap-1"
              style={{ color: TB.warning }}
            >
              ⚠ Please enter a name
            </div>
          )}
          <InlineNameEditor
            projectId={item.projectId}
            currentName={item.projectName}
            onSave={onRename}
            onCancel={() => !invalid && setEditing(false)}
          />
        </>
      ) : (
        <div className="flex items-center gap-1.5 group/name">
          <div
            className="font-semibold text-white text-sm truncate flex-1 cursor-pointer"
            title={item.projectName}
            onClick={onOpen}
          >
            {item.projectName}
          </div>
          {/* 연필 아이콘 — hover 시 표시 */}
          <button
            onClick={handleRenameClick}
            title="Rename"
            className="flex-shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity p-0.5 rounded"
            style={{ color: TB.text2 }}
          >
            ✏
          </button>
        </div>
      )}

      {/* 하단 메타 */}
      {!editing && (
        <div className="flex items-center justify-between mt-4">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: typeInfo.bg,
              color: typeInfo.color,
              border: `1px solid ${typeInfo.color}40`,
            }}
          >
            {item.structureType}
          </span>
          <button
            onClick={onOpen}
            className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: TB.accent }}
          >
            Open →
          </button>
        </div>
      )}

      {/* 유효하지 않은 이름 배지 */}
      {invalid && !editing && (
        <div
          className="mt-3 text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1"
          style={{
            backgroundColor: `${TB.warning}20`,
            color: TB.warning,
            border: `1px solid ${TB.warning}50`,
          }}
        >
          ⚠ No Name
        </div>
      )}
    </div>
  );
}

// ================================================================
// 신규 프로젝트 생성 폼
// ================================================================
function CreateProjectForm({ onClose, onCreate }) {
  const [projectType, setProjectType] = useState("Bridge");
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleSubmit = () => {
    if (!projectName.trim()) return;
    setCreating(true);
    onCreate(projectType, projectName.trim(), () => {
      setCreating(false);
      setProjectName("");
      onClose();
    });
  };

  return (
    <div
      className={`${TB.card} p-6 mb-6`}
      style={{ borderLeft: "3px solid #8b5cf6" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Create New Project
        </h3>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition text-lg leading-none"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        {/* 프로젝트 유형 선택 */}
        <div className="flex-1">
          <label className="text-xs mb-2 block" style={{ color: TB.text2 }}>
            Project Type
          </label>
          <div className="flex gap-2">
            {PROJECT_TYPES.map(({ type, icon, label, color, bg }) => (
              <button
                key={type}
                onClick={() => setProjectType(type)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition"
                style={{
                  backgroundColor: projectType === type ? bg : "#152030",
                  border: `1px solid ${projectType === type ? color : "#253347"}`,
                  color: projectType === type ? color : TB.text2,
                }}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>

        {/* 프로젝트 이름 입력 */}
        <div className="flex-1">
          <label className="text-xs mb-2 block" style={{ color: TB.text2 }}>
            프로젝트 이름
          </label>
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSubmit()}
            placeholder="프로젝트 이름을 입력하세요..."
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none focus:ring-2"
            style={{
              backgroundColor: "#152030",
              border: "1px solid #253347",
              color: TB.text1,
              "--tw-ring-color": "#8b5cf6",
            }}
          />
        </div>

        {/* 생성 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={!projectName.trim() || creating}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold transition text-white whitespace-nowrap"
          style={{
            backgroundColor: projectName.trim() && !creating ? "#4c1d95" : "#1c2a3a",
            border: `1px solid ${projectName.trim() ? "#8b5cf6" : "#253347"}`,
            cursor: !projectName.trim() || creating ? "not-allowed" : "pointer",
          }}
        >
          {creating ? "생성 중…" : "프로젝트 생성"}
        </button>
      </div>
    </div>
  );
}

// ================================================================
// BIM 프로젝트 목록 페이지 (메인)
// ================================================================
export default function BimProjectList({
  setViceComponent,
  projectList,
  onProjectSelect,
  onCreateProject,
  onRenameProject,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch]         = useState("");

  const invalidCount = (projectList ?? []).filter(p => isInvalidName(p.projectName)).length;

  const filtered = (projectList ?? []).filter(p =>
    p.projectName?.toLowerCase().includes(search.toLowerCase()) ||
    p.structureType?.toLowerCase().includes(search.toLowerCase()) ||
    (isInvalidName(p.projectName) && "이름없음이름 없음null?".includes(search.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

      {/* ============================================================
          페이지 헤더
          ============================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              🏗 BIM 프로젝트
            </h2>
            <p className="text-sm mt-0.5" style={{ color: TB.text2 }}>
              총 <span className="text-white font-semibold">{projectList?.length ?? 0}</span>개의 프로젝트
              {invalidCount > 0 && (
                <span
                  className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: `${TB.warning}20`,
                    color: TB.warning,
                    border: `1px solid ${TB.warning}50`,
                  }}
                >
                  ⚠ No Name {invalidCount}개
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 검색 */}
          <div className="relative">
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: TB.text2 }}
            >
              🔍
            </span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="프로젝트 검색..."
              className="pl-8 pr-3 py-2 rounded-lg text-sm outline-none w-44"
              style={{
                backgroundColor: "#1c2a3a",
                border: "1px solid #253347",
                color: TB.text1,
              }}
            />
          </div>

          {/* 신규 프로젝트 버튼 */}
          <button
            onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition text-white whitespace-nowrap"
            style={{
              backgroundColor: showCreate ? "#2d1a4a" : "#1e1040",
              border: "1px solid #8b5cf6",
            }}
          >
            {showCreate ? "✕ 취소" : "+ 새 프로젝트"}
          </button>
        </div>
      </div>

      {/* ============================================================
          프로젝트 생성 폼
          ============================================================ */}
      {showCreate && (
        <CreateProjectForm
          onClose={() => setShowCreate(false)}
          onCreate={onCreateProject}
        />
      )}

      {/* ============================================================
          이름 없는 프로젝트 알림 배너
          ============================================================ */}
      {invalidCount > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl mb-5 text-sm"
          style={{
            backgroundColor: `${TB.warning}15`,
            border: `1px solid ${TB.warning}40`,
            color: TB.warning,
          }}
        >
          <span className="text-lg">⚠</span>
          <span>
            이름이 설정되지 않은 프로젝트 <strong>{invalidCount}개</strong>가 있습니다.
            카드의 이름 입력란에 직접 입력하여 수정할 수 있습니다.
          </span>
        </div>
      )}

      {/* ============================================================
          프로젝트 유형 필터 칩
          ============================================================ */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs" style={{ color: TB.text2 }}>필터:</span>
        {PROJECT_TYPES.map(({ type, icon, color }) => {
          const count = (projectList ?? []).filter(p => p.structureType === type).length;
          return (
            <button
              key={type}
              onClick={() => setSearch(prev => prev === type ? "" : type)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition"
              style={{
                backgroundColor: search === type ? `${color}20` : "#1c2a3a",
                border: `1px solid ${search === type ? color : "#253347"}`,
                color: search === type ? color : TB.text2,
              }}
            >
              {icon} {type} ({count})
            </button>
          );
        })}
        {search && !PROJECT_TYPES.find(t => t.type === search) && (
          <button
            onClick={() => setSearch("")}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs transition"
            style={{ border: "1px solid #253347", color: TB.text2 }}
          >
            ✕ 초기화
          </button>
        )}
      </div>

      {/* ============================================================
          프로젝트 카드 그리드
          ============================================================ */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((item, i) => (
            <ProjectCard
              key={item.projectId ?? i}
              item={item}
              onOpen={() => { onProjectSelect(item); setViceComponent("bim"); }}
              onRename={onRenameProject}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="text-7xl mb-5">
            {search ? "🔍" : "🏗"}
          </div>
          <div className="text-lg font-semibold text-gray-400 mb-2">
            {search ? `"${search}" 검색 결과 없음` : "프로젝트가 없습니다"}
          </div>
          <div className="text-sm" style={{ color: TB.text2 }}>
            {search
              ? "다른 검색어를 입력하거나 필터를 초기화하세요"
              : <>
                  "+ 새 프로젝트" 버튼으로 첫 BIM 프로젝트를 만들어보세요 <br />
                  <span className="opacity-60">교량(Bridge) 또는 건물(Building) 유형을 선택할 수 있습니다</span>
                </>
            }
          </div>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="mt-4 px-4 py-2 rounded-lg text-sm transition"
              style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}
            >
              필터 초기화
            </button>
          )}
        </div>
      )}
    </div>
  );
}
