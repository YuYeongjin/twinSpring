import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import * as THREE from 'three';
import Scene from './component/Scene';
import ControlPanel from './component/ControlPanel';
import LayerPanel from './component/LayerPanel';
import LinePanel from './component/LinePanel';
import BimDashboardAPI from './BimDashboardAPI';
import { ENV_PRESETS, DEFAULT_ENV_ID } from './component/SkyEnvironment';
import MiniMapCanvas from './component/MiniMapCanvas';
import AxiosCustom from '../../axios/AxiosCustom';

const API_BASE = '/api/bim';

// ================================================================
// 공통 UI
// ================================================================

function Card({ title, right, children, className = "" }) {
    return (
        <div className={`bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow ${className}`}>
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-wide text-gray-100">{title}</h2>
                {right}
            </div>
            {children}
        </div>
    );
}

function Chip({ color = "gray", children }) {
    const map = {
        green:  "bg-green-900/40 text-green-300 border-green-600/40",
        red:    "bg-red-900/40 text-red-300 border-red-600/40",
        blue:   "bg-blue-900/40 text-blue-300 border-blue-600/40",
        orange: "bg-orange-900/40 text-orange-300 border-orange-600/40",
        brown:  "bg-yellow-900/40 text-yellow-300 border-yellow-600/40",
        violet: "bg-violet-900/40 text-violet-300 border-violet-600/40",
        gray:   "bg-gray-800 text-gray-300 border-gray-700",
    };
    return <span className={`px-2 py-0.5 text-xs border rounded-md ${map[color] ?? map.gray}`}>{children}</span>;
}

// ================================================================
// 환경 선택 드롭다운
// ================================================================

