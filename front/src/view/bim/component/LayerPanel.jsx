import React, { useState } from 'react';

// ================================================================
// 색상 도트 (클릭하면 네이티브 컬러 피커 열림)
// ================================================================
function ColorDot({ color, onChange, size = 16 }) {
    return (
        <label className="cursor-pointer flex-shrink-0 relative group" title="색상 변경">
            <input
                type="color"
                value={color}
                onChange={(e) => onChange(e.target.value)}
                className="sr-only"
            />
            <div
                className="rounded-full border-2 border-white/20 shadow group-hover:scale-110 transition-transform"
                style={{ width: size, height: size, backgroundColor: color }}
            />
        </label>
    );
}

// ================================================================
// 단일 레이어 행
// ================================================================
function LayerRow({
    layer, elements, isExpanded, onToggleExpand,
    onUpdate, onDelete,
    onRemoveElement, onSelectElement,
    elementColors,
}) {
    const [isEditingName, setIsEditingName] = useState(false);

    return (
        <div
            className="rounded-xl overflow-hidden"
            style={{ border: `1px solid ${layer.visible ? layer.color + '60' : '#253347'}` }}
        >
            {/* ── 레이어 헤더 ── */}
            <div
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ backgroundColor: layer.visible ? layer.color + '15' : '#1c2a3a' }}
            >
                {/* 색상 도트 */}
                <ColorDot
                    color={layer.color}
                    onChange={(c) => onUpdate(layer.layerId, { color: c })}
                />

                {/* 레이어 이름 */}
                {isEditingName ? (
                    <input
                        autoFocus
                        type="text"
                        value={layer.layerName}
                        onChange={(e) => onUpdate(layer.layerId, { layerName: e.target.value })}
                        onBlur={() => setIsEditingName(false)}
                        onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                        className="flex-1 bg-transparent text-xs text-white outline-none border-b border-white/30 min-w-0"
                    />
                ) : (
                    <span
                        className="flex-1 text-xs font-medium truncate cursor-text min-w-0"
                        style={{ color: layer.visible ? '#e2e8f0' : '#8896a4' }}
                        onDoubleClick={() => setIsEditingName(true)}
                        title="Double-click to edit name"
                    >
                        {layer.layerName}
                    </span>
                )}

                {/* 부재 수 뱃지 */}
                <span
                    className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{
                        backgroundColor: layer.color + '30',
                        color: layer.visible ? layer.color : '#8896a4',
                    }}
                >
                    {elements.length}
                </span>

                {/* 펼치기 */}
                <button
                    onClick={() => onToggleExpand(layer.layerId)}
                    className="text-gray-500 hover:text-gray-300 transition text-xs w-4"
                >
                    {isExpanded ? '▾' : '▸'}
                </button>

                {/* 가시성 토글 */}
                <button
                    onClick={() => onUpdate(layer.layerId, { visible: !layer.visible })}
                    className="transition leading-none flex items-center"
                    style={{ color: layer.visible ? '#fbbf24' : '#4b5563' }}
                    title={layer.visible ? 'Hide' : 'Show'}
                >
                    {layer.visible ? (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                            <path d="M9 21h6v-1H9v1zm0-2h6v-1H9v1zM12 2C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17h8v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinejoin="round" d="M9 21h6M9 19h6M12 3C8.69 3 6 5.69 6 9c0 2.22 1.21 4.15 3 5.19V17h6v-2.81C16.79 13.15 18 11.22 18 9c0-3.31-2.69-6-6-6z"/>
                        </svg>
                    )}
                </button>

                {/* 삭제 */}
                <button
                    onClick={() => {
                        if (window.confirm(`Delete layer "${layer.layerName}"?`)) {
                            onDelete(layer.layerId);
                        }
                    }}
                    className="text-gray-600 hover:text-red-400 transition text-xs leading-none"
                    title="Delete Layer"
                >
                    🗑
                </button>
            </div>

            {/* ── 부재 목록 (펼쳤을 때) ── */}
            {isExpanded && (
                <div className="bg-[#0f1d2d]">
                    {elements.length === 0 ? (
                        <p className="px-4 py-2.5 text-xs text-gray-600 italic">
                            No members in this layer
                        </p>
                    ) : (
                        elements.map((el) => (
                            <div
                                key={el.elementId}
                                className="flex items-center gap-2 px-4 py-1.5 border-t border-[#1e2d3d] hover:bg-[#1c2a3a] transition group cursor-pointer"
                                onClick={() => onSelectElement && onSelectElement(el)}
                            >
                                {/* 개별 색상 or 레이어 색상 */}
                                <div
                                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                    style={{ backgroundColor: elementColors[el.elementId] || layer.color }}
                                />
                                <span className="text-xs text-gray-400 flex-1 truncate">
                                    {el.elementType?.replace('Ifc', '')}
                                    <span className="ml-1 text-gray-600">{el.elementId?.slice(-8)}</span>
                                </span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemoveElement(layer.layerId, el.elementId);
                                    }}
                                    className="text-gray-700 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                                    title="Remove from layer"
                                >
                                    ✕
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// ================================================================
// 도면선 그룹 (선 전용 가상 레이어 — DB 레이어와 별도)
// ================================================================
function LinesGroup({ lines = [], visible, onToggleVisible, onClearLines, onDeleteLine, onSelectLine, selectedLineId }) {
    const [expanded, setExpanded] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    if (lines.length === 0) return null;

    // 표시할 최대 항목 수 (성능)
    const PREVIEW_LIMIT = 50;
    const shown = lines.slice(0, PREVIEW_LIMIT);

    return (
        <div
            className="rounded-xl overflow-hidden mb-2"
            style={{ border: `1px solid ${visible ? '#93c5fd60' : '#253347'}` }}
        >
            {/* 헤더 */}
            <div
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ backgroundColor: visible ? '#93c5fd12' : '#1c2a3a' }}
            >
                {/* 색상 닷 (고정 파란색) */}
                <div className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-white/20 shadow"
                     style={{ backgroundColor: '#60a5fa' }} />

                {/* 이름 */}
                <span className="flex-1 text-xs font-medium truncate"
                      style={{ color: visible ? '#e2e8f0' : '#8896a4' }}>
                    📐 도면선
                </span>

                {/* 선 수 뱃지 */}
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: '#60c5fa30', color: visible ? '#60a5fa' : '#8896a4' }}>
                    {lines.length}
                </span>

                {/* 펼치기 */}
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="text-gray-500 hover:text-gray-300 transition text-xs w-4"
                >
                    {expanded ? '▾' : '▸'}
                </button>

                {/* 가시성 토글 */}
                <button
                    onClick={onToggleVisible}
                    className="transition leading-none flex items-center"
                    style={{ color: visible ? '#fbbf24' : '#4b5563' }}
                    title={visible ? '선 숨기기' : '선 표시'}
                >
                    {visible ? (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                            <path d="M9 21h6v-1H9v1zm0-2h6v-1H9v1zM12 2C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17h8v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinejoin="round" d="M9 21h6M9 19h6M12 3C8.69 3 6 5.69 6 9c0 2.22 1.21 4.15 3 5.19V17h6v-2.81C16.79 13.15 18 11.22 18 9c0-3.31-2.69-6-6-6z"/>
                        </svg>
                    )}
                </button>

                {/* 전체 삭제 */}
                {!confirmDelete ? (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="text-gray-600 hover:text-red-400 transition text-xs leading-none"
                        title="전체 삭제"
                    >
                        🗑
                    </button>
                ) : (
                    <div className="flex items-center gap-1 ml-1">
                        <button
                            onClick={() => { onClearLines(); setConfirmDelete(false); }}
                            className="text-xs px-1.5 py-0.5 rounded font-semibold"
                            style={{ backgroundColor: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef4444' }}
                        >
                            확인
                        </button>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: '#1c2a3a', color: '#8896a4', border: '1px solid #253347' }}
                        >
                            취소
                        </button>
                    </div>
                )}
            </div>

            {/* 선 목록 (펼쳤을 때) */}
            {expanded && (
                <div className="bg-[#0f1d2d] max-h-60 overflow-y-auto">
                    {shown.map((line, idx) => {
                        const isSelected = line.lineId === selectedLineId;
                        return (
                            <div
                                key={line.lineId}
                                onClick={() => onSelectLine?.(line.lineId)}
                                className="flex items-center gap-2 px-4 py-1.5 border-t border-[#1e2d3d] hover:bg-[#1c2a3a] transition group cursor-pointer"
                                style={{ backgroundColor: isSelected ? '#0f2a4a' : undefined }}
                            >
                                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                     style={{ backgroundColor: line.color ?? '#60a5fa' }} />
                                <span className="text-xs text-gray-400 flex-1 truncate">
                                    Line {idx + 1}
                                </span>
                                <button
                                    onClick={e => { e.stopPropagation(); onDeleteLine?.(line.lineId); }}
                                    className="text-gray-700 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                                    title="삭제"
                                >
                                    ✕
                                </button>
                            </div>
                        );
                    })}
                    {lines.length > PREVIEW_LIMIT && (
                        <div className="px-4 py-2 text-xs text-gray-600 text-center border-t border-[#1e2d3d]">
                            … 외 {lines.length - PREVIEW_LIMIT}개 더 있음
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ================================================================
// 메인 LayerPanel
// ================================================================
export default function LayerPanel({
    layers,
    elementColors,
    modelData,
    selectedElement,
    selectedElements,
    onAddLayer,
    onDeleteLayer,
    onUpdateLayer,
    onAssignToLayer,
    onRemoveFromLayer,
    onSetElementColor,
    onClearElementColor,
    onSelectElement,
    // ── 도면선 그룹 ──────────────────────────
    lines = [],
    linesVisible = true,
    onToggleLinesVisible,
    onClearLines,
    onDeleteLine,
    onSelectLine,
    selectedLineId,
}) {
    const [expandedLayers, setExpandedLayers] = useState(new Set());

    const toggleExpand = (layerId) => {
        setExpandedLayers((prev) => {
            const next = new Set(prev);
            next.has(layerId) ? next.delete(layerId) : next.add(layerId);
            return next;
        });
    };

    const getElement = (id) => modelData.find((e) => e.elementId === id);

    const selectedId = selectedElement?.data?.elementId;

    // 다중 선택: selectedElements에 포함된 모든 ID (selectedElement 포함)
    const allSelectedIds = new Set([
        ...( selectedElements ?? []),
        ...(selectedId ? [selectedId] : []),
    ]);
    const isMulti = allSelectedIds.size > 1;

    return (
        <div className="h-full overflow-y-auto space-y-3 pr-0.5">

            {/* ── 헤더 ── */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Layer
                </span>
                <button
                    onClick={onAddLayer}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition text-white"
                    style={{ backgroundColor: '#1e3a5f', border: '1px solid #2a5080' }}
                    title="Add New Layer"
                >
                    + Layer
                </button>
            </div>

            {/* ── 도면선 가상 레이어 ── */}
            <LinesGroup
                lines={lines}
                visible={linesVisible}
                onToggleVisible={onToggleLinesVisible}
                onClearLines={onClearLines}
                onDeleteLine={onDeleteLine}
                onSelectLine={onSelectLine}
                selectedLineId={selectedLineId}
            />

            {/* ── 레이어 목록 ── */}
            {layers.length === 0 ? (
                <div className="rounded-xl p-5 text-center" style={{ border: '1px dashed #253347' }}>
                    <div className="text-3xl mb-2">🗂</div>
                    <p className="text-xs text-gray-500">No layers</p>
                    <p className="text-xs text-gray-600 mt-0.5">Use the + Layer button to create one</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {layers.map((layer) => {
                        const elements = layer.elementIds.map(getElement).filter(Boolean);
                        return (
                            <LayerRow
                                key={layer.layerId}
                                layer={layer}
                                elements={elements}
                                isExpanded={expandedLayers.has(layer.layerId)}
                                onToggleExpand={toggleExpand}
                                onUpdate={onUpdateLayer}
                                onDelete={onDeleteLayer}
                                onRemoveElement={onRemoveFromLayer}
                                onSelectElement={onSelectElement}
                                elementColors={elementColors}
                            />
                        );
                    })}
                </div>
            )}

            {/* ── 선택된 부재 섹션 ── */}
            {allSelectedIds.size > 0 && (
                <div
                    className="rounded-xl p-3 space-y-3"
                    style={{ backgroundColor: '#1c2a3a', border: '1px solid #253347' }}
                >
                    <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        {isMulti
                            ? `${allSelectedIds.size} selected`
                            : 'Selected Member'}
                    </p>

                    {/* 개별 색상 (단일 선택일 때만) */}
                    {selectedId && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2">Member Color</p>
                            <div className="flex items-center gap-2">
                                <ColorDot
                                    color={elementColors[selectedId] || '#888888'}
                                    onChange={(c) => onSetElementColor(selectedId, c)}
                                    size={22}
                                />
                                <span className="text-xs font-mono text-gray-400 flex-1">
                                    {elementColors[selectedId]
                                        ? elementColors[selectedId].toUpperCase()
                                        : 'Default Color'}
                                </span>
                                {elementColors[selectedId] && (
                                    <button
                                        onClick={() => onClearElementColor(selectedId)}
                                        className="text-xs text-gray-600 hover:text-gray-400 transition"
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 레이어 지정 */}
                    {layers.length > 0 && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2">
                                {isMulti ? 'Assign to Layer (bulk)' : 'Assign to Layer'}
                            </p>
                            <div className="space-y-1.5">
                                {layers.map((layer) => {
                                    // 단일: selectedId가 이 레이어에 포함되는지
                                    // 다중: 모든 선택 부재가 이 레이어에 포함되는지
                                    const isIn = isMulti
                                        ? [...allSelectedIds].every(id => layer.elementIds.includes(id))
                                        : layer.elementIds.includes(selectedId);

                                    const partiallyIn = isMulti
                                        ? !isIn && [...allSelectedIds].some(id => layer.elementIds.includes(id))
                                        : false;

                                    return (
                                        <button
                                            key={layer.layerId}
                                            onClick={() => {
                                                if (isIn) {
                                                    // 모두 제거
                                                    [...allSelectedIds].forEach(id =>
                                                        onRemoveFromLayer(layer.layerId, id)
                                                    );
                                                } else {
                                                    // 모두 추가
                                                    [...allSelectedIds].forEach(id =>
                                                        onAssignToLayer(layer.layerId, id)
                                                    );
                                                }
                                            }}
                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition"
                                            style={{
                                                backgroundColor: isIn
                                                    ? layer.color + '20'
                                                    : partiallyIn
                                                    ? layer.color + '10'
                                                    : '#152030',
                                                border: `1px solid ${isIn ? layer.color : partiallyIn ? layer.color + '80' : '#253347'}`,
                                                color: isIn ? layer.color : partiallyIn ? layer.color + 'cc' : '#8896a4',
                                            }}
                                        >
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
                                                style={{ backgroundColor: layer.color }}
                                            />
                                            <span className="flex-1 text-left truncate">{layer.layerName}</span>
                                            <span className="flex-shrink-0">
                                                {isIn
                                                    ? '✓ Included'
                                                    : partiallyIn
                                                    ? 'Partial'
                                                    : `+ Add`}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {layers.length === 0 && (
                        <p className="text-xs text-gray-600 text-center py-1">
                            Create a layer first
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
