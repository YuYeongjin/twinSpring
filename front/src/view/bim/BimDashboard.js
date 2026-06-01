import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import Scene from './component/Scene';
// Plan2DView는 OrthographicCamera 방식으로 대체됨
import ControlPanel from './component/ControlPanel';
import LayerPanel from './component/LayerPanel';

import BimDashboardAPI from './BimDashboardAPI';
import { ENV_PRESETS, DEFAULT_ENV_ID } from './component/SkyEnvironment';
import MiniMapCanvas from './component/MiniMapCanvas';
import AxiosCustom from '../../axios/AxiosCustom';
import { exportQuantityToExcel, exportToPDF } from '../../utils/exportUtils';
import StructuralDashboard from '../structural/StructuralDashboard';
import DroneAnalysisModal from './component/DroneAnalysisModal';
import { useT } from '../../i18n/LanguageContext';

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
        green: "bg-green-900/40 text-green-300 border-green-600/40",
        red: "bg-red-900/40 text-red-300 border-red-600/40",
        blue: "bg-blue-900/40 text-blue-300 border-blue-600/40",
        orange: "bg-orange-900/40 text-orange-300 border-orange-600/40",
        brown: "bg-yellow-900/40 text-yellow-300 border-yellow-600/40",
        violet: "bg-violet-900/40 text-violet-300 border-violet-600/40",
        gray: "bg-gray-800 text-gray-300 border-gray-700",
    };
    return <span className={`px-2 py-0.5 text-xs border rounded-md ${map[color] ?? map.gray}`}>{children}</span>;
}

// ================================================================
// 환경 선택 드롭다운
// ================================================================

function EnvSelector({ currentId, onChange }) {
    const t = useT('bimDashboard');
    const [open, setOpen] = useState(false);
    const current = ENV_PRESETS.find(p => p.id === currentId) ?? ENV_PRESETS[0];

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold
                           bg-space-700/70 text-gray-300 border border-space-600 hover:bg-space-600 transition"
                title={t('selectBgEnv')}
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
                        <p className="text-xs text-gray-500 px-2 pb-1.5 font-medium">{t('environment')}</p>
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
    Concrete: ['Concrete C20', 'Concrete C25', 'Concrete C30', 'Concrete C35', 'Concrete C40', 'Concrete C50', 'Prestressed Concrete', 'High-Strength Concrete C60'],
    Steel: ['Steel Grade A', 'Steel Grade B', 'Steel SS400', 'Steel SHN275', 'Steel SHN355', 'Stainless Steel'],
    Timber: ['Pine LVL', 'Oak', 'Glulam GL28h', 'CLT'],
    Composite: ['Steel-Concrete Composite', 'FRP', 'Carbon Fiber'],
};

// ================================================================
// LinePropertyPanel — 선 선택 시 표시되는 편집 패널
// ================================================================

