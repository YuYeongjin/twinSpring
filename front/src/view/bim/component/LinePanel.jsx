import React, { useState } from 'react';

/**
 * LinePanel — 3D 선(Line) 작도 사이드 패널
 * 두 가지 모드:
 *   1. 클릭 작도: 3D 뷰어에서 첫 번째 / 두 번째 점을 클릭
 *   2. 좌표 입력: 6개 숫자 입력 (x1,y1,z1 → x2,y2,z2)
 */
export default function LinePanel({
    // 클릭 작도 상태
    lineDrawMode,     // 'off' | 'click' | 'coord'
    setLineDrawMode,
    lineStart,        // [x, y, z] | null — 첫 번째 클릭 지점
    lineDrawHeight,   // 클릭 평면 Y 높이
    setLineDrawHeight,
    onCancelDraw,     // 클릭 작도 취소

    // 색상 / 두께
    lineColor,
    setLineColor,
    lineWidth,
    setLineWidth,

    // 선 목록 + 조작
    lines,
    selectedLineId,
    setSelectedLineId,
    onAddLine,        // (start, end, color, lineWidth) => void
    onDeleteLine,     // (lineId) => void
    onClearLines,     // () => void
}) {
    // 좌표 입력 폼
    const [coordForm, setCoordForm] = useState({
        x1: 0, y1: 0, z1: 0,
        x2: 5, y2: 0, z2: 0,
    });

    const inputCls = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none";
    const tabActive = "text-xs px-3 py-1.5 rounded-md font-semibold transition bg-blue-600 text-white";
    const tabInactive = "text-xs px-3 py-1.5 rounded-md font-semibold transition bg-space-700/60 text-gray-400 hover:text-white";

    const isClickMode = lineDrawMode === 'click';
    const isCoordMode = lineDrawMode === 'coord';

    function handleModeToggle(mode) {
        if (lineDrawMode === mode) {
            // 이미 활성 탭을 다시 누르면 off
            setLineDrawMode('off');
            onCancelDraw?.();
        } else {
            setLineDrawMode(mode);
            if (mode !== 'click') onCancelDraw?.();
        }
    }

    function handleCoordAdd() {
        const start = [
            parseFloat(coordForm.x1) || 0,
            parseFloat(coordForm.y1) || 0,
            parseFloat(coordForm.z1) || 0,
        ];
        const end = [
            parseFloat(coordForm.x2) || 0,
            parseFloat(coordForm.y2) || 0,
            parseFloat(coordForm.z2) || 0,
        ];
        onAddLine(start, end, lineColor, lineWidth);
    }

    function updateCoord(field, value) {
        setCoordForm(prev => ({ ...prev, [field]: value }));
    }

    return (
        <div className="space-y-4 text-sm">

            {/* ── 모드 선택 탭 ── */}
            <div className="flex gap-1.5">
                <button
                    className={isClickMode ? tabActive : tabInactive}
                    onClick={() => handleModeToggle('click')}
                >
                    📍 클릭 작도
                </button>
                <button
                    className={isCoordMode ? tabActive : tabInactive}
                    onClick={() => handleModeToggle('coord')}
                >
                    🔢 좌표 입력
                </button>
            </div>

            {/* ── 선 스타일 (공통) ── */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-400 whitespace-nowrap">색상</label>
                    <input
                        type="color"
                        value={lineColor}
                        onChange={e => setLineColor(e.target.value)}
                        className="w-8 h-7 rounded cursor-pointer border border-space-600 bg-transparent p-0.5"
                    />
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                    <label className="text-xs text-gray-400 whitespace-nowrap">두께</label>
                    <input
                        type="number"
                        min="1" max="10" step="0.5"
                        value={lineWidth}
                        onChange={e => setLineWidth(parseFloat(e.target.value) || 2)}
                        className={inputCls}
                    />
                </div>
            </div>

            {/* ── 클릭 작도 패널 ── */}
            {isClickMode && (
                <div className="space-y-3 rounded-xl border border-blue-800/50 bg-blue-900/20 p-3">
                    <p className="text-xs text-blue-300 font-medium">3D 뷰어에서 두 점을 클릭하면 선이 그려집니다.</p>

                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-400 whitespace-nowrap">Y 높이</label>
                        <input
                            type="number"
                            step="0.1"
                            value={lineDrawHeight}
                            onChange={e => setLineDrawHeight(parseFloat(e.target.value) || 0)}
                            className={inputCls}
                        />
                        <span className="text-xs text-gray-500">m</span>
                    </div>

                    {!lineStart ? (
                        <div className="text-xs text-gray-400 italic">
                            ⏳ 첫 번째 점을 클릭하세요...
                        </div>
                    ) : (
                        <div className="text-xs space-y-1">
                            <div className="text-green-400 font-semibold">
                                ✓ 시작점: ({lineStart[0].toFixed(2)}, {lineStart[1].toFixed(2)}, {lineStart[2].toFixed(2)})
                            </div>
                            <div className="text-blue-300 italic">→ 두 번째 점을 클릭하세요...</div>
                            <button
                                onClick={onCancelDraw}
                                className="mt-1 text-xs px-2 py-1 rounded border border-red-800/60 text-red-400 hover:text-red-300 transition"
                            >
                                취소
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── 좌표 입력 패널 ── */}
            {isCoordMode && (
                <div className="space-y-3 rounded-xl border border-space-600 bg-space-800/40 p-3">
                    <div>
                        <p className="text-xs text-gray-400 font-medium mb-1.5">시작점 (P1)</p>
                        <div className="grid grid-cols-3 gap-1">
                            {[['x1','X'],['y1','Y'],['z1','Z']].map(([f, lbl]) => (
                                <div key={f}>
                                    <span className="text-xs text-gray-500">{lbl}</span>
                                    <input
                                        type="number" step="0.1"
                                        value={coordForm[f]}
                                        onChange={e => updateCoord(f, e.target.value)}
                                        className={inputCls}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400 font-medium mb-1.5">끝점 (P2)</p>
                        <div className="grid grid-cols-3 gap-1">
                            {[['x2','X'],['y2','Y'],['z2','Z']].map(([f, lbl]) => (
                                <div key={f}>
                                    <span className="text-xs text-gray-500">{lbl}</span>
                                    <input
                                        type="number" step="0.1"
                                        value={coordForm[f]}
                                        onChange={e => updateCoord(f, e.target.value)}
                                        className={inputCls}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                    <button
                        onClick={handleCoordAdd}
                        className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
                    >
                        + 선 추가
                    </button>
                </div>
            )}

            {/* ── 선 목록 ── */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">선 목록 ({lines.length}개)</span>
                    {lines.length > 0 && (
                        <button
                            onClick={onClearLines}
                            className="text-xs text-red-400 hover:text-red-300 transition"
                        >
                            전체 삭제
                        </button>
                    )}
                </div>

                {lines.length === 0 ? (
                    <p className="text-xs text-gray-600 italic text-center py-3">그려진 선이 없습니다.</p>
                ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                        {lines.map((line, idx) => {
                            const isSelected = line.lineId === selectedLineId;
                            return (
                                <div
                                    key={line.lineId}
                                    onClick={() => setSelectedLineId(isSelected ? null : line.lineId)}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition
                                        ${isSelected
                                            ? 'bg-cyan-900/40 border border-cyan-700/60'
                                            : 'bg-space-700/40 border border-space-600/40 hover:bg-space-700/70'}`}
                                >
                                    {/* 색상 점 */}
                                    <div
                                        className="w-3 h-3 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: line.color ?? '#60a5fa' }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-gray-300 truncate">
                                            선 {idx + 1}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            ({(line.start[0]).toFixed(1)},{(line.start[1]).toFixed(1)},{(line.start[2]).toFixed(1)})
                                            → ({(line.end[0]).toFixed(1)},{(line.end[1]).toFixed(1)},{(line.end[2]).toFixed(1)})
                                        </div>
                                    </div>
                                    <button
                                        onClick={e => { e.stopPropagation(); onDeleteLine(line.lineId); }}
                                        className="text-gray-600 hover:text-red-400 transition flex-shrink-0 text-xs"
                                        title="삭제"
                                    >
                                        ✕
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
