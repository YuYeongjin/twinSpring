import React, { useState, useRef, useEffect, useCallback } from "react";
import DroneAnalysisModal from "./component/DroneAnalysisModal";
import { useT } from "../../i18n/LanguageContext";
import { parseIfcFile } from "../../utils/ifcImporter";
import WbsLinkWidget from "../wbs/component/WbsLinkWidget";

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
  const t = useT('bimProjectList');
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
            placeholder={t('enterProjectName')}
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
function ProjectCard({ item, onOpen, onRename, onDelete }) {
  const t = useT('bimProjectList');
  const typeInfo = PROJECT_TYPES.find(t => t.type === item.structureType) ?? PROJECT_TYPES[0];
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const invalid = isInvalidName(item.projectName);

  useEffect(() => {
    if (invalid) setEditing(true);
  }, [invalid]);

  const showActions = (hovered || active) && !editing;

  function handleCardClick() {
    if (editing) return;
    if (active) setConfirmDelete(false);
    setActive(v => !v);
  }

  return (
      <div
          className="text-left rounded-xl p-2 transition-all duration-200 w-full relative cursor-pointer select-none"
          style={{
            backgroundColor: "#1c2a3a",
            border: invalid ? `1px solid ${TB.warning}` : `1px solid ${active ? '#3b82f6' : '#253347'}`,
            borderTop: `3px solid ${invalid ? TB.warning : typeInfo.color}`,
            boxShadow: active ? '0 0 0 2px #3b82f640, 0 4px 20px rgba(59,130,246,0.15)'
                : hovered ? '0 4px 16px rgba(0,0,0,0.45)' : undefined,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={handleCardClick}
      >
        {/* 아이콘 */}
        <div className="text-4xl mb-3">{typeInfo.icon}</div>

        {/* 프로젝트 이름 */}
        {editing ? (
            <>
              {invalid && (
                  <div className="text-xs mb-1.5 flex items-center gap-1" style={{ color: TB.warning }}>
                    {t('pleaseEnterName')}
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
            <div className="font-semibold text-white text-sm truncate" title={item.projectName}>
              {item.projectName}
            </div>
        )}

        {/* 타입 배지 (액션 없을 때) */}
        {!editing && !showActions && (
            <div className="flex items-center mt-4">
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
            </div>
        )}

        {/* 액션 버튼 — 열기 / 수정 / 삭제 */}
        {!editing && showActions && !confirmDelete && (
            <div className="flex gap-1 mt-4" onClick={e => e.stopPropagation()}>
              <button
                  onClick={e => { e.stopPropagation(); onOpen(); }}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition"
                  style={{ backgroundColor: '#1d4ed8', border: '1px solid #3b82f6', color: '#fff' }}
              >
                {t('open')}
              </button>
              <button
                  onClick={e => { e.stopPropagation(); setEditing(true); setActive(false); }}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition"
                  style={{ backgroundColor: '#1c2a3a', border: '1px solid #475569', color: TB.text1 }}
              >
                {t('rename')}
              </button>
              <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition"
                  style={{ backgroundColor: '#450a0a', border: `1px solid ${TB.danger}`, color: TB.danger }}
              >
                {t('delete')}
              </button>
            </div>
        )}

        {/* 삭제 확인 */}
        {!editing && showActions && confirmDelete && (
            <div onClick={e => e.stopPropagation()}>
              <p className="text-xs mt-3 mb-2" style={{ color: TB.warning }}>{t('really')}</p>
              <div className="flex gap-1.5">
                <button
                    onClick={e => { e.stopPropagation(); onDelete(item.projectId); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition"
                    style={{ backgroundColor: '#7f1d1d', border: `1px solid ${TB.danger}`, color: '#fff' }}
                >
                  {t('yes')}
                </button>
                <button
                    onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition"
                    style={{ backgroundColor: '#1c2a3a', border: '1px solid #475569', color: TB.text1 }}
                >
                  {t('no')}
                </button>
              </div>
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
              {t('noNameBadge')}
            </div>
        )}

        {/* WBS 연결 위젯 */}
        {!invalid && item.projectId && (
            <WbsLinkWidget
                linkedType="BIM"
                linkedProjectId={item.projectId}
                compact
            />
        )}
      </div>
  );
}

// ================================================================
// 신규 프로젝트 생성 폼
// ================================================================
function CreateProjectForm({ onClose, onCreate }) {
  const t = useT('bimProjectList');
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
            {t('createNewProject')}
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
              {t('projectType')}
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
              {t('projectNameLabel')}
            </label>
            <input
                type="text"
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder={t('projectNamePlaceholder')}
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
            {creating ? t('creating') : t('createProject')}
          </button>
        </div>
      </div>
  );
}

// ================================================================
// IFC 가져오기 모달 — 서버 사이드 변환 방식
// 브라우저 WASM 파싱 없이 파일을 서버로 업로드하면
// Python이 IFC → GLB 변환 후 DB/Minio 저장까지 완료
// ================================================================
function IfcImportModal({ onClose, onImport }) {
  const t = useT('bimProjectList');
  const [projectType, setProjectType] = useState("Building");
  const [projectName, setProjectName] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragging, setDragging]         = useState(false);
  const [phase, setPhase]               = useState("idle"); // idle | parsing | parsed | importing | done | error
  const [progress, setProgress]         = useState(0);
  const [parsedData, setParsedData]     = useState(null);
  const [errorMsg, setErrorMsg]         = useState("");
  const [userScale, setUserScale]       = useState(1);
  const fileInputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setErrorMsg(t('ifcOnly'));
      return;
    }
    setErrorMsg("");
    setSelectedFile(file);
    setParsedData(null);
    setPhase("idle");
    if (!projectName) setProjectName(file.name.replace(/\.ifc$/i, ""));
  }, [projectName, t]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const handleParse = useCallback(async () => {
    if (!selectedFile) return;
    setPhase("parsing");
    setProgress(0);
    setErrorMsg("");
    setParsedData(null);
    try {
      const result = await parseIfcFile(selectedFile, setProgress, 1);
      setParsedData(result);
      setPhase("parsed");
    } catch (err) {
      setErrorMsg(String(err?.message || err));
      setPhase("error");
    }
  }, [selectedFile]);

  const handleImport = useCallback(() => {
    if (!selectedFile || !projectName.trim()) return;
    setPhase("importing");
    setErrorMsg("");
    onImport(projectType, projectName.trim(), selectedFile, (project) => {
      if (project) {
        setPhase("done");
        onClose();
      } else {
        setErrorMsg(t('projectCreationFailed'));
        setPhase("error");
      }
    }, userScale);
  }, [selectedFile, projectName, projectType, onImport, onClose, t, userScale]);

  return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
           style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>

        <div className="relative w-full sm:max-w-lg h-screen sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-2xl shadow-2xl flex flex-col"
             style={{ backgroundColor: "#0f1e2d", border: "1px solid #253347" }}>

          {/* 헤더 */}
          <div className="flex items-center justify-between px-5 py-4 shrink-0 border-b border-[#1e3050]">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              {t('importIFC')}
            </h3>
            <button onClick={onClose}
                    className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto modal-scroll px-5 py-4 space-y-4"
               style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>

            {/* 파일 드롭존 */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{
                  position: "relative",
                  border: `2px dashed ${dragging ? "#0ea5e9" : selectedFile ? "#22c55e" : "#253347"}`,
                  backgroundColor: dragging ? "#0c2a3a" : "#0d1b2a",
                  borderRadius: 12, minHeight: 100, overflow: "hidden",
                }}
            >
              <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ifc"
                  onChange={e => handleFile(e.target.files[0])}
                  style={{
                    position: "absolute", inset: 0, width: "100%", height: "100%",
                    opacity: 0, cursor: "pointer", zIndex: 10, touchAction: "manipulation",
                  }}
              />
              <div className="flex flex-col items-center justify-center py-5 px-4 text-center"
                   style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
                {selectedFile ? (
                    <>
                      <span className="text-2xl mb-1">✅</span>
                      <p className="text-sm font-medium text-green-400 break-all">{selectedFile.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: TB.text2 }}>
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </>
                ) : (
                    <>
                      <span className="text-3xl mb-2">📂</span>
                      <p className="text-sm hidden sm:block" style={{ color: TB.text2 }}>
                        {t('dragOrClick')} <span className="text-blue-400 underline">{t('clickToSelect')}</span>
                      </p>
                      <p className="text-xs mt-1 text-gray-600">{t('ifcSupport')}</p>
                    </>
                )}
              </div>
            </div>

            {/* 프로젝트 유형 + 이름 */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="shrink-0">
                <label className="text-xs mb-1.5 block" style={{ color: TB.text2 }}>{t('type')}</label>
                <div className="flex gap-2">
                  {PROJECT_TYPES.map(({ type, icon, color, bg }) => (
                      <button
                          key={type}
                          onClick={() => setProjectType(type)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition"
                          style={{
                            backgroundColor: projectType === type ? bg : "#152030",
                            border: `1px solid ${projectType === type ? color : "#253347"}`,
                            color: projectType === type ? color : TB.text2,
                            minWidth: 95,
                          }}
                      >
                        {icon} {type}
                      </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs mb-1.5 block" style={{ color: TB.text2 }}>{t('projectNameLabel2')}</label>
                <input
                    type="text"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    placeholder={t('enterProjectName')}
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{
                      backgroundColor: "#152030", border: "1px solid #253347",
                      color: TB.text1, fontSize: 16,
                    }}
                />
              </div>
            </div>

            {/* Scale Factor */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium" style={{ color: TB.text2 }}>
                  Scale Factor
                </label>
                <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#1c2a3a", color: "#6b7280" }}>
                  서버가 단위(mm/cm) 자동 감지 — 기본값 ×1 권장
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.001"
                  max="100000"
                  step="any"
                  value={userScale}
                  onChange={e => { setUserScale(parseFloat(e.target.value) || 1); setParsedData(null); setPhase(p => p === "parsed" ? "idle" : p); }}
                  className="w-24 px-2 py-1.5 rounded-lg text-sm outline-none text-right"
                  style={{ backgroundColor: "#152030", border: "1px solid #253347", color: TB.text1 }}
                />
                <span className="text-xs" style={{ color: TB.text2 }}>× multiplier</span>
                <div className="flex gap-1 ml-auto">
                  {[1, 10, 100, 1000].map(v => (
                    <button
                      key={v}
                      onClick={() => { setUserScale(v); setParsedData(null); setPhase(p => p === "parsed" ? "idle" : p); }}
                      className="px-2 py-1 rounded text-xs font-medium transition"
                      style={{
                        backgroundColor: userScale === v ? "#0ea5e9" : "#152030",
                        border: `1px solid ${userScale === v ? "#0ea5e9" : "#253347"}`,
                        color: userScale === v ? "#fff" : TB.text2,
                      }}
                    >×{v}</button>
                  ))}
                </div>
              </div>
            </div>


            {/* 파싱 진행 */}
            {phase === "parsing" && (
                <div className="rounded-xl p-3 text-xs"
                     style={{ backgroundColor: "#0c1f2d", border: "1px solid #7c3aed40" }}>
                  <p className="font-semibold mb-2" style={{ color: "#a78bfa" }}>{t('analyzing')}</p>
                  <div className="w-full h-1.5 rounded-full bg-[#1c2a3a] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300"
                         style={{ width: `${progress}%`, background: "linear-gradient(90deg,#7c3aed,#a78bfa)" }}/>
                  </div>
                  <p className="mt-1 text-right" style={{ color: TB.text2 }}>{progress}%</p>
                </div>
            )}

            {/* 파싱 결과 — 요소 유형 요약 */}
            {phase === "parsed" && parsedData && (
                <div className="rounded-xl p-3 text-xs space-y-2"
                     style={{ backgroundColor: "#0c1f2d", border: "1px solid #22c55e40" }}>
                  <p className="font-semibold" style={{ color: "#4ade80" }}>
                    {t('totalDetected').replace('{count}', parsedData.elements.length)}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {Object.entries(
                        parsedData.elements.reduce((acc, el) => {
                          acc[el.elementType] = (acc[el.elementType] || 0) + 1;
                          return acc;
                        }, {})
                    ).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                        <span key={type} className="px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: "#93c5fd" }}>
                          {type.replace('Ifc', '')}: {count}
                        </span>
                    ))}
                  </div>
                  <p style={{ color: TB.text2 }}>
                    {parsedData.storeys?.length > 0 && `${parsedData.storeys.length}개 층 · `}
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    {parsedData.detectedScale && (
                      <span style={{ color: "#6b7280", marginLeft: 8 }}>
                        ({parsedData.detectedScale <= 0.002 ? 'mm' : parsedData.detectedScale <= 0.02 ? 'cm' : parsedData.detectedScale <= 0.2 ? 'dm' : 'm'} IFC)
                      </span>
                    )}
                  </p>
                </div>
            )}

            {/* 서버 변환 진행 안내 */}
            {phase === "importing" && (
                <div className="rounded-xl p-3 text-xs"
                     style={{ backgroundColor: "#0c1f2d", border: "1px solid #0ea5e940" }}>
                  <p className="text-blue-300 font-semibold mb-2">{t('serverConverting')}</p>
                  <p style={{ color: TB.text2 }}>{t('serverConvertingDesc')}</p>
                  <div className="mt-2 w-full h-1.5 rounded-full bg-[#1c2a3a] overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500 animate-pulse" style={{ width: "100%" }}/>
                  </div>
                </div>
            )}

            {/* 에러 메시지 */}
            {errorMsg && (
                <p className="text-xs px-3 py-2 rounded-lg"
                   style={{ backgroundColor: "#2a1010", color: TB.danger, border: `1px solid ${TB.danger}30` }}>
                  ⚠ {errorMsg}
                </p>
            )}
          </div>

          {/* 액션 버튼 바 */}
          <div className="flex gap-3 px-5 py-4 shrink-0 border-t border-[#1e3050] bg-[#0f1e2d]"
               style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <button
                onClick={onClose}
                disabled={phase === "parsing" || phase === "importing"}
                className="flex-1 py-3 rounded-xl text-sm font-medium transition"
                style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}
            >
              {t('cancel')}
            </button>

            {/* 1단계: 파일 분석 버튼 (idle / error 상태) */}
            {phase !== "parsed" && phase !== "importing" && (
                <button
                    onClick={handleParse}
                    disabled={!selectedFile || phase === "parsing"}
                    className="flex-[2] py-3 rounded-xl text-sm font-bold text-white transition"
                    style={{
                      background: selectedFile && phase !== "parsing"
                          ? "linear-gradient(135deg,#7c3aed,#5b21b6)" : "#1c2a3a",
                      border: `1px solid ${selectedFile ? "#8b5cf6" : "#253347"}`,
                      cursor: !selectedFile || phase === "parsing" ? "not-allowed" : "pointer",
                    }}
                >
                  {phase === "parsing" ? t('analyzing') : t('fileAnalysis')}
                </button>
            )}

            {/* 2단계: 가져오기 버튼 (parsed 상태) */}
            {phase === "parsed" && (
                <button
                    onClick={handleImport}
                    disabled={!projectName.trim()}
                    className="flex-[2] py-3 rounded-xl text-sm font-bold text-white transition"
                    style={{
                      background: projectName.trim()
                          ? "linear-gradient(135deg,#059669,#047857)" : "#1c2a3a",
                      border: `1px solid ${projectName.trim() ? "#10b981" : "#253347"}`,
                      cursor: !projectName.trim() ? "not-allowed" : "pointer",
                    }}
                >
                  {t('importProject').replace('{count}', parsedData?.elements?.length ?? 0)}
                </button>
            )}

            {/* 서버 변환 중 */}
            {phase === "importing" && (
                <button
                    disabled
                    className="flex-[2] py-3 rounded-xl text-sm font-bold text-white transition"
                    style={{ background: "#1c2a3a", border: "1px solid #253347", cursor: "not-allowed" }}
                >
                  {t('creating2')}
                </button>
            )}
          </div>
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
                                         onImportIFC,
                                         onConvertDrone,
                                         onDeleteProject,
                                       }) {
  const t = useT('bimProjectList');
  const [showCreate, setShowCreate]         = useState(false);
  const [showIFCImport, setShowIFCImport]   = useState(false);
  const [showDroneModal, setShowDroneModal] = useState(false);
  const [search, setSearch]                 = useState("");

  const invalidCount = (projectList ?? []).filter(p => isInvalidName(p.projectName)).length;

  const filtered = (projectList ?? []).filter(p =>
      p.projectName?.toLowerCase().includes(search.toLowerCase()) ||
      p.structureType?.toLowerCase().includes(search.toLowerCase()) ||
      (isInvalidName(p.projectName) && "이름없음이름 없음null?".includes(search.toLowerCase()))
  );

  return (
      <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                {t('pageTitle')}
              </h2>
              <p className="text-sm mt-0.5" style={{ color: TB.text2 }}>
                {t('project')} : <span className="text-white font-semibold">{projectList?.length ?? 0}</span>
                {invalidCount > 0 && (
                    <span
                        className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${TB.warning}20`,
                          color: TB.warning,
                          border: `1px solid ${TB.warning}50`,
                        }}
                    >
                  {t('noNameEA', { count: invalidCount })}
                </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                  placeholder={t('searchPlaceholder')}
                  className="pl-8 pr-3 py-2 rounded-lg text-sm outline-none w-44"
                  style={{
                    backgroundColor: "#1c2a3a",
                    border: "1px solid #253347",
                    color: TB.text1,
                  }}
              />
            </div>

            {/* 드론 사진 분석 버튼 */}
            <button
                onClick={() => setShowDroneModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition text-white whitespace-nowrap"
                style={{
                  backgroundColor: "#0d2a1a",
                  border: "1px solid #22c55e",
                }}
            >
              {t('droneAnalysis')}
            </button>

            {/* IFC 가져오기 버튼 */}
            {onImportIFC && (
                <button
                    onClick={() => setShowIFCImport(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition text-white whitespace-nowrap"
                    style={{
                      backgroundColor: "#0c2233",
                      border: "1px solid #0ea5e9",
                    }}
                >
                  {t('addIfc')}
                </button>
            )}

            {/* 신규 프로젝트 버튼 */}
            <button
                onClick={() => setShowCreate(v => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition text-white whitespace-nowrap"
                style={{
                  backgroundColor: showCreate ? "#2d1a4a" : "#1e1040",
                  border: "1px solid #8b5cf6",
                }}
            >
              {showCreate ? t('cancelNewProject') : t('newProject')}
            </button>
          </div>
        </div>

        {/* 드론 사진 분석 모달 */}
        {showDroneModal && (
            <DroneAnalysisModal
                onClose={() => setShowDroneModal(false)}
                onConvertToBIM={onConvertDrone}
                onProjectSelect={(project) => {
                  setShowDroneModal(false);
                  onProjectSelect(project);
                  setViceComponent('bim');
                }}
            />
        )}

        {/* IFC 가져오기 모달 */}
        {showIFCImport && (
            <IfcImportModal
                onClose={() => setShowIFCImport(false)}
                onImport={onImportIFC}
            />
        )}

        {/* 프로젝트 생성 폼 */}
        {showCreate && (
            <CreateProjectForm
                onClose={() => setShowCreate(false)}
                onCreate={onCreateProject}
            />
        )}

        {/* 이름 없는 프로젝트 알림 배너 */}
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
              <span dangerouslySetInnerHTML={{ __html: t('noNameWarning', { count: `<strong>${invalidCount}</strong>` }) }} />
            </div>
        )}

        {/* 프로젝트 유형 필터 칩 */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-xs" style={{ color: TB.text2 }}>{t('filter')}</span>
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
                {t('resetFilter')}
              </button>
          )}
        </div>

        {/* 프로젝트 카드 그리드 */}
        {filtered.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filtered.map((item, i) => (
                  <ProjectCard
                      key={item.projectId ?? i}
                      item={item}
                      onOpen={() => { onProjectSelect(item); setViceComponent("bim"); }}
                      onRename={onRenameProject}
                      onDelete={onDeleteProject}
                  />
              ))}
            </div>
        ) : (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="text-7xl mb-5">
                {search ? "🔍" : "🏗"}
              </div>
              <div className="text-lg font-semibold text-gray-400 mb-2">
                {search ? t('searchEmpty', { search }) : t('noProjects')}
              </div>
              <div className="text-sm" style={{ color: TB.text2 }}>
                {search
                    ? t('searchEmptyHint')
                    : <>
                      {t('noProjectsHint')} <br />
                      <span className="opacity-60">{t('bridgeOrBuilding')}</span>
                    </>
                }
              </div>
              {search && (
                  <button
                      onClick={() => setSearch("")}
                      className="mt-4 px-4 py-2 rounded-lg text-sm transition"
                      style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}
                  >
                    {t('resetFilterBtn')}
                  </button>
              )}
            </div>
        )}
      </div>
  );
}