function LinePropertyPanel({ line, onUpdate, onSave, onDelete, onClose }) {
    const t = useT('bimDashboard');
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
            color: line.color ?? '#60a5fa',
            lineWidth: line.lineWidth ?? 2,
            closed: !!line.closed,
            shapeHeight: line.shapeHeight ?? 0,
            points: pts.map(p => [...p]), // 깊은 복사
        });
    }, [line?.lineId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!line || !form) return null;

    const inputCls = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none";

    const commit = (next) => {
        setForm(next);
        // 3D 뷰어 즉시 반영
        onUpdate(line.lineId, {
            color: next.color,
            lineWidth: next.lineWidth,
            closed: next.closed,
            shapeHeight: next.shapeHeight,
            pointsJson: JSON.stringify(next.points),
            start: next.points[0],
            end: next.points[next.points.length - 1],
        });
    };

    const updatePt = (idx, axis, val) => {
        const pts = form.points.map(p => [...p]);
        const ai = { x: 0, y: 1, z: 2 }[axis];
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
                <span className="text-xs font-semibold text-cyan-300">{t('editLine')}</span>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>

            {/* 색상 / 두께 */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                    <label className="text-xs text-gray-400 whitespace-nowrap">{t('color')}</label>
                    <input
                        type="color"
                        value={form.color}
                        onChange={e => commit({ ...form, color: e.target.value })}
                        className="w-8 h-7 rounded cursor-pointer border border-space-600 bg-transparent p-0.5"
                    />
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                    <label className="text-xs text-gray-400 whitespace-nowrap">{t('thickness')}</label>
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
                        {t('vertices_count', { n: form.points.length })}
                    </label>
                    <button
                        onClick={addPoint}
                        className="text-xs px-2 py-0.5 rounded bg-cyan-700/50 text-cyan-300 hover:bg-cyan-600/60 transition"
                    >
                        {t('addPoint')}
                    </button>
                </div>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {form.points.map((pt, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                            <span className="text-xs text-gray-500 w-4 shrink-0">{idx === 0 ? 'P1' : idx === form.points.length - 1 ? `P${idx + 1}` : `P${idx + 1}`}</span>
                            {['x', 'y', 'z'].map(ax => (
                                <input
                                    key={ax}
                                    type="number" step="0.1"
                                    value={pt[{ x: 0, y: 1, z: 2 }[ax]]}
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
                                title={t('deletePoint')}
                            >✕</button>
                        </div>
                    ))}
                </div>
            </div>

            {/* 도형 옵션 (3개 이상 점) */}
            {form.points.length >= 3 && (
                <div className="space-y-2 pt-1 border-t border-space-600/40">
                    <p className="text-xs text-gray-400 font-medium">{t('shapeOptions')}</p>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={form.closed}
                            onChange={e => commit({ ...form, closed: e.target.checked })}
                            className="accent-cyan-500"
                        />
                        <span className="text-xs text-gray-300">{t('closedPolygon')}</span>
                    </label>
                    {isShape && (
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-400 whitespace-nowrap">{t('height')}</label>
                            <input
                                type="number" min="0" step="0.1"
                                value={form.shapeHeight}
                                onChange={e => commit({ ...form, shapeHeight: parseFloat(e.target.value) || 0 })}
                                className={inputCls}
                                placeholder={t('flatPlaceholder')}
                            />
                        </div>
                    )}
                    {isShape && (
                        <p className="text-xs text-cyan-400/80 italic">
                            {form.shapeHeight > 0
                                ? t('solidShape', { n: form.shapeHeight })
                                : t('closedFlat')}
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
                    {t('save')}
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
// CoordCommandBar — X→Y→Z 순차 좌표 입력 + 마우스 실시간 매핑
// ================================================================

function CoordCommandBar({
    label, accentColor,
    hoverPosRef,
    mode,                    // 'place' | 'line'
    lockZ = false,           // 2D 모드: Z축(높이) 0으로 고정, 입력 불가 (x→y만 입력)
    lineStart, lineChainStart,
    lineColor, setLineColor, lineWidth, setLineWidth,
    onConfirm,               // ({ x, y, z }) => void  — data 좌표
    onAxisLocked,            // (axis, value|null) => void
    onCloseChain,
    onFinish,
}) {
    const initLocked = () => ({ x: null, y: null, z: lockZ ? 0 : null });
    const [phase, setPhase]       = React.useState('x');
    const [lockedVals, setLocked] = React.useState(initLocked);
    const [inputVal, setInputVal] = React.useState('');
    const [livePos, setLivePos]   = React.useState({ x: 0, y: 0, z: 0 });
    const inputRef = React.useRef();

    // RAF 루프로 hoverPosRef → 표시 state 동기화
    React.useEffect(() => {
        let id;
        function tick() {
            if (hoverPosRef?.current) {
                const p = hoverPosRef.current;
                setLivePos(prev =>
                    Math.abs(prev.x - p.x) > 0.005 || Math.abs(prev.z - p.z) > 0.005
                        ? { x: p.x, y: p.y, z: p.z } : prev
                );
            }
            id = requestAnimationFrame(tick);
        }
        id = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(id);
    }, [hoverPosRef]);

    // label/lockZ 변경 시 초기화
    React.useEffect(() => {
        setPhase('x');
        setLocked(initLocked());
        setInputVal('');
        if (lockZ) onAxisLocked?.('z', 0);
        const t = setTimeout(() => inputRef.current?.focus(), 60);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [label, lockZ]);

    function advance() {
        const raw = inputVal.trim();
        const num = raw !== '' ? parseFloat(raw) : livePos[phase];
        if (isNaN(num)) return;

        const newLocked = { ...lockedVals, [phase]: num };
        onAxisLocked?.(phase, num);

        // lockZ=true 면 z(높이) 단계를 건너뜀: x → y
        const nextPhase = phase === 'x' ? 'y' : phase === 'y' ? (lockZ ? null : 'z') : null;

        if (nextPhase === null) {
            onConfirm({
                x: newLocked.x ?? livePos.x,
                y: lockZ ? (newLocked.y ?? livePos.y) : (newLocked.y ?? livePos.y),
                z: lockZ ? 0 : num,
            });
            setPhase('x');
            setLocked(initLocked());
            setInputVal('');
            onAxisLocked?.('__reset__', null);
        } else {
            setLocked(newLocked);
            setPhase(nextPhase);
            setInputVal('');
        }
        setTimeout(() => inputRef.current?.focus(), 30);
    }

    function handleKeyDown(e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); advance(); }
        if (e.key === 'Tab')   { e.preventDefault(); advance(); }
        if (e.key === 'Escape') {
            e.preventDefault();
            const orderedAxes = lockZ ? ['x', 'y'] : ['x', 'y', 'z'];
            const idx = orderedAxes.indexOf(phase);
            if (idx > 0) {
                // 이전 축 고정 해제 (한 단계 되돌리기)
                const prevAxis = orderedAxes[idx - 1];
                setLocked(prev => ({ ...prev, [prevAxis]: null }));
                onAxisLocked?.(prevAxis, null);
                setPhase(prevAxis);
                setInputVal('');
                setTimeout(() => inputRef.current?.focus(), 30);
            } else {
                onFinish();
            }
        }
    }

    const axes = ['x', 'y', 'z'];
    const borderCls = accentColor === 'orange' ? 'border-orange-600/60' : 'border-blue-600/60';
    const labelCls  = accentColor === 'orange' ? 'text-orange-400'      : 'text-blue-400';
    const focusCls  = accentColor === 'orange' ? 'focus:ring-orange-500' : 'focus:ring-blue-500';

    const canClose = mode === 'line' && lineChainStart && lineStart &&
        JSON.stringify(lineStart) !== JSON.stringify(lineChainStart);

    return (
        <div
            className={`fixed bottom-6 left-1/2 z-50 pointer-events-auto flex items-center gap-2 bg-space-900/95 border ${borderCls} rounded-xl px-3 py-2 shadow-xl backdrop-blur-sm text-xs`}
            style={{ transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
        >
            <span className={`${labelCls} font-bold tracking-wider min-w-[3rem]`}>{label}</span>

            {/* X Y Z 필드 */}
            <div className="flex items-center gap-0.5">
                {axes.map((axis, i) => {
                    const isZFixed  = lockZ && axis === 'z';
                    const isLocked  = isZFixed || lockedVals[axis] !== null;
                    const isActive  = !isZFixed && phase === axis;
                    const dispVal   = isZFixed ? '0.00'
                        : isLocked ? lockedVals[axis].toFixed(2)
                        : (livePos[axis]?.toFixed(2) ?? '0.00');
                    return (
                        <React.Fragment key={axis}>
                            <div className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 border ${
                                isZFixed  ? 'bg-space-800/60 border-space-600/40 opacity-50' :
                                isLocked  ? 'bg-green-900/30 border-green-700/50' :
                                isActive  ? 'bg-space-700/80 border-blue-500/60' :
                                            'bg-space-800/40 border-space-600/30'
                            }`}>
                                <span className={`font-semibold text-[11px] ${
                                    isZFixed  ? 'text-gray-600' :
                                    isLocked  ? 'text-green-400' :
                                    isActive  ? 'text-blue-300' : 'text-gray-600'
                                }`}>{axis.toUpperCase()}</span>
                                {isActive ? (
                                    <input
                                        ref={inputRef}
                                        value={inputVal}
                                        onChange={e => setInputVal(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={livePos[axis]?.toFixed(2)}
                                        className={`w-14 bg-transparent text-white outline-none text-right text-xs placeholder-gray-600 ${focusCls}`}
                                    />
                                ) : (
                                    <span className={`w-14 text-right text-xs ${
                                        isZFixed  ? 'text-gray-600' :
                                        isLocked  ? 'text-green-300 font-medium' : 'text-gray-600 italic'
                                    }`}>{dispVal}</span>
                                )}
                                {isLocked && !isZFixed && <span className="text-green-500 text-[9px]">✓</span>}
                            </div>
                            {i < 2 && <span className="text-gray-700 px-0.5">›</span>}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* LINE 전용: 색상 + 두께 */}
            {mode === 'line' && (
                <div className="flex items-center gap-1 border-l border-space-600 pl-2">
                    <input type="color" value={lineColor}
                        onChange={e => setLineColor(e.target.value)}
                        onKeyDown={e => e.stopPropagation()}
                        className="w-6 h-6 cursor-pointer bg-transparent border-0 p-0 rounded" />
                    <input type="number" min="1" max="20" step="0.5" value={lineWidth}
                        onChange={e => setLineWidth(parseFloat(e.target.value) || 2)}
                        onKeyDown={e => e.stopPropagation()}
                        className="w-10 text-center rounded border border-space-600 bg-space-800 px-1 py-0.5 text-white text-xs outline-none" />
                </div>
            )}

            {/* 힌트 */}
            <div className="flex items-center gap-1 border-l border-space-600 pl-2 text-gray-600">
                <span>↵</span>
                {canClose && (
                    <><span>·</span>
                    <button onClick={onCloseChain} className="text-cyan-500 hover:text-cyan-300">C</button></>
                )}
                <span>·</span><span>Esc</span>
            </div>
        </div>
    );
}

// ================================================================
// PropertyPanel
// ================================================================

function PropertyPanel({ selectedElement, selectedElements, updateElementData, saveUpdateElement, deleteSelectedElements }) {
    const t = useT('bimDashboard');
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
            sizeX: n(d.sizeX, 1), sizeY: n(d.sizeY, 1), sizeZ: n(d.sizeZ, 1),
        });
    }, [selectedElement]);

    // 다중 선택 시 다른 UI 표시
    const multiCount = selectedElements?.size ?? 0;
    if (!selectedElement && multiCount === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-4 text-center">
                <div className="text-3xl mb-2">🏗️</div>
                <p>{t('clickMemberHint')}</p>
                <p className="text-xs mt-2 text-gray-600">{t('shiftClickHint')}</p>
            </div>
        );
    }

    if (!selectedElement && multiCount > 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-4 text-center gap-3">
                <div className="text-2xl">⬚</div>
                <p className="text-sm text-gray-300">
                    <span className="text-violet-400 font-bold">{t('multiSelected', { count: multiCount })}</span>
                </p>
                <button
                    onClick={deleteSelectedElements}
                    className="w-full px-3 py-2 rounded-md bg-red-700/60 text-red-300 hover:bg-red-600/80 transition text-xs font-semibold"
                >
                    {t('deleteAllSelected')}
                </button>
            </div>
        );
    }

    const el = selectedElement.data;
    const typeColor = { IfcColumn: 'brown', IfcBeam: 'gray', IfcWall: 'gray', IfcSlab: 'blue', IfcPier: 'orange', IfcRebar: 'red' }[el.elementType] ?? 'gray';

    const handleChange = (field, value) => {
        const isNum = field !== 'material';
        const parsed = isNum ? (parseFloat(value) || 0) : value;
        const next = { ...form, [field]: parsed };
        setForm(next);
        updateElementData(el.elementId, {
            ...el,
            material: next.material,
            positionX: next.posX, positionY: next.posY, positionZ: next.posZ,
            sizeX: next.sizeX, sizeY: next.sizeY, sizeZ: next.sizeZ,
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
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('material')}</label>
                <select value={form.material} onChange={e => handleChange('material', e.target.value)} className={inputCls}>
                    <option value="">-- {t('selectMaterial')} --</option>
                    {Object.entries(MATERIAL_OPTIONS).map(([group, items]) => (
                        <optgroup key={group} label={group}>
                            {items.map(m => <option key={m} value={m}>{m}</option>)}
                        </optgroup>
                    ))}
                </select>
                <input
                    type="text" placeholder={t('typeDirectly')}
                    value={form.material} onChange={e => handleChange('material', e.target.value)}
                    className={`${inputCls} mt-1 text-xs`}
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('size')}</label>
                <div className="grid grid-cols-3 gap-1">
                    {[['sizeX', 'X'], ['sizeY', 'Y'], ['sizeZ', 'H']].map(([f, lbl]) => (
                        <div key={f}>
                            <span className="text-xs text-gray-500">{lbl}</span>
                            <input type="number" step="0.01" min="0.01" value={form[f]}
                                onChange={e => handleChange(f, e.target.value)} className={inputCls} />
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">{t('position')}</label>
                <div className="grid grid-cols-3 gap-1">
                    {[['posX', 'X'], ['posY', 'Y'], ['posZ', 'Z']].map(([f, lbl]) => (
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
                    {t('save')}
                </button>
                <button onClick={deleteSelectedElements}
                    className="px-3 py-2 rounded-md bg-red-700/60 text-red-300 hover:bg-red-600/80 transition text-xs font-semibold">
                    {t('deleteBtn')}
                </button>
            </div>
        </div>
    );
}

// ================================================================
// 메인 BIM 대시보드
// ================================================================

export default function BimDashboard({ setViceComponent, modelData, setModelData, selectedProject, onConvertDrone, ifcMeshes }) {
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

    const t = useT('bimDashboard');
    const mainViewRef   = useRef(null);
    const hoverPosRef   = useRef({ x: 0, y: 0, z: 0 });

    // ── 패널 표시 여부 ─────────────────────────────────────────────
    const [showLayerPanel, setShowLayerPanel] = useState(typeof window !== 'undefined' && window.innerWidth >= 768);
    const [showLeftPanel, setShowLeftPanel] = useState(typeof window !== 'undefined' && window.innerWidth >= 768);

    // ── 스냅 (꼭짓점 자동 흡착) ────────────────────────────────────
    const [snapEnabled, setSnapEnabled] = useState(true);

    // ── IFC 카메라 맞춤 수동 트리거 ──────────────────────────────────
    const [fitCameraTrigger, setFitCameraTrigger] = useState(0);

    // ── 표준 뷰 프리셋 ────────────────────────────────────────────────
    const [viewPreset, setViewPreset] = useState(null);
    const applyViewPreset = useCallback((id) => {
        setViewPreset({ id, ts: Date.now() });
    }, []);

    // ── 뷰 모드 ────────────────────────────────────────────────────
    const [viewMode, setViewMode] = useState('3d'); // '3d' | 'xy' | 'xz' | 'yz'
    const [bimSubView, setBimSubView] = useState('editor'); // 'editor' | 'structural'
    const [showDroneModal, setShowDroneModal] = useState(false);

    // 드론 프로젝트는 2D 전용 (무거운 지형 모델 → 3D 불필요)
    const isDroneProject = selectedProject?.structureType === 'DRONE';
    useEffect(() => {
        if (isDroneProject) setViewMode('xy');
    }, [isDroneProject]);

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
    const [linesVisible, setLinesVisible] = useState(true);
    const [lineDrawMode, setLineDrawMode] = useState('off'); // 'off' | 'click' | 'coord'
    const [lineStart, setLineStart] = useState(null);
    const [lineChainStart, setLineChainStart] = useState(null);
    const [placeLocked, setPlaceLocked] = useState({ x: null, y: null, z: null });
    const [lineLocked,  setLineLocked]  = useState({ x: null, y: null, z: null });
    const lineDrawHeight = 0;

    // 배치 완료/취소 시 locked 축 리셋
    useEffect(() => {
        if (!pendingElement) setPlaceLocked({ x: null, y: null, z: null });
    }, [pendingElement]);

    // LINE 모드 종료 시 locked 축 리셋
    useEffect(() => {
        if (lineDrawMode === 'off') setLineLocked({ x: null, y: null, z: null });
    }, [lineDrawMode]);
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
                    lineId: d.lineId,
                    start: [d.startX, d.startY, d.startZ],
                    end: [d.endX, d.endY, d.endZ],
                    color: d.color,
                    lineWidth: d.lineWidth,
                    pointsJson: d.pointsJson ?? null,
                    closed: !!d.closed,
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
            endX: end[0], endY: end[1], endZ: end[2],
            color,
            lineWidth: width,
        };
        AxiosCustom.post(`${API_BASE}/line`, body)
            .then(res => {
                const d = res.data;
                setLines(prev => [...prev, {
                    lineId: d.lineId,
                    start: [d.startX, d.startY, d.startZ],
                    end: [d.endX, d.endY, d.endZ],
                    color: d.color,
                    lineWidth: d.lineWidth,
                    pointsJson: null,
                    closed: false,
                    shapeHeight: 0,
                }]);
            })
            .catch(err => console.error('선 저장 실패:', err));
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

    // 가시성 필터: 레이어 패널에서 선 전체를 숨길 수 있음
    const visibleLines = linesVisible ? lines : [];

    const handleStartPlacement = useCallback((data) => {
        // LINE 모드나 선택 모드가 활성화된 상태면 먼저 종료
        if (lineDrawMode !== 'off') {
            setLineDrawMode('off');
            setLineStart(null);
            setLineChainStart(null);
            setLineLocked({ x: null, y: null, z: null });
        }
        startPlacement(data);
    }, [lineDrawMode, startPlacement]);

    const finishLineDraw = useCallback(() => {
        setLineDrawMode('off');
        setLineStart(null);
        setLineChainStart(null);
    }, []);

    const closeLineChain = useCallback(() => {
        if (lineStart && lineChainStart &&
            JSON.stringify(lineStart) !== JSON.stringify(lineChainStart)) {
            addLine(lineStart, lineChainStart, lineColor, lineWidth);
        }
        setLineDrawMode('off');
        setLineStart(null);
        setLineChainStart(null);
    }, [lineStart, lineChainStart, lineColor, lineWidth, addLine]);

    /** 선 데이터 즉시 업데이트 (3D 뷰어 실시간 반영) */
    const updateLineData = useCallback((lineId, updates) => {
        setLines(prev => prev.map(l => l.lineId === lineId ? { ...l, ...updates } : l));
    }, []);

    /**
     * 꼭짓점 드래그 완료 → 서버 저장
     * latestPoints: 드래그 핸들러가 가지고 있는 최신 꼭짓점 배열
     * (lines state가 비동기 업데이트 중일 수 있으므로 latestPoints를 직접 사용)
     */
    const saveLineVertexDrag = useCallback((lineId, latestPoints) => {
        // lines ref를 사용하지 않고 latestPoints를 직접 사용해 stale closure 방지
        setLines(prev => {
            const line = prev.find(l => l.lineId === lineId);
            if (!line) return prev;
            const body = {
                lineId,
                projectId: selectedProject?.projectId,
                startX: latestPoints[0][0], startY: latestPoints[0][1] ?? 0, startZ: latestPoints[0][2],
                endX: latestPoints[latestPoints.length - 1][0],
                endY: latestPoints[latestPoints.length - 1][1] ?? 0,
                endZ: latestPoints[latestPoints.length - 1][2],
                color: line.color, lineWidth: line.lineWidth,
                pointsJson: JSON.stringify(latestPoints),
                closed: line.closed, shapeHeight: line.shapeHeight,
            };
            AxiosCustom.put(`${API_BASE}/line`, body)
                .catch(err => console.error('꼭짓점 드래그 저장 실패:', err));
            return prev; // state 자체는 이미 updateLineData로 업데이트됨
        });
    }, [selectedProject]);

    /** 선 데이터 서버에 저장 (PUT) */
    const saveUpdateLine = useCallback((lineData) => {
        // points 배열 → pointsJson 직렬화
        const pointsArr = lineData.pointsJson
            ? (typeof lineData.pointsJson === 'string'
                ? JSON.parse(lineData.pointsJson)
                : lineData.pointsJson)
            : [lineData.start, lineData.end];

        const body = {
            lineId: lineData.lineId,
            projectId: selectedProject?.projectId,
            startX: pointsArr[0][0],
            startY: pointsArr[0][1],
            startZ: pointsArr[0][2],
            endX: pointsArr[pointsArr.length - 1][0],
            endY: pointsArr[pointsArr.length - 1][1],
            endZ: pointsArr[pointsArr.length - 1][2],
            color: lineData.color,
            lineWidth: lineData.lineWidth,
            pointsJson: JSON.stringify(pointsArr),
            closed: lineData.closed,
            shapeHeight: lineData.shapeHeight,
        };
        AxiosCustom.put(`${API_BASE}/line`, body)
            .catch(err => console.error('선 수정 실패:', err));
    }, [selectedProject]);

    const handleLineClick = useCallback((point) => {
        const pos = [
            parseFloat((point.x ?? 0).toFixed(3)),
            parseFloat((point.y ?? 0).toFixed(3)),
            parseFloat((point.z ?? 0).toFixed(3)),
        ];
        if (!lineStart) {
            setLineStart(pos);
            setLineChainStart(pos);
        } else {
            addLine(lineStart, pos, lineColor, lineWidth);
            setLineStart(pos);
        }
    }, [lineStart, lineColor, lineWidth, addLine]);

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

    // 부재 클릭 시 선 선택 해제 (cross-selection 방지)
    const handleElementSelectAndClearLine = useCallback((el, meshRef, shiftKey) => {
        if (el) setSelectedLineId(null);
        handleElementSelect(el, meshRef, shiftKey);
    }, [handleElementSelect]);

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

    // ── 내보내기 (resolvedModelData 이후에 선언) ──────────────────
    const [exporting, setExporting] = useState(false);

    const handleExportExcel = useCallback(() => {
        if (!modelData?.length) return;
        exportQuantityToExcel(resolvedModelData, selectedProject?.projectName || 'BIM');
    }, [resolvedModelData, modelData, selectedProject]);

    const handleExportPDF = useCallback(async () => {
        if (!modelData?.length) return;
        setExporting(true);
        try {
            await exportToPDF(resolvedModelData, selectedProject?.projectName || 'BIM');
        } finally {
            setExporting(false);
        }
    }, [resolvedModelData, modelData, selectedProject]);

    // ================================================================
    // 러버밴드 선택 박스 (선택 모드에서만 활성)
    // ================================================================
    const [selBox, setSelBox] = useState(null); // { left, top, width, height } for CSS

    /** 러버밴드 박스 정보를 카메라 투영으로 부재 선택에 변환 */
    const computeRubberBandSelection = useCallback((startX, startY, endX, endY) => {
        if (!cameraRef.current || !mainViewRef.current) return;
        const camera = cameraRef.current;
        const domRect = mainViewRef.current.getBoundingClientRect();

        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        const hit = modelData.filter(el => {
            const px = Number(el.positionX) || 0;
            const py = Number(el.positionY) || 0;   // floor Y → Three.js Z
            const pz = Number(el.positionZ) || 0;   // height → Three.js Y
            const sz = Number(el.sizeZ) || 1;        // height size
            // 중심점: Three.js [X, Y=posZ+sizeZ/2, Z=posY]
            const center = new THREE.Vector3(px, pz + sz / 2, py);
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
                    left: Math.min(startX, cx),
                    top: Math.min(startY, cy),
                    width: Math.abs(cx - startX),
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
        el.addEventListener('pointerup', onPointerUp);
        return () => {
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', onPointerUp);
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
            if (e.key === 'l' || e.key === 'L') {
                if (lineDrawMode !== 'off') { finishLineDraw(); }
                else { setLineDrawMode('click'); }
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && !pendingElement) {
                // 선이 선택됐으면 선 삭제, 아니면 부재 삭제
                if (selectedLineId) {
                    deleteLine(selectedLineId);
                } else {
                    deleteSelectedElements();
                }
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                undo();
            }
            if (e.key === 'Escape') {
                if (lineDrawMode !== 'off') {
                    finishLineDraw();
                } else if (pendingElement) { cancelPlacement(); }
                else if (isSelectMode) { toggleSelectMode(); }
                else {
                    setSelectedElement(null);
                    setSelectedElements(new Set());
                    setSelectedLineId(null);
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedElement, pendingElement, isSelectMode, lineDrawMode, deleteSelectedElements,
        cancelPlacement, toggleSelectMode, setTransformMode, setSelectedElement, setSelectedElements,
        undo, finishLineDraw, selectedLineId, deleteLine, setSelectedLineId]);

    return (
        <div className="w-full bg-space-900 pb-2 flex flex-col overflow-hidden" style={{height:'85vh'}} >
        {/* 드론 사진 분석 모달 */}
        {showDroneModal && (
            <DroneAnalysisModal
                onClose={() => setShowDroneModal(false)}
                onConvertToBIM={onConvertDrone}
                onProjectSelect={(project) => {
                    setShowDroneModal(false);
                    setViceComponent('bim-projects');
                    setModelData([]);
                }}
            />
        )}

            {/* ── 헤더 ── */}
            <div className="flex items-center gap-2 md:gap-4 mb-3 flex-wrap py-2">
                <button
                    className="text-gray-300 hover:text-white text-sm"
                    onClick={() => { setViceComponent('bim-projects'); setModelData([]); }}
                >
                    {t('backToList')}
                </button>
                <h2 className="text-lg md:text-xl font-light text-white" aria-hidden="true"></h2>

                {/* 서브 탭 */}
                <div className="flex gap-1 bg-space-800/60 border border-space-700 rounded-xl p-1">
                    <button
                        onClick={() => setBimSubView('editor')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{
                            backgroundColor: bimSubView === 'editor' ? '#1e3a5f' : 'transparent',
                            color: bimSubView === 'editor' ? '#60a5fa' : '#8896a4',
                            border: bimSubView === 'editor' ? '1px solid #2a5080' : '1px solid transparent',
                        }}
                    >
                        <span>🏗</span>
                        <span>{t('editor')}</span>
                    </button>
                    <button
                        onClick={() => setBimSubView('structural')}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{
                            backgroundColor: bimSubView === 'structural' ? '#1a3520' : 'transparent',
                            color: bimSubView === 'structural' ? '#4ade80' : '#8896a4',
                            border: bimSubView === 'structural' ? '1px solid #166534' : '1px solid transparent',
                            boxShadow: bimSubView === 'structural' ? '0 0 8px #22c55e30' : 'none',
                        }}
                    >
                        <span>🔩</span>
                        <span>{t('structuralAnalysis')}</span>
                    </button>
                    <button
                        onClick={() => setShowDroneModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{
                            backgroundColor: 'transparent',
                            color: '#8896a4',
                            border: '1px solid transparent',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#0d2a1a'; e.currentTarget.style.color = '#4ade80'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8896a4'; }}
                    >
                        <span>🛸</span>
                        <span>{t('droneSurvey')}</span>
                    </button>
                </div>

                {/* 다중 선택 삭제 버튼 */}
                {bimSubView === 'editor' && totalSelectedCount > 1 && (
                    <button
                        onClick={deleteSelectedElements}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-red-700/60 text-red-300 hover:bg-red-600/80 transition"
                    >
                        {t('deleteItems', { count: totalSelectedCount })}
                    </button>
                )}

                <div className="ml-auto flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
                    {bimSubView === 'editor' && (<>
                        {/* 2D / 3D 뷰 토글 — 드론 프로젝트는 2D 전용 */}
                        {isDroneProject ? (
                            <span
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-700/60 text-emerald-300 border border-emerald-600/60"
                                title="드론 사진 기반 프로젝트는 2D 전용입니다"
                            >
                                🛸 2D 전용
                            </span>
                        ) : (
                            <div className="flex items-center gap-1">
                                {[
                                    { mode: '3d',  label: '3D',  title: t('view3DTitle') },
                                    { mode: 'xy',  label: 'XY',  title: t('viewXYTitle') },
                                    { mode: 'xz',  label: 'XZ',  title: t('viewXZTitle') },
                                    { mode: 'yz',  label: 'YZ',  title: t('viewYZTitle') },
                                ].map(({ mode, label, title }) => (
                                    <button
                                        key={mode}
                                        onClick={() => setViewMode(mode)}
                                        title={title}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                                            viewMode === mode
                                                ? 'bg-emerald-700/60 text-emerald-300 border border-emerald-600/60'
                                                : 'bg-space-700/70 text-gray-400 border border-space-600 hover:text-gray-200'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* 환경 선택 */}
                        {viewMode === '3d' && !isDroneProject && <EnvSelector currentId={envId} onChange={setEnvId} />}

                        {/* 좌측 패널 토글 */}
                        <button
                            onClick={() => setShowLeftPanel(v => !v)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${showLeftPanel
                                    ? 'bg-blue-700/50 text-blue-300 border border-blue-600/60'
                                    : 'bg-space-700/70 text-gray-400 border border-space-600'
                                }`}
                            title={t('toggleEditPanel')}
                        >
                            {showLeftPanel ? '◀' : '▶'} {t('edit')}
                        </button>

                        {/* 스냅 토글 */}
                        <button
                            onClick={() => setSnapEnabled(v => !v)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${snapEnabled
                                    ? 'bg-yellow-700/60 text-yellow-300 border border-yellow-600/60'
                                    : 'bg-space-700/70 text-gray-400 border border-space-600'
                                }`}
                            title={snapEnabled ? t('snapOnTitle') : t('snapOffTitle')}
                        >
                            {t('snap')} <span className={`text-xs ml-0.5 ${snapEnabled ? 'text-yellow-400' : 'text-gray-600'}`}>
                                {snapEnabled ? t('snapOn') : t('snapOff')}
                            </span>
                        </button>

                        {/* IFC 카메라 맞춤 버튼 — IFC 모델이 로드된 경우에만 표시 */}
                        {ifcMeshes && ifcMeshes.length > 0 && (
                            <button
                                onClick={() => setFitCameraTrigger(v => v + 1)}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition bg-sky-800/60 text-sky-300 border border-sky-600/60 hover:bg-sky-700/70"
                                title="IFC 모델 전체가 화면에 맞도록 카메라를 재배치합니다"
                            >
                                ⊡ 카메라 맞춤
                            </button>
                        )}

                        {/* 레이어 패널 토글 */}
                        <button
                            onClick={() => setShowLayerPanel(v => !v)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${showLayerPanel
                                    ? 'bg-teal-700/60 text-teal-300 border border-teal-600/60'
                                    : 'bg-space-700/70 text-gray-400 border border-space-600'
                                }`}
                            title={t('toggleLayerPanel')}
                        >
                            {t('layer')}
                            {layers.length > 0 && (
                                <span className="px-1 py-0.5 rounded-full text-xs bg-teal-600/40 text-teal-300">
                                    {layers.length}
                                </span>
                            )}
                        </button>

                        {/* ── 내보내기 버튼 그룹 ── */}
                        <div className="flex items-center gap-1 border-l border-space-600 pl-2 ml-1">
                            <button
                                onClick={handleExportExcel}
                                disabled={!modelData?.length}
                                title={t('downloadExcel')}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition
                                       bg-emerald-800/50 text-emerald-300 border border-emerald-700/50
                                       hover:bg-emerald-700/60 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                {t('excel')}
                            </button>
                            <button
                                onClick={handleExportPDF}
                                disabled={!modelData?.length || exporting}
                                title={t('downloadPDF')}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition
                                       bg-purple-800/50 text-purple-300 border border-purple-700/50
                                       hover:bg-purple-700/60 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                                {exporting ? t('generating') : t('pdf')}
                            </button>
                        </div>

                        <span className="text-xs text-gray-600 hidden xl:block">
                            {t('shortcuts')}
                        </span>
                    </>)}
                </div>
            </div>

            {/* ── 배치 / 선택 모드 배너 ── */}
            {bimSubView === 'editor' && pendingElement && (
                <div className="mb-2 px-3 py-2 rounded-xl flex items-center gap-2 text-sm flex-wrap"
                    style={{ backgroundColor: '#1a2f4a', border: '1px solid #2a5080' }}>
                    <span className="text-blue-400">📍</span>
                    <span className="text-blue-200 font-medium text-xs">
                        {t('placeModeTitle')} — <span className="text-white">{pendingElement.elementType?.replace('Ifc', '')}</span>
                    </span>
                    <span className="text-gray-400 text-xs hidden sm:inline">{t('placeModeHint')}</span>
                    <button onClick={cancelPlacement}
                        className="ml-auto text-xs px-2 py-1 rounded border border-blue-700/60 text-blue-400 hover:text-white transition">
                        {t('escCancel')}
                    </button>
                </div>
            )}
            {bimSubView === 'editor' && isSelectMode && !pendingElement && (
                <div className="mb-2 px-3 py-2 rounded-xl flex items-center gap-2 text-sm flex-wrap"
                    style={{ backgroundColor: '#1f1040', border: '1px solid #5b21b6' }}>
                    <span className="text-violet-400">⬚</span>
                    <span className="text-violet-200 font-medium text-xs">{t('selectMode')}</span>
                    <span className="text-gray-400 text-xs hidden sm:inline">{t('selectModeHint')}</span>
                    {totalSelectedCount > 0 && (
                        <span className="text-violet-300 text-xs font-semibold">{totalSelectedCount} {t('items')}</span>
                    )}
                    <button onClick={toggleSelectMode}
                        className="ml-auto text-xs px-2 py-1 rounded border border-violet-700/60 text-violet-400 hover:text-white transition">
                        {t('qDeselect')}
                    </button>
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto" style={{ display: bimSubView === 'structural' ? 'block' : 'none' }}>
                <StructuralDashboard selectedProject={selectedProject} modelData={modelData} />
            </div>
            <div
                ref={panelContainerRef}
                className="flex-1 min-h-0 flex flex-col md:flex-row"
                style={{ gap: 0, display: bimSubView === 'editor' ? undefined : 'none' }}
            >

                    {/* ── 좌측 편집 패널 ── */}
                    {showLeftPanel && (
                        <div
                            className="w-full min-h-0 shrink-0 flex flex-col gap-3 px-0 md:pr-1.5 overflow-y-auto"
                            style={isDesktop ? { width: `${leftPanelPct}%`, minWidth: 120 } : undefined}
                        >
                            <Card title={t('editTools')}>
                                <ControlPanel
                                    startPlacement={handleStartPlacement}
                                    pendingElement={pendingElement}
                                    cancelPlacement={cancelPlacement}
                                    currentMode={transformMode}
                                    setMode={setTransformMode}
                                    isSelectMode={isSelectMode}
                                    toggleSelectMode={toggleSelectMode}
                                    onPlaceSample={handlePlaceSample}
                                    isPlacingSample={isPlacingSample}
                                    onStartLine={() => {
                                        if (lineDrawMode !== 'off') finishLineDraw();
                                        else { cancelPlacement(); setLineDrawMode('click'); }
                                    }}
                                    lineDrawMode={lineDrawMode}
                                />
                            </Card>

                            {/* 선 선택 시 편집 패널 */}
                            {selectedLineId && (
                                <Card title={t('editLine')} right={<Chip color="blue">{t('drawLineChip')}</Chip>}>
                                    <LinePropertyPanel
                                        line={lines.find(l => l.lineId === selectedLineId)}
                                        onUpdate={updateLineData}
                                        onSave={saveUpdateLine}
                                        onDelete={deleteLine}
                                        onClose={() => setSelectedLineId(null)}
                                    />
                                </Card>
                            )}

                            <Card
                                title={t('elementProperties')}
                                right={
                                    <Chip color={selectedElement ? 'orange' : totalSelectedCount > 1 ? 'violet' : 'gray'}>
                                        {selectedElement ? 'SEL' : totalSelectedCount > 1 ? `${totalSelectedCount} ${t('items')}` : 'NONE'}
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
                        </div>
                    )}

                    {/* ── 좌측 드래그 핸들 ── */}
                    {showLeftPanel && isDesktop && (
                        <div
                            onMouseDown={(e) => handlePanelDragStart('left', e)}
                            onTouchStart={(e) => handlePanelDragStart('left', e)}
                            className="hidden md:flex items-center justify-center shrink-0 z-10 group relative"
                            style={{ width: 10, cursor: 'col-resize', touchAction: 'none' }}
                            title={`Drag to resize (current ${leftPanelPct.toFixed(0)}%)`}
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
                    <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0" style={{ paddingLeft: showLeftPanel && isDesktop ? 4 : 0, paddingRight: showLayerPanel && isDesktop ? 4 : 0 }}>
                        <Card
                            title={`${viewMode === '3d' ? t('view3D') : viewMode.toUpperCase() + ' 2D'} — ${currentProjectId ?? t('project')} (${visibleModelData.length} ${t('itemsUnit')})`}
                            right={
                                <div className="flex gap-1.5 items-center flex-wrap">
                                    <Chip color="orange">
                                        {transformMode === 'translate' ? t('move') : transformMode === 'rotate' ? t('rotate') : t('scale')}
                                    </Chip>
                                    {pendingElement && <Chip color="blue">{t('placing')}</Chip>}
                                    {isSelectMode && <Chip color="violet">{t('selectMode')}</Chip>}
                                    {lineDrawMode !== 'off' && <Chip color="blue">{t('drawLineChip')}</Chip>}
                                    <Chip color="blue">{t('liveChip')}</Chip>
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
                                    className="w-full flex-1 relative min-h-0"
                                    style={{
                                        cursor: pendingElement ? 'crosshair'
                                            : isSelectMode ? 'crosshair'
                                                : lineDrawMode === 'click' ? 'crosshair'
                                                    : 'default',
                                    }}
                                >
                                    <>

                                        {/* R3F 이벤트 소스 div */}
                                        <div ref={mainViewRef} className="absolute inset-0 z-10 touch-none" />

                                        <Canvas
                                            eventSource={mainViewRef}
                                            className="!absolute inset-0 rounded-xl pointer-events-none z-0"
                                            camera={{ position: [15, 12, 15],up: [0, 0, 1], fov: 55 }}
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
                                                <Scene
                                                    modelData={visibleModelData}
                                                    onElementSelect={handleElementSelectAndClearLine}
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
                                                    lines={visibleLines}
                                                    selectedLineId={selectedLineId}
                                                    onLineSelect={(id) => {
                                                        setSelectedLineId(id);
                                                        if (id) {
                                                            setShowLeftPanel(true);
                                                            setSelectedElement(null);
                                                            setSelectedElements(new Set());
                                                        }
                                                    }}
                                                    lineDrawMode={lineDrawMode}
                                                    lineDrawHeight={lineDrawHeight}
                                                    lineStart={lineStart}
                                                    lineColor={lineColor}
                                                    lineWidth={lineWidth}
                                                    onLineClick={handleLineClick}
                                                    onLineVertexUpdate={updateLineData}
                                                    onLineVertexSave={saveLineVertexDrag}
                                                    snapEnabled={snapEnabled}
                                                    onHoverPosition={pos => { hoverPosRef.current = pos; }}
                                                    placementLockedAxes={placeLocked}
                                                    lineLockedAxes={lineLocked}
                                                    ifcMeshes={ifcMeshes}
                                                    fitCameraTrigger={fitCameraTrigger}
                                                    viewPreset={viewPreset}
                                                    viewMode={viewMode}
                                                />
                                                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                                                    {/* axisNames: Three.js[X,Y,Z] → data[X,Z(height),Y(depth)] */}
                                                    <GizmoViewport axisColors={['#ff4060', '#80ff80', '#2080ff']} labelColor="white"/>
                                                </GizmoHelper>

                                        </Canvas>

                                        {/* ── 표준 뷰 프리셋 버튼 (3D 전용, 좌하단 수직 배치) ── */}
                                        {viewMode === '3d' && <div className="absolute bottom-16 left-3 z-20 pointer-events-auto flex flex-col gap-1 hidden sm:flex">
                                            {[
                                                { id: 'iso',   label: 'ISO',  title: '등각뷰 (Isometric)' },
                                                { id: 'top',   label: 'TOP',  title: '평면도 (Plan / Z-up 기준 위)' },
                                                { id: 'front', label: 'FRT',  title: '정면도 (Front Elevation)' },
                                                { id: 'right', label: 'RGT',  title: '우측면도 (Right Elevation)' },
                                                { id: 'left',  label: 'LFT',  title: '좌측면도 (Left Elevation)' },
                                                { id: 'back',  label: 'BCK',  title: '배면도 (Back Elevation)' },
                                            ].map(({ id, label, title }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => applyViewPreset(id)}
                                                    title={title}
                                                    className={`w-10 h-8 rounded text-xs font-bold transition-all ${
                                                        viewPreset?.id === id
                                                            ? 'bg-blue-600/80 text-white border border-blue-400'
                                                            : 'bg-space-800/80 text-gray-400 border border-space-600 hover:bg-space-700/80 hover:text-gray-200'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>}

                                        {/* 미니맵 앵커 + MiniMapCanvas — 3D 모드 전용 */}
                                        {viewMode === '3d' && <>
                                        <div
                                            ref={minimapContainerRef}
                                            className="absolute top-3 right-3 w-40 h-40 border border-space-500 rounded-xl overflow-hidden shadow-2xl z-20 pointer-events-auto hidden sm:block"
                                            style={{ cursor: 'crosshair' }}
                                            title="Minimap — Click to navigate"
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
                                        </>}

                                        {/* 2D 뷰 모드 레이블 */}
                                        {viewMode !== '3d' && (
                                            <div className="absolute top-3 left-3 z-20 bg-space-900/80 border border-emerald-700/60 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-semibold pointer-events-none">
                                                {viewMode === 'xy' ? t('viewXYLabel') : viewMode === 'xz' ? t('viewXZLabel') : t('viewYZLabel')}
                                                <span className="ml-2 text-gray-500 font-normal">{t('orthoProjection')}</span>
                                            </div>
                                        )}

                                        {/* ── 러버밴드 선택 박스 ── */}
                                        {isSelectMode && selBox && selBox.width > 5 && (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    pointerEvents: 'none',
                                                    left: selBox.left,
                                                    top: selBox.top,
                                                    width: selBox.width,
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
                                                <span className="ml-3 text-gray-400">{selectedElement.data.material || t('noMaterial')}</span>
                                                {totalSelectedCount > 1 && (
                                                    <span className="ml-3 text-violet-400 font-semibold">+{totalSelectedCount - 1} {t('selected')}</span>
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
                                                    <span className="text-cyan-400 font-bold">Line</span>
                                                    <span className="ml-2 text-gray-400">{pts.length} {t('vertices')}</span>
                                                    {sl.closed && <span className="ml-2 text-cyan-300">Closed</span>}
                                                    {sl.shapeHeight > 0 && <span className="ml-2 text-teal-300">{t('height')} {sl.shapeHeight}m</span>}
                                                    <span className="ml-3 text-gray-500">{t('editInLeftPanel')}</span>
                                                </div>
                                            );
                                        })()}

                                        {/* ── 부재 배치 커맨드바 ── */}
                                        {pendingElement && (
                                            <CoordCommandBar
                                                label={pendingElement.elementType.replace('Ifc', '').toUpperCase()}
                                                accentColor="orange"
                                                hoverPosRef={hoverPosRef}
                                                mode="place"
                                                onConfirm={(pos) => confirmPlacement(pos, currentProjectId)}
                                                onAxisLocked={(axis, val) => {
                                                    if (axis === '__reset__') setPlaceLocked({ x: null, y: null, z: null });
                                                    else setPlaceLocked(prev => ({ ...prev, [axis]: val }));
                                                }}
                                                onFinish={cancelPlacement}
                                            />
                                        )}

                                        {/* ── LINE 커맨드바 ── */}
                                        {lineDrawMode === 'click' && (
                                            <CoordCommandBar
                                                label="LINE"
                                                accentColor="blue"
                                                hoverPosRef={hoverPosRef}
                                                mode="line"
                                                lineStart={lineStart}
                                                lineChainStart={lineChainStart}
                                                lineColor={lineColor}
                                                setLineColor={setLineColor}
                                                lineWidth={lineWidth}
                                                setLineWidth={setLineWidth}
                                                onConfirm={handleLineClick}
                                                onAxisLocked={(axis, val) => {
                                                    if (axis === '__reset__') setLineLocked({ x: null, y: null, z: null });
                                                    else setLineLocked(prev => ({ ...prev, [axis]: val }));
                                                }}
                                                onCloseChain={closeLineChain}
                                                onFinish={finishLineDraw}
                                            />
                                        )}

                                        {/* ── 스냅 힌트 ── */}
                                        {(pendingElement || lineDrawMode === 'click') && snapEnabled && (
                                            <div className="absolute bottom-14 right-3 bg-space-900/70 border border-yellow-700/40 rounded-lg px-2 py-1 text-xs text-yellow-400 z-20">
                                                {t('snapOnHint')}
                                            </div>
                                        )}
                                    </>
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
                            title={`Drag to resize (current ${rightPanelPct.toFixed(0)}%)`}
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
                            className="w-full shrink-0 flex flex-col min-h-0 md:pl-1.5"
                            style={isDesktop ? { width: `${rightPanelPct}%`, minWidth: 120 } : undefined}
                        >
                            <Card
                                title={t('layerManager')}
                                right={
                                    <div className="flex items-center gap-2">
                                        <Chip color="green">{layers.length + (lines.length > 0 ? 1 : 0)} {t('itemsUnit')}</Chip>
                                        <button
                                            onClick={() => setShowLayerPanel(false)}
                                            className="text-gray-500 hover:text-gray-300 transition text-sm leading-none"
                                            title="Close Panel"
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
                                        onSelectElement={(el) => handleElementSelectAndClearLine(el, null)}
                                        lines={lines}
                                        linesVisible={linesVisible}
                                        onToggleLinesVisible={() => setLinesVisible(v => !v)}
                                        onClearLines={clearLines}
                                        onDeleteLine={deleteLine}
                                        onSelectLine={(lineId) => {
                                            setSelectedLineId(lineId);
                                        }}
                                        selectedLineId={selectedLineId}
                                    />
                                </div>
                            </Card>

                            {/* 구조 데이터 분석 */}
                            <Card title={t('elementList')} right={<Chip color="green">{t('liveChip')}</Chip>} className="mt-3 shrink-0">
                                <div className="grid grid-cols-6 gap-1.5">
                                    {['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcSlab', 'IfcPier', 'IfcRebar'].map(type => {
                                        const count = modelData.filter(e => e.elementType === type).length;
                                        return (
                                            <div key={type} className="bg-space-700/60 rounded-lg p-2 flex flex-col items-center gap-0.5">
                                                <span className="text-xs text-gray-400 truncate w-full text-center">{type.replace('Ifc', '')}</span>
                                                <span className="text-lg font-bold text-gray-100">{count}</span>
                                                <span className="text-xs text-gray-500">{t('itemsUnit')}</span>
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