function EnvSelector({ currentId, onChange }) {
    const [open, setOpen] = useState(false);
    const current = ENV_PRESETS.find(p => p.id === currentId) ?? ENV_PRESETS[0];

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold
                           bg-space-700/70 text-gray-300 border border-space-600 hover:bg-space-600 transition"
                title="배경 환경 선택"
            >
                <span>{current.icon}</span>
                <span className="hidden sm:inline">{current.label}</span>
                <span className="opacity-50">▾</span>
            </button>

            {open && (
                <>
                    {/* 오버레이 */}
                    <div
                        className="fixed inset-0 z-30"
                        onClick={() => setOpen(false)}
                    />
                    {/* 드롭다운 패널 */}
                    <div className="absolute right-0 top-full mt-1 z-40 bg-space-800 border border-space-600
                                    rounded-xl shadow-2xl p-2 min-w-[160px]">
                        <p className="text-xs text-gray-500 px-2 pb-1.5 font-medium">배경 환경</p>
                        {ENV_PRESETS.map(p => (
                            <button
                                key={p.id}
                                onClick={() => { onChange(p.id); setOpen(false); }}
                                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs
                                            transition-colors text-left
                                            ${p.id === currentId
                                                ? 'bg-blue-600/40 text-blue-200'
                                                : 'text-gray-300 hover:bg-space-700'}`}
                            >
                                <span className="text-sm">{p.icon}</span>
                                <span>{p.label}</span>
                                {p.id === currentId && <span className="ml-auto text-blue-400">✓</span>}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ================================================================
// (MiniMap은 MiniMapCanvas.jsx로 이동)
// ================================================================

// ================================================================
// 재료 데이터
// ================================================================

const MATERIAL_OPTIONS = {
    Concrete:  ['Concrete C20','Concrete C25','Concrete C30','Concrete C35','Concrete C40','Concrete C50','Prestressed Concrete','High-Strength Concrete C60'],
    Steel:     ['Steel Grade A','Steel Grade B','Steel SS400','Steel SHN275','Steel SHN355','Stainless Steel'],
    Timber:    ['Pine LVL','Oak','Glulam GL28h','CLT'],
    Composite: ['Steel-Concrete Composite','FRP','Carbon Fiber'],
};

// ================================================================
// LinePropertyPanel — 선 선택 시 표시되는 편집 패널
// ================================================================

function LinePropertyPanel({ line, onUpdate, onSave, onDelete, onClose }) {
    const [form, setForm] = React.useState(null);

    // 선택된 선이 바뀌면 폼 초기화
    React.useEffect(() => {
        if (!line) { setForm(null); return; }
        // points 파싱
        let pts;
        if (line.pointsJson) {
            try {
                pts = typeof line.pointsJson === 'string'
                    ? JSON.parse(line.pointsJson)
                    : line.pointsJson;
            } catch (_) { pts = [line.start, line.end]; }
        } else {
            pts = [line.start, line.end];
        }
        setForm({
            color:       line.color       ?? '#60a5fa',
            lineWidth:   line.lineWidth    ?? 2,
            closed:      !!line.closed,
            shapeHeight: line.shapeHeight  ?? 0,
            points:      pts.map(p => [...p]), // 깊은 복사
        });
    }, [line?.lineId]); // lineId 바뀔 때만

    if (!line || !form) return null;

    const inputCls = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none";

    const commit = (next) => {
        setForm(next);
        // 3D 뷰어 즉시 반영
        onUpdate(line.lineId, {
            color:       next.color,
            lineWidth:   next.lineWidth,
            closed:      next.closed,
            shapeHeight: next.shapeHeight,
            pointsJson:  JSON.stringify(next.points),
            start:       next.points[0],
            end:         next.points[next.points.length - 1],
        });
    };

    const updatePt = (idx, axis, val) => {
        const pts = form.points.map(p => [...p]);
        const ai  = { x: 0, y: 1, z: 2 }[axis];
        pts[idx][ai] = parseFloat(val) || 0;
        commit({ ...form, points: pts });
    };

    const addPoint = () => {
        const last = form.points[form.points.length - 1];
        commit({ ...form, points: [...form.points, [...last]] });
    };

    const removePoint = (idx) => {
        if (form.points.length <= 2) return;
        commit({ ...form, points: form.points.filter((_, i) => i !== idx) });
    };

    const isShape = form.closed && form.points.length >= 3;

    return (
        <div className="space-y-3 rounded-xl border border-cyan-800/50 bg-cyan-900/10 p-3 text-sm">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-300">선 편집</span>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>

            {/* 색상 / 두께 */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-400 whitespace-nowrap">색상</label>
                    <input
                        type="color"
                        value={form.color}
                        onChange={e => commit({ ...form, color: e.target.value })}
                        className="w-8 h-7 rounded cursor-pointer border border-space-600 bg-transparent p-0.5"
                    />
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                    <label className="text-xs text-gray-400 whitespace-nowrap">두께</label>
                    <input
                        type="number" min="1" max="20" step="0.5"
                        value={form.lineWidth}
                        onChange={e => commit({ ...form, lineWidth: parseFloat(e.target.value) || 2 })}
                        className={inputCls}
                    />
                </div>
            </div>

            {/* 꼭짓점 목록 */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-400">
                        꼭짓점 ({form.points.length}개)
                    </label>
                    <button
                        onClick={addPoint}
                        className="text-xs px-2 py-0.5 rounded bg-cyan-700/50 text-cyan-300 hover:bg-cyan-600/60 transition"
                    >
                        + 점 추가
                    </button>
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {form.points.map((pt, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                            <span className="text-xs text-gray-500 w-4 shrink-0">{idx === 0 ? 'P1' : idx === form.points.length - 1 ? `P${idx+1}` : `P${idx+1}`}</span>
                            {['x','y','z'].map(ax => (
                                <input
                                    key={ax}
                                    type="number" step="0.1"
                                    value={pt[{x:0,y:1,z:2}[ax]]}
                                    onChange={e => updatePt(idx, ax, e.target.value)}
                                    className="flex-1 min-w-0 rounded border border-space-600 bg-space-700/80 px-1 py-1 text-xs text-white focus:ring-1 focus:ring-cyan-500 outline-none"
                                    title={ax.toUpperCase()}
                                    placeholder={ax}
                                />
                            ))}
                            <button
                                onClick={() => removePoint(idx)}
                                disabled={form.points.length <= 2}
                                className="text-gray-600 hover:text-red-400 disabled:opacity-30 transition text-xs shrink-0 px-1"
                                title="점 삭제"
                            >✕</button>
                        </div>
                    ))}
                </div>
            </div>

            {/* 도형 옵션 (3개 이상 점) */}
            {form.points.length >= 3 && (
                <div className="space-y-2 pt-1 border-t border-space-600/40">
                    <p className="text-xs text-gray-400 font-medium">도형 옵션</p>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.closed}
                            onChange={e => commit({ ...form, closed: e.target.checked })}
                            className="accent-cyan-500"
                        />
                        <span className="text-xs text-gray-300">닫힌 다각형 (도형 닫기)</span>
                    </label>
                    {isShape && (
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-400 whitespace-nowrap">높이 (m)</label>
                            <input
                                type="number" min="0" step="0.1"
                                value={form.shapeHeight}
                                onChange={e => commit({ ...form, shapeHeight: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                                placeholder="0 = 평면"
                            />
                        </div>
                    )}
                    {isShape && (
                        <p className="text-xs text-cyan-400/80 italic">
                            {form.shapeHeight > 0
                                ? `3D 솔리드 도형 (높이 ${form.shapeHeight}m)`
                                : '닫힌 다각형 (평면)'}
                        </p>
                    )}
                </div>
            )}

            {/* 저장 / 삭제 버튼 */}
            <div className="flex gap-2 pt-1">
                <button
                    onClick={() => onSave({ ...line, ...form, pointsJson: JSON.stringify(form.points) })}
                    className="flex-1 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition"
                >
                    💾 저장
                </button>
                <button
                    onClick={() => onDelete(line.lineId)}
                    className="px-3 py-1.5 rounded-md bg-red-700/60 text-red-300 hover:bg-red-600/80 transition text-xs font-semibold"
                >
                    🗑
                </button>
            </div>
        </div>
    );
}

// ================================================================
// PropertyPanel
// ================================================================

function PropertyPanel({ selectedElement, selectedElements, updateElementData, saveUpdateElement, deleteSelectedElements }) {
    const [form, setForm] = useState({
        material: '', posX: 0, posY: 0, posZ: 0, sizeX: 1, sizeY: 1, sizeZ: 1,
    });

    useEffect(() => {
        if (!selectedElement?.data) return;
        const d = selectedElement.data;
        const n = (v, def = 0) => (v !== undefined && v !== null ? Number(v) : def);
        setForm({
            material: d.material || '',
            posX: n(d.positionX), posY: n(d.positionY), posZ: n(d.positionZ),
            sizeX: n(d.sizeX, 1),  sizeY: n(d.sizeY, 1),  sizeZ: n(d.sizeZ, 1),
        });
    }, [selectedElement]);

    // 다중 선택 시 다른 UI 표시
    const multiCount = selectedElements?.size ?? 0;
    if (!selectedElement && multiCount === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-4 text-center">
                <div className="text-3xl mb-2">🏗️</div>
                <p>3D 뷰어에서 부재를 클릭하여 속성을 편집하세요</p>
                <p className="text-xs mt-2 text-gray-600">Shift+클릭 또는 선택 모드로 다중 선택</p>
            </div>
        );
    }

    if (!selectedElement && multiCount > 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-3">
                <div className="text-2xl">⬚</div>
                <p className="text-sm text-gray-300">
                    <span className="text-violet-400 font-bold">{multiCount}개</span> 부재 선택됨
                </p>
                <button
                    onClick={deleteSelectedElements}
                    className="w-full px-3 py-2 rounded-md bg-red-700/60 text-red-300 hover:bg-red-600/80 transition text-xs font-semibold"
                >
                    🗑 선택 부재 모두 삭제
                </button>
            </div>
        );
    }

    const el = selectedElement.data;
    const typeColor = { IfcColumn:'brown', IfcBeam:'gray', IfcWall:'gray', IfcSlab:'blue', IfcPier:'orange' }[el.elementType] ?? 'gray';

    const handleChange = (field, value) => {
        const isNum = field !== 'material';
        const parsed = isNum ? (parseFloat(value) || 0) : value;
        const next = { ...form, [field]: parsed };
        setForm(next);
        updateElementData(el.elementId, {
            ...el,
            material:  next.material,
            positionX: next.posX, positionY: next.posY, positionZ: next.posZ,
            sizeX: next.sizeX,    sizeY: next.sizeY,    sizeZ: next.sizeZ,
        });
    };

    const inputCls = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none";

    return (
        <div className="space-y-4 overflow-y-auto">
            <div className="flex items-center gap-2">
                <Chip color={typeColor}>{el.elementType?.replace('Ifc', '') ?? '?'}</Chip>
                <span className="text-xs text-gray-500 truncate">ID: {el.elementId}</span>
                {multiCount > 1 && (
                    <Chip color="violet">+{multiCount - 1}</Chip>
                )}
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">재료 (Material)</label>
                <select value={form.material} onChange={e => handleChange('material', e.target.value)} className={inputCls}>
                    <option value="">-- 재료 선택 --</option>
                    {Object.entries(MATERIAL_OPTIONS).map(([group, items]) => (
                        <optgroup key={group} label={group}>
                            {items.map(m => <option key={m} value={m}>{m}</option>)}
                        </optgroup>
                    ))}
                </select>
                <input
                    type="text" placeholder="또는 직접 입력..."
                    value={form.material} onChange={e => handleChange('material', e.target.value)}
                    className={`${inputCls} mt-1 text-xs`}
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">치수 (m)</label>
                <div className="grid grid-cols-3 gap-1">
                    {[['sizeX','폭 (W)'],['sizeY','높이 (H)'],['sizeZ','깊이 (D)']].map(([f, lbl]) => (
                        <div key={f}>
                            <span className="text-xs text-gray-500">{lbl}</span>
                            <input type="number" step="0.01" min="0.01" value={form[f]}
                                   onChange={e => handleChange(f, e.target.value)} className={inputCls} />
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">위치 (m)</label>
                <div className="grid grid-cols-3 gap-1">
                    {[['posX','X'],['posY','Y'],['posZ','Z']].map(([f, lbl]) => (
                        <div key={f}>
                            <span className="text-xs text-gray-500">{lbl}</span>
                            <input type="number" step="0.1" value={form[f]}
                                   onChange={e => handleChange(f, e.target.value)} className={inputCls} />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex gap-2 pt-2">
                <button onClick={saveUpdateElement}
                        className="flex-1 rounded-md bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition">
                    💾 저장
                </button>
                <button onClick={deleteSelectedElements}
                        className="px-3 py-2 rounded-md bg-red-700/60 text-red-300 hover:bg-red-600/80 transition text-xs font-semibold">
                    🗑 삭제
                </button>
            </div>
        </div>
    );
}

// ================================================================
// 메인 BIM 대시보드
// ================================================================

export default function BimDashboard({ setViceComponent, modelData, setModelData, selectedProject }) {
    const {
        saveUpdateElement,
        selectedElement, setSelectedElement,
        mainCameraPosition, setMainCameraPosition,
        minimapContainerRef,
        minimapTrackElement,
        isLoading,
        handleElementSelect, updateElementData,
        transformMode, setTransformMode,

        // 다중 선택
        selectedElements, setSelectedElements,
        applyRubberBandSelection,
        toggleSelectMode, isSelectMode,

        // 배치 모드
        pendingElement, startPlacement, cancelPlacement, confirmPlacement,

        // 통합 삭제
        deleteSelectedElements,

        // 카메라 ref
        cameraRef,

        // 샘플 구조물
        placeSampleStructure,

        // 레이어
        layers, addLayer, deleteLayer, updateLayer, assignToLayer, removeFromLayer,

        // 부재 커스텀 색상
        elementColors, setElementColor, clearElementColor,

        // Undo
        undo, pushUndo,
    } = BimDashboardAPI({ setViceComponent, modelData, setModelData, selectedProject });

    const mainViewRef = useRef(null);

    // ── 패널 표시 여부 ─────────────────────────────────────────────
    const [showLayerPanel, setShowLayerPanel] = useState(true);
    const [showLeftPanel, setShowLeftPanel] = useState(true);
    // 좌측 패널 탭: 'edit' | 'line'
    const [leftTab, setLeftTab] = useState('edit');

    // ── 스냅 (꼭짓점 자동 흡착) ────────────────────────────────────
    const [snapEnabled, setSnapEnabled] = useState(true);

    // ── 패널 드래그 리사이즈 ───────────────────────────────────────
    const [leftPanelPct, setLeftPanelPct]   = useState(13); // 5~20%
    const [rightPanelPct, setRightPanelPct] = useState(18); // 5~20%
    const panelContainerRef = useRef(null);
    const draggingSideRef   = useRef(null); // 'left' | 'right' | null

    // 모바일 여부 (768px 기준)
    const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
    useEffect(() => {
        const handler = () => setIsDesktop(window.innerWidth >= 768);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    const handlePanelDragStart = useCallback((side, e) => {
        e.preventDefault();
        draggingSideRef.current = side;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (ev) => {
            if (!panelContainerRef.current || !draggingSideRef.current) return;
            const rect = panelContainerRef.current.getBoundingClientRect();
            const clientX = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
            const x = clientX - rect.left;
            const pct = (x / rect.width) * 100;

            if (draggingSideRef.current === 'left') {
                setLeftPanelPct(Math.min(20, Math.max(5, Math.round(pct * 10) / 10)));
            } else {
                // 우측: 컨테이너 오른쪽 끝에서의 비율
                const pctRight = ((rect.right - clientX) / rect.width) * 100;
                setRightPanelPct(Math.min(20, Math.max(5, Math.round(pctRight * 10) / 10)));
            }
        };

        const onUp = () => {
            draggingSideRef.current = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
    }, []);

    // ── 선 작도 상태 ───────────────────────────────────────────────
    const [lines, setLines] = useState([]);
    const [lineDrawMode, setLineDrawMode] = useState('off'); // 'off' | 'click' | 'coord'
    const [lineStart, setLineStart] = useState(null);
    const [lineDrawHeight, setLineDrawHeight] = useState(0);
    const [lineColor, setLineColor] = useState('#60a5fa');
    const [lineWidth, setLineWidth] = useState(2);
    const [selectedLineId, setSelectedLineId] = useState(null);

    // 프로젝트 전환 시 선 목록 DB 로드
    useEffect(() => {
        const pid = selectedProject?.projectId;
        if (!pid) return;
        AxiosCustom.get(`${API_BASE}/lines?projectId=${pid}`)
            .then(res => {
                // DB row → 프론트 형식 변환
                const loaded = (res.data || []).map(d => ({
                    lineId:      d.lineId,
                    start:       [d.startX, d.startY, d.startZ],
                    end:         [d.endX,   d.endY,   d.endZ],
                    color:       d.color,
                    lineWidth:   d.lineWidth,
                    pointsJson:  d.pointsJson  ?? null,
                    closed:      !!d.closed,
                    shapeHeight: d.shapeHeight ?? 0,
                }));
                setLines(loaded);
            })
            .catch(() => setLines([]));
    }, [selectedProject]);

    const addLine = useCallback((start, end, color, width) => {
        const pid = selectedProject?.projectId;
        const body = {
            projectId: pid,
            startX: start[0], startY: start[1], startZ: start[2],
            endX:   end[0],   endY:   end[1],   endZ:   end[2],
            color,
            lineWidth: width,
        };
        AxiosCustom.post(`${API_BASE}/line`, body)
            .then(res => {
                const d = res.data;
                setLines(prev => [...prev, {
                    lineId:      d.lineId,
                    start:       [d.startX, d.startY, d.startZ],
                    end:         [d.endX,   d.endY,   d.endZ],
                    color:       d.color,
                    lineWidth:   d.lineWidth,
                    pointsJson:  null,
                    closed:      false,
                    shapeHeight: 0,
                }]);
            })
            .catch(err => console.error('선 저장 실패:', err));
        setLineStart(null);
    }, [selectedProject]);

    const deleteLine = useCallback((lineId) => {
        AxiosCustom.delete(`${API_BASE}/line/${lineId}`)
            .catch(err => console.error('선 삭제 실패:', err));
        setLines(prev => prev.filter(l => l.lineId !== lineId));
        setSelectedLineId(prev => prev === lineId ? null : prev);
    }, []);

    const clearLines = useCallback(() => {
        const pid = selectedProject?.projectId;
        if (pid) {
            AxiosCustom.delete(`${API_BASE}/lines?projectId=${pid}`)
                .catch(err => console.error('선 전체 삭제 실패:', err));
        }
        setLines([]);
        setSelectedLineId(null);
        setLineStart(null);
        setLineDrawMode('off');
    }, [selectedProject]);

    const cancelLineDraw = useCallback(() => {
        setLineStart(null);
    }, []);

    /** 선 데이터 즉시 업데이트 (3D 뷰어 실시간 반영) */
    const updateLineData = useCallback((lineId, updates) => {
        setLines(prev => prev.map(l => l.lineId === lineId ? { ...l, ...updates } : l));
    }, []);

    /** 선 데이터 서버에 저장 (PUT) */
    const saveUpdateLine = useCallback((lineData) => {
        // points 배열 → pointsJson 직렬화
        const pointsArr = lineData.pointsJson
            ? (typeof lineData.pointsJson === 'string'
                ? JSON.parse(lineData.pointsJson)
                : lineData.pointsJson)
            : [lineData.start, lineData.end];

        const body = {
            lineId:      lineData.lineId,
            projectId:   selectedProject?.projectId,
            startX:      pointsArr[0][0],
            startY:      pointsArr[0][1],
            startZ:      pointsArr[0][2],
            endX:        pointsArr[pointsArr.length - 1][0],
            endY:        pointsArr[pointsArr.length - 1][1],
            endZ:        pointsArr[pointsArr.length - 1][2],
            color:       lineData.color,
            lineWidth:   lineData.lineWidth,
            pointsJson:  JSON.stringify(pointsArr),
            closed:      lineData.closed,
            shapeHeight: lineData.shapeHeight,
        };
        AxiosCustom.put(`${API_BASE}/line`, body)
            .catch(err => console.error('선 수정 실패:', err));
    }, [selectedProject]);

    const handleLineClick = useCallback((point) => {
        const pos = [
            parseFloat(point.x.toFixed(3)),
            lineDrawHeight,
            parseFloat(point.z.toFixed(3)),
        ];
        if (!lineStart) {
            setLineStart(pos);
        } else {
            addLine(lineStart, pos, lineColor, lineWidth);
        }
    }, [lineStart, lineDrawHeight, lineColor, lineWidth, addLine]);

    // ── 환경 프리셋 ─────────────────────────────────────────────────
    const [envId, setEnvId] = useState(DEFAULT_ENV_ID);
    const envPreset = useMemo(
        () => ENV_PRESETS.find(p => p.id === envId) ?? ENV_PRESETS[0],
        [envId]
    );

    // ── 미니맵 카메라 yaw 추적 ─────────────────────────────────────
    const [mainCameraYaw, setMainCameraYaw] = useState(0);

    // ── 미니맵 클릭 → 메인 카메라 네비게이션 ──────────────────────
    const navigationTargetRef = useRef(null);
    const handleMiniMapNavigate = useCallback((x, z) => {
        navigationTargetRef.current = { x, z };
    }, []);

    const currentProjectId = useMemo(
        () => selectedProject?.projectId ?? modelData?.[0]?.projectId ?? null,
        [selectedProject, modelData]
    );

    const [isPlacingSample, setIsPlacingSample] = React.useState(false);

    const handlePlaceSample = React.useCallback(async (elements) => {
        if (isPlacingSample) return;
        setIsPlacingSample(true);
        try {
            await placeSampleStructure(elements, currentProjectId);
        } finally {
            setIsPlacingSample(false);
        }
    }, [isPlacingSample, placeSampleStructure, currentProjectId]);

    // ── 선택된 부재 수 ─────────────────────────────────────────────
    const totalSelectedCount = useMemo(() => {
        const ids = new Set([
            ...selectedElements,
            ...(selectedElement ? [selectedElement.data.elementId] : []),
        ]);
        return ids.size;
    }, [selectedElements, selectedElement]);

    // ================================================================
    // 색상 해석: 커스텀색 > 레이어색 > 기본색
    // 레이어 visibility=false인 부재는 hidden=true
    // ================================================================
    const resolvedModelData = useMemo(() => {
        return modelData.map(el => {
            const layer = layers.find(l => l.elementIds.includes(el.elementId));
            const hidden = layer ? !layer.visible : false;
            const resolvedColor = elementColors[el.elementId] || layer?.color || null;
            return { ...el, resolvedColor, hidden };
        });
    }, [modelData, layers, elementColors]);

    // 렌더링에서는 숨겨진 부재 제외
    const visibleModelData = useMemo(
        () => resolvedModelData.filter(el => !el.hidden),
        [resolvedModelData]
    );

    // ================================================================
    // 러버밴드 선택 박스 (선택 모드에서만 활성)
    // ================================================================
    const [selBox, setSelBox] = useState(null); // { left, top, width, height } for CSS

    /** 러버밴드 박스 정보를 카메라 투영으로 부재 선택에 변환 */
    const computeRubberBandSelection = useCallback((startX, startY, endX, endY) => {
        if (!cameraRef.current || !mainViewRef.current) return;
        const camera  = cameraRef.current;
        const domRect = mainViewRef.current.getBoundingClientRect();

        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        const hit = modelData.filter(el => {
            const px = Number(el.positionX) || 0;
            const py = Number(el.positionY) || 0;
            const pz = Number(el.positionZ) || 0;
            const sy = Number(el.sizeY) || 1;
            // 중심점 (positionY는 밑면 기준이므로 + sy/2)
            const center = new THREE.Vector3(px, py + sy / 2, pz);
            center.project(camera);
            // NDC → 캔버스 픽셀 좌표
            const sx = (center.x + 1) / 2 * domRect.width;
            const sc = (1 - center.y) / 2 * domRect.height;
            return sx >= minX && sx <= maxX && sc >= minY && sc <= maxY;
        }).map(el => el.elementId);

        applyRubberBandSelection(hit);
    }, [cameraRef, mainViewRef, modelData, applyRubberBandSelection]);

    // 선택 모드일 때 mainViewRef에 마우스 이벤트 부착
    useEffect(() => {
        if (!isSelectMode) { setSelBox(null); return; }
        const el = mainViewRef.current;
        if (!el) return;

        let startX = 0, startY = 0, dragging = false;

        const onPointerDown = (e) => {
            if (e.button !== 0) return;
            const rect = el.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            dragging = false;
        };

        const onPointerMove = (e) => {
            if (!(e.buttons & 1)) return;
            const rect = el.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            if (Math.abs(cx - startX) > 5 || Math.abs(cy - startY) > 5) {
                dragging = true;
                setSelBox({
                    left:   Math.min(startX, cx),
                    top:    Math.min(startY, cy),
                    width:  Math.abs(cx - startX),
                    height: Math.abs(cy - startY),
                    endX: cx, endY: cy,
                });
            }
        };

        const onPointerUp = (e) => {
            if (dragging) {
                const rect = el.getBoundingClientRect();
                const ex = e.clientX - rect.left;
                const ey = e.clientY - rect.top;
                computeRubberBandSelection(startX, startY, ex, ey);
            }
            dragging = false;
            setSelBox(null);
        };

        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup',   onPointerUp);
        return () => {
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup',   onPointerUp);
        };
    }, [isSelectMode, computeRubberBandSelection]);

    // ================================================================
    // 키보드 단축키
    // ================================================================
    useEffect(() => {
        const onKeyDown = (e) => {
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
            if (e.key === 't' || e.key === 'T') setTransformMode('translate');
            if (e.key === 'r' || e.key === 'R') setTransformMode('rotate');
            if (e.key === 's' || e.key === 'S') setTransformMode('scale');
            if (e.key === 'q' || e.key === 'Q') toggleSelectMode();
            if ((e.key === 'Delete' || e.key === 'Backspace') && !pendingElement) deleteSelectedElements();
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                undo();
            }
            if (e.key === 'Escape') {
                if (lineDrawMode !== 'off') {
                    setLineDrawMode('off');
                    cancelLineDraw();
                } else if (pendingElement) { cancelPlacement(); }
                else if (isSelectMode) { toggleSelectMode(); }
                else { setSelectedElement(null); setSelectedElements(new Set()); }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedElement, pendingElement, isSelectMode, lineDrawMode, deleteSelectedElements,
        cancelPlacement, toggleSelectMode, setTransformMode, setSelectedElement, setSelectedElements, undo, cancelLineDraw]);

    return (
        <div className="w-full bg-space-900 pb-2">

            {/* ── 헤더 ── */}
            <div className="flex items-center gap-2 md:gap-4 mb-3 flex-wrap py-2">
                <button
                    className="text-gray-300 hover:text-white text-sm"
                    onClick={() => { setViceComponent('bim-projects'); setModelData([]); }}
                >
                    ← 목록
                </button>
                <h2 className="text-lg md:text-xl font-light text-white">BIM 편집기</h2>
                <Chip color="blue">Edit Mode</Chip>

                {/* 다중 선택 삭제 버튼 */}
                {totalSelectedCount > 1 && (
                    <button
                        onClick={deleteSelectedElements}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-red-700/60 text-red-300 hover:bg-red-600/80 transition"
                    >
                        🗑 {totalSelectedCount}개 삭제
                    </button>
                )}

                <div className="ml-auto flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
                    {/* 환경 선택 */}
                    <EnvSelector currentId={envId} onChange={setEnvId} />

                    {/* 좌측 패널 토글 */}
                    <button
                        onClick={() => setShowLeftPanel(v => !v)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            showLeftPanel
                                ? 'bg-blue-700/50 text-blue-300 border border-blue-600/60'
                                : 'bg-space-700/70 text-gray-400 border border-space-600'
                        }`}
                        title="편집 패널 접기/펴기"
                    >
                        {showLeftPanel ? '◀' : '▶'} <span className="hidden sm:inline">편집</span>
                    </button>

                    {/* 스냅 토글 */}
                    <button
                        onClick={() => setSnapEnabled(v => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            snapEnabled
                                ? 'bg-yellow-700/60 text-yellow-300 border border-yellow-600/60'
                                : 'bg-space-700/70 text-gray-400 border border-space-600'
                        }`}
                        title={snapEnabled ? '스냅 ON — 꼭짓점 자동 흡착 활성 (클릭하여 OFF)' : '스냅 OFF — 클릭하여 켜기'}
                    >
                        🧲 <span className="hidden sm:inline">{snapEnabled ? 'SNAP' : 'SNAP'}</span>
                        <span className={`text-xs ml-0.5 ${snapEnabled ? 'text-yellow-400' : 'text-gray-600'}`}>
                            {snapEnabled ? 'ON' : 'OFF'}
                        </span>
                    </button>

                    {/* 레이어 패널 토글 */}
                    <button
                        onClick={() => setShowLayerPanel(v => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            showLayerPanel
                                ? 'bg-teal-700/60 text-teal-300 border border-teal-600/60'
                                : 'bg-space-700/70 text-gray-400 border border-space-600'
                        }`}
                        title="레이어 패널 토글"
                    >
                        🗂 <span className="hidden sm:inline">레이어</span>
                        {layers.length > 0 && (
                            <span className="px-1 py-0.5 rounded-full text-xs bg-teal-600/40 text-teal-300">
                                {layers.length}
                            </span>
                        )}
                    </button>
                    <span className="text-xs text-gray-600 hidden xl:block">
                        T:이동&nbsp;R:회전&nbsp;S:크기&nbsp;Q:선택&nbsp;Del:삭제&nbsp;Ctrl+Z:취소
                    </span>
                </div>
            </div>

            {/* ── 배치 / 선택 모드 배너 ── */}
            {pendingElement && (
                <div className="mb-2 px-3 py-2 rounded-xl flex items-center gap-2 text-sm flex-wrap"
                     style={{ backgroundColor: '#1a2f4a', border: '1px solid #2a5080' }}>
                    <span className="text-blue-400">📍</span>
                    <span className="text-blue-200 font-medium text-xs">
                        배치 모드 — <span className="text-white">{pendingElement.elementType?.replace('Ifc','')}</span>
                    </span>
                    <span className="text-gray-400 text-xs hidden sm:inline">클릭하여 배치. 연속 배치 가능.</span>
                    <button onClick={cancelPlacement}
                            className="ml-auto text-xs px-2 py-1 rounded border border-blue-700/60 text-blue-400 hover:text-white transition">
                        ESC 취소
                    </button>
                </div>
            )}
            {isSelectMode && !pendingElement && (
                <div className="mb-2 px-3 py-2 rounded-xl flex items-center gap-2 text-sm flex-wrap"
                     style={{ backgroundColor: '#1f1040', border: '1px solid #5b21b6' }}>
                    <span className="text-violet-400">⬚</span>
                    <span className="text-violet-200 font-medium text-xs">선택 모드</span>
                    <span className="text-gray-400 text-xs hidden sm:inline">드래그로 영역 선택 • Shift+클릭 추가</span>
                    {totalSelectedCount > 0 && (
                        <span className="text-violet-300 text-xs font-semibold">{totalSelectedCount}개</span>
                    )}
                    <button onClick={toggleSelectMode}
                            className="ml-auto text-xs px-2 py-1 rounded border border-violet-700/60 text-violet-400 hover:text-white transition">
                        Q 해제
                    </button>
                </div>
            )}

            <div
                ref={panelContainerRef}
                className="flex flex-col md:flex-row md:h-[calc(100vh-7rem)]"
                style={{ gap: 0 }}
            >

                {/* ── 좌측 편집 패널 ── */}
                {showLeftPanel && (
                <div
                    className="w-full shrink-0 flex flex-col gap-3 md:h-full md:overflow-y-auto px-0 md:pr-1.5"
                    style={isDesktop ? { width: `${leftPanelPct}%`, minWidth: 120 } : undefined}
                >
                    {/* 탭 */}
                    <div className="flex gap-1 bg-space-800/80 border border-space-700 rounded-xl p-1">
                        <button
                            onClick={() => setLeftTab('edit')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${
                                leftTab === 'edit'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            편집
                        </button>
                        <button
                            onClick={() => setLeftTab('line')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${
                                leftTab === 'line'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            선 작도
                            {lines.length > 0 && (
                                <span className="ml-1 px-1 rounded-full bg-blue-800/60 text-blue-300 text-xs">{lines.length}</span>
                            )}
                        </button>
                    </div>

                    {leftTab === 'edit' && (
                        <>
                            <Card title="편집 도구">
                                <ControlPanel
                                    startPlacement={startPlacement}
                                    pendingElement={pendingElement}
                                    cancelPlacement={cancelPlacement}
                                    currentMode={transformMode}
                                    setMode={setTransformMode}
                                    isSelectMode={isSelectMode}
                                    toggleSelectMode={toggleSelectMode}
                                    onPlaceSample={handlePlaceSample}
                                    isPlacingSample={isPlacingSample}
                                />
                            </Card>
                            <Card
                                title="부재 속성"
                                right={
                                    <Chip color={selectedElement ? 'orange' : totalSelectedCount > 1 ? 'violet' : 'gray'}>
                                        {selectedElement ? 'SEL' : totalSelectedCount > 1 ? `${totalSelectedCount}개` : 'NONE'}
                                    </Chip>
                                }
                                className="flex-1"
                            >
                                <PropertyPanel
                                    selectedElement={selectedElement}
                                    selectedElements={selectedElements}
                                    updateElementData={updateElementData}
                                    saveUpdateElement={saveUpdateElement}
                                    deleteSelectedElements={deleteSelectedElements}
                                />
                            </Card>
                        </>
                    )}

                    {leftTab === 'line' && (
                        <Card title="선 작도" className="flex-1">
                            {/* 선 선택 시 편집 패널 */}
                            {selectedLineId && (
                                <div className="mb-3">
                                    <LinePropertyPanel
                                        line={lines.find(l => l.lineId === selectedLineId)}
                                        onUpdate={updateLineData}
                                        onSave={saveUpdateLine}
                                        onDelete={deleteLine}
                                        onClose={() => setSelectedLineId(null)}
                                    />
                                </div>
                            )}
                            <LinePanel
                                lineDrawMode={lineDrawMode}
                                setLineDrawMode={setLineDrawMode}
                                lineStart={lineStart}
                                lineDrawHeight={lineDrawHeight}
                                setLineDrawHeight={setLineDrawHeight}
                                onCancelDraw={cancelLineDraw}
                                lineColor={lineColor}
                                setLineColor={setLineColor}
                                lineWidth={lineWidth}
                                setLineWidth={setLineWidth}
                                lines={lines}
                                selectedLineId={selectedLineId}
                                setSelectedLineId={setSelectedLineId}
                                onAddLine={addLine}
                                onDeleteLine={deleteLine}
                                onClearLines={clearLines}
                            />
                        </Card>
                    )}
                </div>
                )}

                {/* ── 좌측 드래그 핸들 ── */}
                {showLeftPanel && isDesktop && (
                    <div
                        onMouseDown={(e) => handlePanelDragStart('left', e)}
                        onTouchStart={(e) => handlePanelDragStart('left', e)}
                        className="hidden md:flex items-center justify-center shrink-0 z-10 group relative"
                        style={{ width: 10, cursor: 'col-resize', touchAction: 'none' }}
                        title={`드래그하여 너비 조절 (현재 ${leftPanelPct.toFixed(0)}%)`}
                    >
                        <div
                            className="h-16 rounded-full transition-all duration-150 group-hover:h-24 group-hover:w-1"
                            style={{ width: 3, backgroundColor: '#334155', transition: 'background-color 0.15s, height 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#334155'}
                        />
                    </div>
                )}

                {/* ── 중앙 3D 뷰어 ── */}
                <div className="flex-1 min-w-0 flex flex-col gap-3 md:h-full" style={{ paddingLeft: showLeftPanel && isDesktop ? 4 : 0, paddingRight: showLayerPanel && isDesktop ? 4 : 0 }}>
                    <Card
                        title={`3D BIM Viewer — ${currentProjectId ?? '프로젝트'} (부재 ${visibleModelData.length}개)`}
                        right={
                            <div className="flex gap-1.5 items-center flex-wrap">
                                <Chip color="orange">
                                    {transformMode === 'translate' ? '이동' : transformMode === 'rotate' ? '회전' : '크기'}
                                </Chip>
                                {pendingElement && <Chip color="blue">배치중</Chip>}
                                {isSelectMode   && <Chip color="violet">선택모드</Chip>}
                                {lineDrawMode !== 'off' && <Chip color="blue">선 작도</Chip>}
                                <Chip color="blue">Live</Chip>
                            </div>
                        }
                        className="flex-1 flex flex-col"
                    >
                        {isLoading ? (
                            <div className="flex flex-1 items-center justify-center text-gray-400">
                                <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            </div>
                        ) : (
                            <div
                                className="w-full flex-1 relative"
                                style={{
                                    minHeight: '55vw',
                                    cursor: pendingElement ? 'crosshair'
                                          : isSelectMode  ? 'crosshair'
                                          : lineDrawMode === 'click' ? 'crosshair'
                                          : 'default',
                                }}
                            >

                                {/* R3F 이벤트 소스 div */}
                                <div ref={mainViewRef} className="absolute inset-0 z-10 touch-none" />

                                <Canvas
                                    eventSource={mainViewRef}
                                    className="!absolute inset-0 rounded-xl pointer-events-none z-0"
                                    camera={{ position: [15, 12, 15], fov: 55 }}
                                    shadows
                                    onPointerMissed={() => {
                                        if (!isSelectMode) {
                                            setSelectedElement(null);
                                            setSelectedElements(new Set());
                                            // 선 작도 중이 아닐 때 선 선택 해제
                                            if (lineDrawMode === 'off') setSelectedLineId(null);
                                        }
                                    }}
                                >
                                    <View track={mainViewRef}>
                                        <Scene
                                            modelData={visibleModelData}
                                            onElementSelect={handleElementSelect}
                                            selectedElement={selectedElement}
                                            selectedElements={selectedElements}
                                            updateElementData={updateElementData}
                                            setMainCameraPosition={setMainCameraPosition}
                                            setMainCameraYaw={setMainCameraYaw}
                                            transformMode={transformMode}
                                            pendingElement={pendingElement}
                                            onPlacementConfirm={(pos) => confirmPlacement(pos, currentProjectId)}
                                            isSelectMode={isSelectMode}
                                            cameraRef={cameraRef}
                                            envPreset={envPreset}
                                            navigationTargetRef={navigationTargetRef}
                                            pushUndo={pushUndo}
                                            lines={lines}
                                            selectedLineId={selectedLineId}
                                            onLineSelect={(id) => {
                                                setSelectedLineId(id);
                                                if (id) setLeftTab('line');
                                            }}
                                            lineDrawMode={lineDrawMode}
                                            lineDrawHeight={lineDrawHeight}
                                            lineStart={lineStart}
                                            lineColor={lineColor}
                                            lineWidth={lineWidth}
                                            onLineClick={handleLineClick}
                                            snapEnabled={snapEnabled}
                                        />
                                    </View>

                                </Canvas>

                                {/* 미니맵 앵커 + MiniMapCanvas (별도 Canvas, portal) */}
                                <div
                                    ref={minimapContainerRef}
                                    className="absolute top-3 right-3 w-40 h-40 border border-space-500 rounded-xl overflow-hidden shadow-2xl z-20 pointer-events-auto"
                                    style={{ cursor: 'crosshair' }}
                                    title="미니맵 — 클릭하면 해당 위치로 이동"
                                />
                                {minimapTrackElement && (
                                    <MiniMapCanvas
                                        modelData={visibleModelData}
                                        mainCameraPosition={mainCameraPosition}
                                        mainCameraYaw={mainCameraYaw}
                                        containerElement={minimapTrackElement}
                                        envId={envId}
                                        onNavigate={handleMiniMapNavigate}
                                    />
                                )}

                                {/* ── 러버밴드 선택 박스 ── */}
                                {isSelectMode && selBox && selBox.width > 5 && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            pointerEvents: 'none',
                                            left:   selBox.left,
                                            top:    selBox.top,
                                            width:  selBox.width,
                                            height: selBox.height,
                                            border: '1.5px solid #a78bfa',
                                            backgroundColor: 'rgba(139, 92, 246, 0.1)',
                                            zIndex: 25,
                                            borderRadius: 2,
                                        }}
                                    />
                                )}

                                {/* ── 선택 부재 정보 오버레이 ── */}
                                {selectedElement && (
                                    <div className="absolute bottom-3 left-3 bg-space-900/80 border border-space-700 rounded-lg px-3 py-2 text-xs text-gray-300 z-20">
                                        <span className="text-orange-400 font-bold">{selectedElement.data.elementType}</span>
                                        <span className="ml-2 text-gray-500">{selectedElement.data.elementId}</span>
                                        <span className="ml-3 text-gray-400">{selectedElement.data.material || '재료 미설정'}</span>
                                        {totalSelectedCount > 1 && (
                                            <span className="ml-3 text-violet-400 font-semibold">+{totalSelectedCount - 1}개 선택됨</span>
                                        )}
                                    </div>
                                )}

                                {/* ── 선택된 선 정보 오버레이 ── */}
                                {selectedLineId && !selectedElement && (() => {
                                    const sl = lines.find(l => l.lineId === selectedLineId);
                                    if (!sl) return null;
                                    const pts = sl.pointsJson
                                        ? (typeof sl.pointsJson === 'string' ? JSON.parse(sl.pointsJson) : sl.pointsJson)
                                        : [sl.start, sl.end];
                                    return (
                                        <div className="absolute bottom-3 left-3 bg-space-900/80 border border-cyan-700/60 rounded-lg px-3 py-2 text-xs text-gray-300 z-20">
                                            <span className="text-cyan-400 font-bold">선</span>
                                            <span className="ml-2 text-gray-400">{pts.length}개 꼭짓점</span>
                                            {sl.closed && <span className="ml-2 text-cyan-300">닫힘</span>}
                                            {sl.shapeHeight > 0 && <span className="ml-2 text-teal-300">높이 {sl.shapeHeight}m</span>}
                                            <span className="ml-3 text-gray-500">좌측 패널에서 편집</span>
                                        </div>
                                    );
                                })()}

                                {/* ── 배치 모드 커서 힌트 ── */}
                                {pendingElement && (
                                    <div className="absolute bottom-3 right-3 bg-space-900/80 border border-blue-700/60 rounded-lg px-3 py-2 text-xs text-blue-300 z-20 mr-44">
                                        클릭하여 배치 &nbsp;|&nbsp; <kbd className="bg-black/30 px-1 rounded">ESC</kbd> 취소
                                    </div>
                                )}

                                {/* ── 선 작도 클릭 힌트 ── */}
                                {lineDrawMode === 'click' && (
                                    <div className="absolute bottom-3 left-3 bg-space-900/80 border border-blue-700/60 rounded-lg px-3 py-2 text-xs text-blue-300 z-20">
                                        {!lineStart
                                            ? '⏳ 첫 번째 점을 클릭하세요'
                                            : '✓ 시작점 선택됨 — 두 번째 점을 클릭하세요'}
                                        {snapEnabled && <span className="ml-2 text-yellow-400">🧲 스냅 ON</span>}
                                        &nbsp;|&nbsp; <kbd className="bg-black/30 px-1 rounded">ESC</kbd> 취소
                                    </div>
                                )}

                                {/* ── 배치 모드 스냅 힌트 ── */}
                                {pendingElement && snapEnabled && (
                                    <div className="absolute bottom-14 right-3 bg-space-900/70 border border-yellow-700/40 rounded-lg px-2 py-1 text-xs text-yellow-400 z-20 mr-44">
                                        🧲 스냅 ON
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                </div>

                {/* ── 우측 드래그 핸들 ── */}
                {showLayerPanel && isDesktop && (
                    <div
                        onMouseDown={(e) => handlePanelDragStart('right', e)}
                        onTouchStart={(e) => handlePanelDragStart('right', e)}
                        className="hidden md:flex items-center justify-center shrink-0 z-10 group"
                        style={{ width: 10, cursor: 'col-resize', touchAction: 'none' }}
                        title={`드래그하여 너비 조절 (현재 ${rightPanelPct.toFixed(0)}%)`}
                    >
                        <div
                            className="h-16 rounded-full"
                            style={{ width: 3, backgroundColor: '#334155', transition: 'background-color 0.15s, height 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#14b8a6'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#334155'}
                        />
                    </div>
                )}

                {/* ── 우측 레이어 패널 ── */}
                {showLayerPanel && (
                    <div
                        className="w-full shrink-0 flex flex-col md:h-full md:overflow-y-auto md:pl-1.5"
                        style={isDesktop ? { width: `${rightPanelPct}%`, minWidth: 120 } : undefined}
                    >
                        <Card
                            title="레이어 관리"
                            right={
                                <div className="flex items-center gap-2">
                                    <Chip color="green">{layers.length}개</Chip>
                                    <button
                                        onClick={() => setShowLayerPanel(false)}
                                        className="text-gray-500 hover:text-gray-300 transition text-sm leading-none"
                                        title="패널 닫기"
                                    >
                                        ✕
                                    </button>
                                </div>
                            }
                            className="flex flex-col overflow-hidden"
                            style={{ minHeight: 0, flex: '1 1 0' }}
                        >
                            <div className="flex-1 overflow-y-auto" style={{ minHeight: 80 }}>
                                <LayerPanel
                                    layers={layers}
                                    elementColors={elementColors}
                                    modelData={modelData}
                                    selectedElement={selectedElement}
                                    selectedElements={selectedElements}
                                    onAddLayer={addLayer}
                                    onDeleteLayer={deleteLayer}
                                    onUpdateLayer={updateLayer}
                                    onAssignToLayer={assignToLayer}
                                    onRemoveFromLayer={removeFromLayer}
                                    onSetElementColor={setElementColor}
                                    onClearElementColor={clearElementColor}
                                    onSelectElement={(el) => handleElementSelect(el, null)}
                                />
                            </div>
                        </Card>

                        {/* 구조 데이터 분석 */}
                        <Card title="구조 데이터 분석" right={<Chip color="green">Live</Chip>} className="mt-3 shrink-0">
                            <div className="grid grid-cols-5 gap-1.5">
                                {['IfcColumn','IfcBeam','IfcWall','IfcSlab','IfcPier'].map(type => {
                                    const count = modelData.filter(e => e.elementType === type).length;
                                    return (
                                        <div key={type} className="bg-space-700/60 rounded-lg p-2 flex flex-col items-center gap-0.5">
                                            <span className="text-xs text-gray-400 truncate w-full text-center">{type.replace('Ifc','')}</span>
                                            <span className="text-lg font-bold text-gray-100">{count}</span>
                                            <span className="text-xs text-gray-500">개</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    </div>
                )}

            </div>
        </div>
    );
}
