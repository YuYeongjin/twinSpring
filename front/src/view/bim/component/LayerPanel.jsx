import React, { useState, useMemo } from 'react';

// IFC 자동 생성 시 들어오는 더미 building 이름 — 레이어 트리에서 투명 처리
const DUMMY_ROOT_NAMES = new Set([
    '// building/name //', 'building name', 'building/name', 'building', 'default',
    'unnamed', 'no building', 'building_0', 'building_1', 'building_2', 'none', '(none)',
]);
function isDummyRoot(layer) {
    return (
        !layer.parentLayerId &&
        (!layer.elementIds || layer.elementIds.length === 0) &&
        DUMMY_ROOT_NAMES.has((layer.layerName || '').trim().toLowerCase())
    );
}

// ── Tree helpers ──────────────────────────────────────────────────────
function buildLayerTree(layers) {
    // 더미 루트 레이어(building name 등) ID 수집 → 트리에서 제거, 자식은 루트로 승격
    const dummyIds = new Set(layers.filter(isDummyRoot).map(l => l.layerId));

    const map = {};
    for (const l of layers) {
        if (dummyIds.has(l.layerId)) continue;
        map[l.layerId] = { ...l, children: [] };
    }
    const roots = [];
    for (const l of layers) {
        if (dummyIds.has(l.layerId)) continue;
        // 부모가 더미 레이어면 루트로 승격
        const parentId = dummyIds.has(l.parentLayerId) ? null : l.parentLayerId;
        if (parentId && map[parentId]) {
            map[parentId].children.push(map[l.layerId]);
        } else {
            roots.push(map[l.layerId]);
        }
    }
    const sort = n => {
        n.children.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        n.children.forEach(sort);
    };
    roots.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    roots.forEach(sort);
    return roots;
}

function collectDescendantIds(node) {
    const ids = [node.layerId];
    for (const c of node.children) ids.push(...collectDescendantIds(c));
    return ids;
}

function countElements(node) {
    if (node.children.length === 0) return (node.elementIds ?? []).length;
    return node.children.reduce((s, c) => s + countElements(c), 0);
}

function getAllLeafElementIds(node) {
    if (node.children.length === 0) return node.elementIds ?? [];
    return node.children.flatMap(getAllLeafElementIds);
}

// ── ColorDot ──────────────────────────────────────────────────────────
function ColorDot({ color, onChange, size = 16 }) {
    return (
        <label className="cursor-pointer flex-shrink-0 relative group" title="색상 변경">
            <input type="color" value={color} onChange={e => onChange(e.target.value)} className="sr-only" />
            <div
                className="rounded-full border-2 border-white/20 shadow group-hover:scale-110 transition-transform"
                style={{ width: size, height: size, backgroundColor: color }}
            />
        </label>
    );
}

function EyeIcon({ visible }) {
    return visible ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
            <path d="M9 21h6v-1H9v1zm0-2h6v-1H9v1zM12 2C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17h8v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
        </svg>
    ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinejoin="round" d="M9 21h6M9 19h6M12 3C8.69 3 6 5.69 6 9c0 2.22 1.21 4.15 3 5.19V17h6v-2.81C16.79 13.15 18 11.22 18 9c0-3.31-2.69-6-6-6z"/>
        </svg>
    );
}

// ── TreeNodeRow ──────────────────────────────────────────────────────
// depth 0 = 동(Building), depth 1 = 층(Storey), depth 2 = 공종(Type/Leaf)
const DEPTH_BG     = ['#1e3a5f', '#152e45', undefined];
const DEPTH_BORDER = ['#2a508090', '#1e406090', undefined];

