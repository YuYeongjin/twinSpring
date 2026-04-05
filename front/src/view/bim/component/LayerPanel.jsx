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
                        title="더블클릭으로 이름 수정"
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
                    className="transition text-base leading-none"
                    style={{ color: layer.visible ? '#e2e8f0' : '#4b5563' }}
                    title={layer.visible ? '숨기기' : '표시'}
                >
                    {layer.visible ? '👁' : '🙈'}
                </button>

                {/* 삭제 */}
                <button
                    onClick={() => {
                        if (window.confirm(`레이어 "${layer.layerName}"을(를) 삭제하시겠습니까?`)) {
                            onDelete(layer.layerId);
                        }
                    }}
                    className="text-gray-600 hover:text-red-400 transition text-xs leading-none"
                    title="레이어 삭제"
                >
                    🗑
                </button>
            </div>

            {/* ── 부재 목록 (펼쳤을 때) ── */}
            {isExpanded && (
                <div className="bg-[#0f1d2d]">
                    {elements.length === 0 ? (
                        <p className="px-4 py-2.5 text-xs text-gray-600 italic">
                            이 레이어에 부재가 없습니다
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
                                    title="레이어에서 제거"
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
                    레이어
                </span>
                <button
                    onClick={onAddLayer}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition text-white"
                    style={{ backgroundColor: '#1e3a5f', border: '1px solid #2a5080' }}
                    title="새 레이어 추가"
                >
                    + 레이어
                </button>
            </div>

            {/* ── 레이어 목록 ── */}
            {layers.length === 0 ? (
                <div className="rounded-xl p-5 text-center" style={{ border: '1px dashed #253347' }}>
                    <div className="text-3xl mb-2">🗂</div>
                    <p className="text-xs text-gray-500">레이어 없음</p>
                    <p className="text-xs text-gray-600 mt-0.5">+ 레이어 버튼으로 생성하세요</p>
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
                            ? `${allSelectedIds.size}개 선택됨`
                            : '선택된 부재'}
                    </p>

                    {/* 개별 색상 (단일 선택일 때만) */}
                    {selectedId && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2">부재 색상</p>
                            <div className="flex items-center gap-2">
                                <ColorDot
                                    color={elementColors[selectedId] || '#888888'}
                                    onChange={(c) => onSetElementColor(selectedId, c)}
                                    size={22}
                                />
                                <span className="text-xs font-mono text-gray-400 flex-1">
                                    {elementColors[selectedId]
                                        ? elementColors[selectedId].toUpperCase()
                                        : '기본 색상'}
                                </span>
                                {elementColors[selectedId] && (
                                    <button
                                        onClick={() => onClearElementColor(selectedId)}
                                        className="text-xs text-gray-600 hover:text-gray-400 transition"
                                    >
                                        초기화
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 레이어 지정 */}
                    {layers.length > 0 && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2">
                                {isMulti ? '일괄 레이어 지정' : '레이어 지정'}
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
                                                    ? '✓ 포함'
                                                    : partiallyIn
                                                    ? '일부 포함'
                                                    : `+ 추가`}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {layers.length === 0 && (
                        <p className="text-xs text-gray-600 text-center py-1">
                            레이어를 먼저 생성하세요
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