function TreeNodeRow({
    node, depth, modelData, expandedSet, onToggleExpand,
    onUpdate, onDelete, onRemoveElement, onSelectElement, onSelectAllInLayer,
    elementColors,
}) {
    const [editingName, setEditingName] = useState(false);
    const isLeaf     = node.children.length === 0;
    const isExpanded = expandedSet.has(node.layerId);
    const elemCount  = useMemo(() => countElements(node), [node]);
    const indent     = depth * 14;

    const bgColor   = node.visible
        ? (depth < 2 ? DEPTH_BG[depth]     : node.color + '18')
        : '#1c2a3a';
    const borderCol = node.visible
        ? (depth < 2 ? DEPTH_BORDER[depth] : node.color + '60')
        : '#253347';

    const leafElements = isLeaf && isExpanded
        ? (node.elementIds ?? []).map(id => modelData?.find(e => e.elementId === id)).filter(Boolean)
        : [];

    function handleToggleVisible() {
        const next = !node.visible;
        collectDescendantIds(node).forEach(id => onUpdate(id, { visible: next }));
    }

    return (
        <div>
            {/* ── Row header ── */}
            <div
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg mb-0.5"
                style={{ backgroundColor: bgColor, border: `1px solid ${borderCol}`, marginLeft: indent }}
            >
                {/* 펼치기/접기 */}
                <button
                    className="w-4 text-xs flex-shrink-0 transition"
                    style={{ color: isExpanded ? '#94a3b8' : '#475569' }}
                    onClick={() => onToggleExpand(node.layerId)}
                >
                    {isExpanded ? '▾' : '▸'}
                </button>

                {/* 색상 표시 */}
                {isLeaf
                    ? <ColorDot color={node.color} onChange={c => onUpdate(node.layerId, { color: c })} />
                    : <div
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0 opacity-70"
                        style={{ backgroundColor: depth === 0 ? '#94a3b8' : '#64748b' }}
                      />
                }

                {/* 이름 */}
                {editingName ? (
                    <input
                        autoFocus
                        type="text"
                        value={node.layerName}
                        onChange={e => onUpdate(node.layerId, { layerName: e.target.value })}
                        onBlur={() => setEditingName(false)}
                        onKeyDown={e => e.key === 'Enter' && setEditingName(false)}
                        className="flex-1 bg-transparent text-xs text-white outline-none border-b border-white/30 min-w-0"
                    />
                ) : (
                    <span
                        className={`flex-1 text-xs truncate min-w-0 cursor-default
                            ${depth === 0 ? 'font-bold' : depth === 1 ? 'font-semibold' : 'font-medium'}`}
                        style={{ color: node.visible ? (depth === 0 ? '#cbd5e1' : depth === 1 ? '#94a3b8' : '#e2e8f0') : '#8896a4' }}
                        onDoubleClick={() => setEditingName(true)}
                        title="더블클릭: 이름 편집"
                    >
                        {node.layerName}
                    </span>
                )}

                {/* 부재 수 뱃지 */}
                {elemCount > 0 && (
                    <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 cursor-pointer hover:brightness-125 transition"
                        style={{
                            backgroundColor: depth < 2 ? '#47556940' : node.color + '30',
                            color: node.visible ? (depth < 2 ? '#94a3b8' : node.color) : '#8896a4',
                        }}
                        title="클릭: 전체 선택"
                        onClick={() => onSelectAllInLayer?.(getAllLeafElementIds(node))}
                    >
                        {elemCount}
                    </span>
                )}

                {/* 가시성 토글 — 하위 전체 연동 */}
                <button
                    className="transition leading-none flex items-center flex-shrink-0"
                    style={{ color: node.visible ? '#fbbf24' : '#4b5563' }}
                    title={node.visible ? 'Hide (하위 포함)' : 'Show (하위 포함)'}
                    onClick={handleToggleVisible}
                >
                    <EyeIcon visible={node.visible} />
                </button>

                {/* 삭제 */}
                <button
                    className="text-gray-600 hover:text-red-400 transition text-xs leading-none flex-shrink-0"
                    title="Delete"
                    onClick={() => {
                        const childCount = elemCount;
                        const msg = childCount > 0
                            ? `"${node.layerName}" 레이어를 삭제하시겠습니까? (부재 ${childCount}개 포함)`
                            : `"${node.layerName}" 레이어를 삭제하시겠습니까?`;
                        if (window.confirm(msg)) onDelete(node.layerId);
                    }}
                >🗑</button>
            </div>

            {/* ── 펼쳤을 때 내용 ── */}
            {isExpanded && (
                <div>
                    {/* 하위 트리 노드 (비리프) */}
                    {node.children.map(child => (
                        <TreeNodeRow
                            key={child.layerId}
                            node={child}
                            depth={depth + 1}
                            modelData={modelData}
                            expandedSet={expandedSet}
                            onToggleExpand={onToggleExpand}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                            onRemoveElement={onRemoveElement}
                            onSelectElement={onSelectElement}
                            onSelectAllInLayer={onSelectAllInLayer}
                            elementColors={elementColors}
                        />
                    ))}

                    {/* 리프: 부재 목록 */}
                    {isLeaf && (
                        <div
                            className="rounded-b-lg mb-1 overflow-hidden"
                            style={{
                                marginLeft: indent + 14,
                                backgroundColor: '#0f1d2d',
                                border: '1px solid #1e2d3d',
                                borderTop: 'none',
                            }}
                        >
                            {leafElements.length === 0 ? (
                                <p className="px-4 py-2 text-xs text-gray-600 italic">No members</p>
                            ) : (
                                leafElements.map(el => (
                                    <div
                                        key={el.elementId}
                                        className="flex items-center gap-2 px-3 py-1.5 border-t border-[#1e2d3d] hover:bg-[#1c2a3a] transition group cursor-pointer"
                                        onClick={e => onSelectElement?.(el, null, e.shiftKey)}
                                        title="클릭: 선택 / Shift+클릭: 다중 선택"
                                    >
                                        <div
                                            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                            style={{ backgroundColor: elementColors?.[el.elementId] || node.color }}
                                        />
                                        <span className="text-xs text-gray-400 flex-1 truncate">
                                            {el.elementType?.replace('Ifc', '')}
                                            <span className="ml-1 text-gray-600">{el.elementId?.slice(-8)}</span>
                                        </span>
                                        <button
                                            className="text-gray-700 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                                            title="Remove from layer"
                                            onClick={e => { e.stopPropagation(); onRemoveElement(node.layerId, el.elementId); }}
                                        >✕</button>
                                    </div>
                                ))
                            )}
                        </div>
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

    const PREVIEW_LIMIT = 50;
    const shown = lines.slice(0, PREVIEW_LIMIT);

    return (
        <div
            className="rounded-xl overflow-hidden mb-2"
            style={{ border: `1px solid ${visible ? '#93c5fd60' : '#253347'}` }}
        >
            <div
                className="flex items-center gap-2 px-3 py-2.5"
                style={{ backgroundColor: visible ? '#93c5fd12' : '#1c2a3a' }}
            >
                <div className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-white/20 shadow"
                     style={{ backgroundColor: '#60a5fa' }} />
                <span className="flex-1 text-xs font-medium truncate"
                      style={{ color: visible ? '#e2e8f0' : '#8896a4' }}>
                    📐 도면선
                </span>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: '#60c5fa30', color: visible ? '#60a5fa' : '#8896a4' }}>
                    {lines.length}
                </span>
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="text-gray-500 hover:text-gray-300 transition text-xs w-4"
                >
                    {expanded ? '▾' : '▸'}
                </button>
                <button
                    onClick={onToggleVisible}
                    className="transition leading-none flex items-center"
                    style={{ color: visible ? '#fbbf24' : '#4b5563' }}
                    title={visible ? '선 숨기기' : '선 표시'}
                >
                    <EyeIcon visible={visible} />
                </button>
                {!confirmDelete ? (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="text-gray-600 hover:text-red-400 transition text-xs leading-none"
                        title="전체 삭제"
                    >🗑</button>
                ) : (
                    <div className="flex items-center gap-1 ml-1">
                        <button
                            onClick={() => { onClearLines(); setConfirmDelete(false); }}
                            className="text-xs px-1.5 py-0.5 rounded font-semibold"
                            style={{ backgroundColor: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef4444' }}
                        >확인</button>
                        <button
                            onClick={() => setConfirmDelete(false)}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: '#1c2a3a', color: '#8896a4', border: '1px solid #253347' }}
                        >취소</button>
                    </div>
                )}
            </div>

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
                                <span className="text-xs text-gray-400 flex-1 truncate">Line {idx + 1}</span>
                                <button
                                    onClick={e => { e.stopPropagation(); onDeleteLine?.(line.lineId); }}
                                    className="text-gray-700 hover:text-red-400 transition text-xs opacity-0 group-hover:opacity-100"
                                    title="삭제"
                                >✕</button>
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
    onSelectAllInLayer,
    lines = [],
    linesVisible = true,
    onToggleLinesVisible,
    onClearLines,
    onDeleteLine,
    onSelectLine,
    selectedLineId,
    onRegenerateLayers,
    isRegeneratingLayers = false,
}) {
    const [expandedSet, setExpandedSet] = useState(new Set());

    const toggleExpand = id => setExpandedSet(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    // 트리 빌드
    const treeRoots = useMemo(() => buildLayerTree(layers), [layers]);

    // 리프 레이어만 = 부재 할당 대상
    const leafLayers = useMemo(() => {
        const parentIds = new Set(layers.map(l => l.parentLayerId).filter(Boolean));
        return layers.filter(l => !parentIds.has(l.layerId));
    }, [layers]);

    const selectedId = selectedElement?.data?.elementId;
    const allSelectedIds = new Set([
        ...(selectedElements ?? []),
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

            {/* ── 레이어 트리 ── */}
            {layers.length === 0 ? (
                <div className="rounded-xl p-5 text-center" style={{ border: '1px dashed #253347' }}>
                    <div className="text-3xl mb-2">🗂</div>
                    <p className="text-xs text-gray-500">No layers</p>
                    <p className="text-xs text-gray-600 mt-0.5">Use the + Layer button to create one</p>
                    {onRegenerateLayers && modelData?.some(e => e.storey || e.globalId || e.building) && (
                        <button
                            onClick={onRegenerateLayers}
                            disabled={isRegeneratingLayers}
                            className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition"
                            style={{
                                backgroundColor: isRegeneratingLayers ? '#0f1d2d' : '#1e3a5f',
                                border: `1px solid ${isRegeneratingLayers ? '#253347' : '#2a5080'}`,
                                color: isRegeneratingLayers ? '#475569' : '#93c5fd',
                                cursor: isRegeneratingLayers ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {isRegeneratingLayers ? (
                                <>
                                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                                    Layer 재생성 중...
                                </>
                            ) : (
                                <>↺ IFC Layer 재생성</>
                            )}
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-1">
                    {treeRoots.map(root => (
                        <TreeNodeRow
                            key={root.layerId}
                            node={root}
                            depth={0}
                            modelData={modelData}
                            expandedSet={expandedSet}
                            onToggleExpand={toggleExpand}
                            onUpdate={onUpdateLayer}
                            onDelete={onDeleteLayer}
                            onRemoveElement={onRemoveFromLayer}
                            onSelectElement={onSelectElement}
                            onSelectAllInLayer={onSelectAllInLayer}
                            elementColors={elementColors}
                        />
                    ))}
                </div>
            )}

            {/* ── 선택된 부재 섹션 ── */}
            {allSelectedIds.size > 0 && (
                <div
                    className="rounded-xl p-3 space-y-3"
                    style={{ backgroundColor: '#1c2a3a', border: '1px solid #253347' }}
                >
                    <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        {isMulti ? `${allSelectedIds.size} selected` : 'Selected Member'}
                    </p>

                    {/* 개별 색상 (단일 선택) */}
                    {selectedId && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2">Member Color</p>
                            <div className="flex items-center gap-2">
                                <ColorDot
                                    color={elementColors[selectedId] || '#888888'}
                                    onChange={c => onSetElementColor(selectedId, c)}
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
                                    >Reset</button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 레이어 할당 — 리프 레이어만 표시 */}
                    {leafLayers.length > 0 && (
                        <div>
                            <p className="text-xs text-gray-500 mb-2">
                                {isMulti ? 'Assign to Layer (bulk)' : 'Assign to Layer'}
                            </p>
                            <div className="space-y-1.5">
                                {leafLayers.map(layer => {
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
                                                    [...allSelectedIds].forEach(id => onRemoveFromLayer(layer.layerId, id));
                                                } else {
                                                    [...allSelectedIds].forEach(id => onAssignToLayer(layer.layerId, id));
                                                }
                                            }}
                                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition"
                                            style={{
                                                backgroundColor: isIn ? layer.color + '20' : partiallyIn ? layer.color + '10' : '#152030',
                                                border: `1px solid ${isIn ? layer.color : partiallyIn ? layer.color + '80' : '#253347'}`,
                                                color: isIn ? layer.color : partiallyIn ? layer.color + 'cc' : '#8896a4',
                                            }}
                                        >
                                            <div className="w-3 h-3 rounded-full flex-shrink-0"
                                                 style={{ backgroundColor: layer.color }} />
                                            <span className="flex-1 text-left truncate">{layer.layerName}</span>
                                            <span className="flex-shrink-0">
                                                {isIn ? '✓ Included' : partiallyIn ? 'Partial' : '+ Add'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {leafLayers.length === 0 && (
                        <p className="text-xs text-gray-600 text-center py-1">Create a layer first</p>
                    )}
                </div>
            )}
        </div>
    );
}
