import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import Scene from './component/Scene';
import ControlPanel from './component/ControlPanel';
import LayerPanel from './component/LayerPanel';

import BimDashboardAPI from './BimDashboardAPI';
import { ENV_PRESETS, DEFAULT_ENV_ID } from './component/SkyEnvironment';
import MiniMapCanvas from './component/MiniMapCanvas';
import AxiosCustom from '../../axios/AxiosCustom';
import { exportQuantityToExcel, exportToPDF } from '../../utils/exportUtils';
import StructuralDashboard from '../structural/StructuralDashboard';
import WorkPlanDashboard from './component/WorkPlanDashboard';
import DroneAnalysisModal from './component/DroneAnalysisModal';
import BimAgentChat from './component/BimAgentChat';
import { useT } from '../../i18n/LanguageContext';

const API_BASE = '/api/bim';

// ================================================================
// 공통 UI
// ================================================================

function Card({ title, right, children, className = "", style = {} }) {
    return (
        <div
            className={`bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow ${className}`}
            style={style}
        >
            <div className="mb-2 flex items-center justify-between gap-2 min-w-0">
                <h2 className="text-base font-semibold tracking-wide text-gray-100 truncate flex-1" title={title}>
                    {title}
                </h2>
                <div className="shrink-0">
                    {right}
                </div>
            </div>
            {children}
        </div>
    );
}

function CardGridWrapper({ children }) {
    return (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 w-full">
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
    const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
    const btnRef = React.useRef(null);
    const current = ENV_PRESETS.find(p => p.id === currentId) ?? ENV_PRESETS[0];

    const handleToggle = () => {
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setDropPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }
        setOpen(v => !v);
    };

    return (
        <div className="relative">
            <button
                ref={btnRef}
                onClick={handleToggle}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold shrink-0
                           bg-space-700/70 text-gray-300 border border-space-600 hover:bg-space-600 transition"
                title={t('selectBgEnv')}
            >
                <span>{current.icon}</span>
                <span className="hidden lg:inline">{current.label}</span>
                <span className="opacity-50">▾</span>
            </button>

            {open && (
                <>
                    {/* backdrop */}
                    <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setOpen(false)} />
                    {/* dropdown — fixed 좌표로 overflow:hidden 부모 클리핑 회피 */}
                    <div style={{
                        position: 'fixed',
                        top: dropPos.top,
                        right: dropPos.right,
                        zIndex: 9999,
                        minWidth: 150,
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: 12,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        padding: '6px',
                    }}>
                        <p className="text-xs text-gray-500 px-2 pb-1.5 font-medium">{t('environment')}</p>
                        {ENV_PRESETS.map(p => (
                            <button
                                key={p.id}
                                onClick={() => { onChange(p.id); setOpen(false); }}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '6px 10px', borderRadius: 8, fontSize: 12,
                                    textAlign: 'left', cursor: 'pointer', border: 'none',
                                    backgroundColor: p.id === currentId ? 'rgba(37,99,235,0.3)' : 'transparent',
                                    color: p.id === currentId ? '#93c5fd' : '#cbd5e1',
                                }}
                            >
                                <span style={{ fontSize: 14 }}>{p.icon}</span>
                                <span>{p.label}</span>
                                {p.id === currentId && <span style={{ marginLeft: 'auto', color: '#60a5fa' }}>✓</span>}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

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

const LINE_TYPE_OPTIONS = [
    { value: 'line',   label: '선 (Line)',         color: null      },
    { value: 'rebar',  label: '철근 (Rebar)',       color: '#ef4444' },
    { value: 'wall',   label: '벽체 (Wall)',        color: '#94a3b8' },
    { value: 'slab',   label: '슬래브 (Slab)',      color: '#60a5fa' },
    { value: 'beam',   label: '보 (Beam)',          color: '#a78bfa' },
    { value: 'column', label: '기둥 (Column)',      color: '#fbbf24' },
    { value: 'floor',  label: '바닥 (Floor)',       color: '#34d399' },
    { value: 'pipe',   label: '배관 (Pipe)',        color: '#22d3ee' },
];

function LinePropertyPanel({ line, onUpdate, onSave, onDelete, onDecompose, onClose }) {
    const t = useT('bimDashboard');
    const [form, setForm] = React.useState(null);

    // 선 전환 시 전체 폼 초기화
    React.useEffect(() => {
        if (!line) { setForm(null); return; }
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
            lineType: line.lineType ?? 'line',
            closed: !!line.closed,
            shapeHeight: line.shapeHeight ?? 0,
            points: pts.map(p => [...p]),
        });
    }, [line?.lineId]); // eslint-disable-line react-hooks/exhaustive-deps

    // 꼭짓점 드래그로 line.pointsJson이 외부에서 바뀌면 form.points만 동기화
    React.useEffect(() => {
        if (!form || !line) return;
        let newPts;
        try {
            const raw = line.pointsJson;
            newPts = raw
                ? (typeof raw === 'string' ? JSON.parse(raw) : raw)
                : [line.start, line.end];
        } catch { return; }
        if (!Array.isArray(newPts) || newPts.length < 2) return;
        if (JSON.stringify(newPts) !== JSON.stringify(form.points)) {
            setForm(prev => prev ? { ...prev, points: newPts.map(p => [...p]) } : prev);
        }
    }, [line?.pointsJson]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!line || !form) return null;

    const inputCls = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none";

    const commit = (next) => {
        setForm(next);
        onUpdate(line.lineId, {
            color: next.color,
            lineWidth: next.lineWidth,
            lineType: next.lineType,
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
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-300">{t('editLine')}</span>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>

            {/* 요소 타입 선택 */}
            <div>
                <label className="text-xs text-gray-400 block mb-1">요소 타입</label>
                <div className="grid grid-cols-2 gap-1">
                    {LINE_TYPE_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            onClick={() => {
                                const autoColor = opt.color
                                    ? opt.color
                                    : (form.lineType !== 'line' ? '#60a5fa' : form.color);
                                commit({ ...form, lineType: opt.value, color: opt.color ?? form.color });
                            }}
                            className={`px-2 py-1 rounded text-xs font-semibold border transition ${
                                form.lineType === opt.value
                                    ? 'border-cyan-500 bg-cyan-900/40 text-cyan-200'
                                    : 'border-space-600 bg-space-700/40 text-gray-400 hover:text-gray-200'
                            }`}
                            style={opt.color && form.lineType === opt.value ? { borderColor: opt.color + '80', color: opt.color } : {}}
                        >
                            {opt.color && (
                                <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: opt.color }} />
                            )}
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

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
                </div>
            )}

            <div className="flex gap-2 pt-1">
                <button
                    onClick={() => onSave({ ...line, ...form, lineType: form.lineType, pointsJson: JSON.stringify(form.points) })}
                    className="flex-1 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition"
                    title="저장 (Ctrl+S)"
                >
                    {t('save')} <span className="opacity-50 text-[10px]">Ctrl+S</span>
                </button>
                <button
                    onClick={() => onDecompose?.(line.lineId)}
                    className="px-3 py-1.5 rounded-md bg-amber-700/60 text-amber-300 hover:bg-amber-600/80 transition text-xs font-semibold"
                    title="선을 개별 선분으로 분해"
                >
                    해체
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
                             mode,
                             lockZ = false,
                             lineStart, lineChainStart,
                             lineColor, setLineColor, lineWidth, setLineWidth,
                             onConfirm,
                             onAxisLocked,
                             onCloseChain,
                             onFinish,
                         }) {
    const allAxes = lockZ ? ['x', 'y'] : ['x', 'y', 'z'];
    const initLocked = () => ({ x: null, y: null, z: lockZ ? 0 : null });
    const [phase, setPhase]         = React.useState('x');
    const [lockedVals, setLocked]   = React.useState(initLocked);
    const [lockOrder, setLockOrder] = React.useState([]);
    const [inputVal, setInputVal]   = React.useState('');
    const [livePos, setLivePos]     = React.useState({ x: 0, y: 0, z: 0 });
    const inputRef = React.useRef();

    React.useEffect(() => {
        let id;
        function tick() {
            if (hoverPosRef?.current) {
                const p = hoverPosRef.current;
                // Y축도 체크해야 X 고정 후 Y가 변할 때 livePos가 업데이트됨
                setLivePos(prev =>
                    Math.abs(prev.x - p.x) > 0.005 || Math.abs(prev.y - p.y) > 0.005 || Math.abs(prev.z - p.z) > 0.005
                        ? { x: p.x, y: p.y, z: p.z } : prev
                );
            }
            id = requestAnimationFrame(tick);
        }
        id = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(id);
    }, [hoverPosRef]);

    React.useEffect(() => {
        setPhase('x');
        setLocked(initLocked());
        setLockOrder([]);
        setInputVal('');
        if (lockZ) onAxisLocked?.('z', 0);
        const t = setTimeout(() => inputRef.current?.focus(), 60);
        return () => clearTimeout(t);
    }, [label, lockZ]); // eslint-disable-line react-hooks/exhaustive-deps

    function advance() {
        const raw = inputVal.trim();
        const num = raw !== '' ? parseFloat(raw) : livePos[phase];
        if (isNaN(num)) return;

        const newLocked = { ...lockedVals, [phase]: num };
        const newOrder  = [...lockOrder, phase];
        onAxisLocked?.(phase, num);

        // 현재 축 제외한 다음 미잠금 축 탐색 (x→y→z 순서 유지)
        const nextPhase = allAxes.find(a => a !== phase && newLocked[a] === null) ?? null;

        if (nextPhase === null) {
            onConfirm({
                x: newLocked.x ?? livePos.x,
                y: newLocked.y ?? livePos.y,
                z: lockZ ? 0 : (newLocked.z ?? livePos.z),
            });
            setPhase(allAxes[0]);
            setLocked(initLocked());
            setLockOrder([]);
            setInputVal('');
            onAxisLocked?.('__reset__', null);
        } else {
            setLocked(newLocked);
            setLockOrder(newOrder);
            setPhase(nextPhase);
            setInputVal('');
        }
        setTimeout(() => inputRef.current?.focus(), 30);
    }

    function handleAxisClick(axis) {
        if (lockZ && axis === 'z') return;
        if (lockedVals[axis] !== null) {
            // 잠금 축 클릭 → 잠금 해제하고 해당 축 활성화
            setLocked(prev => ({ ...prev, [axis]: null }));
            setLockOrder(prev => prev.filter(a => a !== axis));
            onAxisLocked?.(axis, null);
            setPhase(axis);
            setInputVal('');
        } else {
            // 미잠금 축 클릭 → 해당 축 입력 활성화
            setPhase(axis);
            setInputVal('');
        }
        setTimeout(() => inputRef.current?.focus(), 30);
    }

    function handleKeyDown(e) {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); advance(); }
        if (e.key === 'Escape') {
            e.preventDefault();
            if (lockOrder.length > 0) {
                // 마지막으로 잠근 축을 해제하고 해당 축으로 돌아감
                const lastLocked = lockOrder[lockOrder.length - 1];
                setLocked(prev => ({ ...prev, [lastLocked]: null }));
                setLockOrder(prev => prev.slice(0, -1));
                onAxisLocked?.(lastLocked, null);
                setPhase(lastLocked);
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
                            <div
                                className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 border ${
                                    isZFixed  ? 'bg-space-800/60 border-space-600/40 opacity-50' :
                                        isLocked  ? 'bg-green-900/30 border-green-700/50 cursor-pointer hover:bg-green-900/50' :
                                            isActive  ? 'bg-space-700/80 border-blue-500/60' :
                                                'bg-space-800/40 border-space-600/30 cursor-pointer hover:border-space-500/60'
                                }`}
                                onClick={() => handleAxisClick(axis)}
                                title={isLocked ? `${axis.toUpperCase()} 잠금 해제` : `${axis.toUpperCase()} 입력`}
                            >
                                <span className={`font-semibold text-[11px] ${
                                    isZFixed  ? 'text-gray-600' :
                                        isLocked  ? 'text-green-400' :
                                            isActive  ? 'text-blue-300' : 'text-gray-500'
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
                            {i < 2 && <span className="text-gray-700 px-0.5">·</span>}
                        </React.Fragment>
                    );
                })}
            </div>

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
// QuickSelectPanel — 타입/재료로 부재 일괄 선택
// ================================================================
function QuickSelectPanel({ modelData, onSelect, onClose }) {
    const t = useT('bimDashboard');
    const TYPES = ['IfcColumn','IfcBeam','IfcWall','IfcSlab','IfcPier','IfcRebar'];
    const [selTypes, setSelTypes] = React.useState([]);
    const [selMat,   setSelMat]   = React.useState('');

    const allMaterials = React.useMemo(() => {
        const s = new Set(modelData.map(e => e.material).filter(Boolean));
        return [...s].sort();
    }, [modelData]);

    const apply = () => {
        const result = modelData.filter(el => {
            const typeOk = selTypes.length === 0 || selTypes.includes(el.elementType);
            const matOk  = !selMat || el.material === selMat;
            return typeOk && matOk;
        });
        onSelect(new Set(result.map(e => e.elementId)));
        onClose();
    };

    const toggleType = (t) => setSelTypes(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);

    const overlay = {
        position:'fixed', inset:0, zIndex:10000,
        background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)',
        display:'flex', alignItems:'center', justifyContent:'center',
    };
    const box = {
        background:'#0f1c2e', border:'1px solid #1e3a5f', borderRadius:16,
        padding:24, width:320, maxWidth:'calc(100vw - 2rem)', boxShadow:'0 8px 40px rgba(0,0,0,0.7)',
    };

    return (
        <div style={overlay} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
            <div style={box}>
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold text-violet-300">{t('quickSelectTitle')}</span>
                    <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
                </div>
                <p className="text-xs text-gray-400 mb-2">{t('quickSelectTypeLabel')}</p>
                <div className="grid grid-cols-3 gap-1 mb-4">
                    {TYPES.map(t => (
                        <button key={t} onClick={() => toggleType(t)}
                            className={`px-2 py-1 rounded text-xs font-semibold border transition ${selTypes.includes(t)?'bg-violet-700/50 text-violet-200 border-violet-500':'bg-space-700 text-gray-400 border-space-600'}`}
                        >{t.replace('Ifc','')}</button>
                    ))}
                </div>
                {allMaterials.length > 0 && (
                    <>
                        <p className="text-xs text-gray-400 mb-2">{t('quickSelectMatLabel')}</p>
                        <select value={selMat} onChange={e => setSelMat(e.target.value)}
                            className="w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-xs text-white outline-none mb-4">
                            <option value="">{t('quickSelectAllMat')}</option>
                            {allMaterials.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </>
                )}
                <div className="text-xs text-gray-500 mb-3">
                    {t('quickSelectPreview', { n: modelData.filter(el =>
                        (selTypes.length===0||selTypes.includes(el.elementType)) &&
                        (!selMat||el.material===selMat)
                    ).length })}
                </div>
                <button onClick={apply} className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition">{t('quickSelectApply')}</button>
            </div>
        </div>
    );
}

// ================================================================
// ArrayCopyDialog — 배열 복사
// ================================================================
function ArrayCopyDialog({ selectedElements, selectedElement, onApply, onClose }) {
    const t = useT('bimDashboard');
    const [arrayType, setArrayType] = React.useState('grid');
    const [countX,    setCountX]    = React.useState(3);
    const [countY,    setCountY]    = React.useState(3);
    const [spacingX,  setSpacingX]  = React.useState(3);
    const [spacingY,  setSpacingY]  = React.useState(3);
    const [linCount,  setLinCount]  = React.useState(5);
    const [linDx,     setLinDx]     = React.useState(3);
    const [linDy,     setLinDy]     = React.useState(0);
    const [linDz,     setLinDz]     = React.useState(0);

    const totalIds = React.useMemo(() => {
        const ids = new Set([...selectedElements]);
        if (selectedElement?.data?.elementId) ids.add(selectedElement.data.elementId);
        return ids;
    }, [selectedElements, selectedElement]);

    const total = arrayType==='grid' ? countX*countY-1 : linCount-1;
    const apply = () => {
        if (totalIds.size === 0) return;
        if (arrayType === 'grid') {
            onApply(totalIds, { type:'grid', countX, countY, spacingX, spacingY });
        } else {
            onApply(totalIds, { type:'linear', count:linCount, dx:linDx, dy:linDy, dz:linDz });
        }
        onClose();
    };

    const overlay = { position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,0.55)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center' };
    const box = { background:'#0f1c2e',border:'1px solid #1e3a5f',borderRadius:16,padding:24,width:340,maxWidth:'calc(100vw - 2rem)',boxShadow:'0 8px 40px rgba(0,0,0,0.7)' };
    const inp = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-xs text-white outline-none";

    return (
        <div style={overlay} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
            <div style={box}>
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold text-emerald-300">{t('arrayCopyTitle')}</span>
                    <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
                </div>
                <div className="flex gap-1 mb-4">
                    {['grid','linear'].map(tp => (
                        <button key={tp} onClick={() => setArrayType(tp)}
                            className={`flex-1 py-1 rounded text-xs font-semibold border transition ${arrayType===tp?'bg-emerald-700/50 text-emerald-200 border-emerald-500':'bg-space-700 text-gray-400 border-space-600'}`}
                        >{tp==='grid' ? t('arrayTypeGrid') : t('arrayTypeLinear')}</button>
                    ))}
                </div>
                {arrayType==='grid' ? (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div><p className="text-xs text-gray-400 mb-1">{t('arrayCountX')}</p><input type="number" min={1} max={20} value={countX} onChange={e=>setCountX(Math.max(1,+e.target.value))} className={inp}/></div>
                        <div><p className="text-xs text-gray-400 mb-1">{t('arrayCountY')}</p><input type="number" min={1} max={20} value={countY} onChange={e=>setCountY(Math.max(1,+e.target.value))} className={inp}/></div>
                        <div><p className="text-xs text-gray-400 mb-1">{t('arraySpacingX')}</p><input type="number" step={0.1} value={spacingX} onChange={e=>setSpacingX(+e.target.value)} className={inp}/></div>
                        <div><p className="text-xs text-gray-400 mb-1">{t('arraySpacingY')}</p><input type="number" step={0.1} value={spacingY} onChange={e=>setSpacingY(+e.target.value)} className={inp}/></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="col-span-2"><p className="text-xs text-gray-400 mb-1">{t('arrayLinCount')}</p><input type="number" min={2} max={50} value={linCount} onChange={e=>setLinCount(Math.max(2,+e.target.value))} className={inp}/></div>
                        <div><p className="text-xs text-gray-400 mb-1">{t('arrayDeltaX')}</p><input type="number" step={0.1} value={linDx} onChange={e=>setLinDx(+e.target.value)} className={inp}/></div>
                        <div><p className="text-xs text-gray-400 mb-1">{t('arrayDeltaY')}</p><input type="number" step={0.1} value={linDy} onChange={e=>setLinDy(+e.target.value)} className={inp}/></div>
                        <div><p className="text-xs text-gray-400 mb-1">{t('arrayDeltaZ')}</p><input type="number" step={0.1} value={linDz} onChange={e=>setLinDz(+e.target.value)} className={inp}/></div>
                    </div>
                )}
                <p className="text-xs text-gray-500 mb-3">
                    {t('arrayPreview', { sel: totalIds.size, n: total, total: totalIds.size * total })}
                </p>
                <button onClick={apply} disabled={totalIds.size===0} className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition disabled:opacity-30">{t('arrayApply')}</button>
            </div>
        </div>
    );
}

// ================================================================
// MirrorCopyDialog — 대칭 복사
// ================================================================
function MirrorCopyDialog({ selectedElements, selectedElement, modelData, onApply, onClose }) {
    const t = useT('bimDashboard');
    const [axis,     setAxis]     = React.useState('x');
    const [mirrorPos, setMirrorPos] = React.useState(0);
    const [copyMode, setCopyMode] = React.useState(true);

    const totalIds = React.useMemo(() => {
        const ids = new Set([...selectedElements]);
        if (selectedElement?.data?.elementId) ids.add(selectedElement.data.elementId);
        return ids;
    }, [selectedElements, selectedElement]);

    // 선택 부재의 중심값을 기본 기준점으로
    React.useEffect(() => {
        if (totalIds.size === 0) return;
        const els = modelData.filter(e => totalIds.has(e.elementId));
        if (els.length === 0) return;
        const avg = els.reduce((s, e) => s + (Number(axis==='x'?e.positionX:axis==='y'?e.positionY:e.positionZ)||0), 0) / els.length;
        setMirrorPos(parseFloat(avg.toFixed(3)));
    }, [axis]); // eslint-disable-line react-hooks/exhaustive-deps

    const apply = () => {
        if (totalIds.size === 0) return;
        onApply(totalIds, axis, mirrorPos, copyMode);
        onClose();
    };

    const overlay = { position:'fixed',inset:0,zIndex:10000,background:'rgba(0,0,0,0.55)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center' };
    const box = { background:'#0f1c2e',border:'1px solid #1e3a5f',borderRadius:16,padding:24,width:320,maxWidth:'calc(100vw - 2rem)',boxShadow:'0 8px 40px rgba(0,0,0,0.7)' };
    const inp = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-xs text-white outline-none";

    return (
        <div style={overlay} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
            <div style={box}>
                <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-bold text-pink-300">{t('mirrorCopyTitle')}</span>
                    <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
                </div>
                <p className="text-xs text-gray-400 mb-2">{t('mirrorAxisLabel')}</p>
                <div className="flex gap-1 mb-4">
                    {[['x', t('mirrorAxisX')], ['y', t('mirrorAxisY')], ['z', t('mirrorAxisZ')]].map(([a, lbl]) => (
                        <button key={a} onClick={() => setAxis(a)}
                            className={`flex-1 py-1 rounded text-xs font-bold border transition ${axis===a?'bg-pink-700/50 text-pink-200 border-pink-500':'bg-space-700 text-gray-400 border-space-600'}`}
                        >{lbl}</button>
                    ))}
                </div>
                <p className="text-xs text-gray-400 mb-1">{t('mirrorPosLabel')}</p>
                <input type="number" step={0.1} value={mirrorPos} onChange={e=>setMirrorPos(+e.target.value)} className={`${inp} mb-4`}/>
                <label className="flex items-center gap-2 cursor-pointer mb-4">
                    <input type="checkbox" checked={copyMode} onChange={e=>setCopyMode(e.target.checked)} className="accent-pink-500"/>
                    <span className="text-xs text-gray-300">{t('mirrorKeepOriginal')}</span>
                </label>
                <p className="text-xs text-gray-500 mb-3">{t('mirrorPreview', { n: totalIds.size, mode: copyMode ? t('mirrorModeCopy') : t('mirrorModeMove') })}</p>
                <button onClick={apply} disabled={totalIds.size===0} className="w-full py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm font-bold transition disabled:opacity-30">{t('mirrorApply')}</button>
            </div>
        </div>
    );
}

// ================================================================
// PropertyPanel
// ================================================================

function PropertyPanel({ selectedElement, selectedElements, updateElementData, saveUpdateElement, deleteSelectedElements, elementOpacity, onSetOpacity }) {
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
                {multiCount > 1 && <Chip color="violet">+{multiCount - 1}</Chip>}
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

            {/* 투명도 슬라이더 */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-400">{t('opacity')}</label>
                    <span className="text-xs text-gray-500">{Math.round((elementOpacity ?? 0.88) * 100)}%</span>
                </div>
                <input
                    type="range" min="0.05" max="1" step="0.05"
                    value={elementOpacity ?? 0.88}
                    onChange={e => onSetOpacity?.(parseFloat(e.target.value))}
                    className="w-full accent-blue-500"
                />
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

export default function BimDashboard({ setViceComponent, modelData, setModelData, selectedProject, onConvertDrone, ifcMeshes, canvasFullscreen, onToggleCanvasFullscreen, onPlacementModeChange }) {
    const {
        saveUpdateElement,
        selectedElement, setSelectedElement,
        mainCameraPosition, setMainCameraPosition,
        minimapContainerRef,
        minimapTrackElement,
        isLoading,
        handleElementSelect, updateElementData,
        transformMode, setTransformMode,
        selectedElements, setSelectedElements,
        applyRubberBandSelection,
        toggleSelectMode, isSelectMode,
        pendingElement, startPlacement, cancelPlacement, confirmPlacement,
        deleteSelectedElements,
        cameraRef,
        placeSampleStructure,
        layers, addLayer, deleteLayer, updateLayer, assignToLayer, removeFromLayer,
        elementColors, setElementColor, clearElementColor,
        elementOpacities, setElementOpacity, clearElementOpacity,
        createGroupLayer,
        arrayElements, mirrorElements,
        undo, pushUndo,
    } = BimDashboardAPI({ setViceComponent, modelData, setModelData, selectedProject });

    const t = useT('bimDashboard');
    const mainViewRef   = useRef(null);
    const hoverPosRef   = useRef({ x: 0, y: 0, z: 0 });
    const rootContainerRef = useRef(null);

    const [showLayerPanel, setShowLayerPanel] = useState(typeof window !== 'undefined' && window.innerWidth >= 768);
    const [showLeftPanel, setShowLeftPanel] = useState(typeof window !== 'undefined' && window.innerWidth >= 768);

    // 모바일 패널 닫기 애니메이션 상태 (선언만 — close 함수는 isDesktop 이후에 정의)
    const [leftClosing, setLeftClosing]   = useState(false);
    const [layerClosing, setLayerClosing] = useState(false);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [fitCameraTrigger, setFitCameraTrigger] = useState(0);

    const [viewPreset, setViewPreset] = useState(null);
    const applyViewPreset = useCallback((id) => {
        setViewPreset({ id, ts: Date.now() });
    }, []);

    const [viewMode, setViewMode] = useState('3d');
    const [bimSubView, setBimSubView] = useState('editor');
    const [showDroneModal, setShowDroneModal] = useState(false);

    const isDroneProject = selectedProject?.structureType === 'DRONE';
    useEffect(() => {
        if (isDroneProject) setViewMode('xy');
    }, [isDroneProject]);

    const [leftPanelPct, setLeftPanelPct]   = useState(13);
    const [rightPanelPct, setRightPanelPct] = useState(18);
    const panelContainerRef = useRef(null);
    const draggingSideRef   = useRef(null);

    const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
    useEffect(() => {
        const handler = () => setIsDesktop(window.innerWidth >= 768);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    // isDesktop 이후에 정의해야 TDZ 오류 없음
    const closeLeftPanel = useCallback(() => {
        if (!isDesktop) { setLeftClosing(true); }
        else { setShowLeftPanel(false); }
    }, [isDesktop]);

    const closeLayerPanel = useCallback(() => {
        if (!isDesktop) { setLayerClosing(true); }
        else { setShowLayerPanel(false); }
    }, [isDesktop]);

    // CSS 기반 전체화면 (헤더 위로 올라오는 overlay 방식)
    const [bimFs, setBimFs] = useState(false);
    const toggleBimFs = useCallback(() => setBimFs(v => !v), []);

    useEffect(() => {
        if (!bimFs) return;
        const onKey = (e) => { if (e.key === 'Escape') setBimFs(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [bimFs]);

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

    const [lines, setLines] = useState([]);
    const [linesVisible, setLinesVisible] = useState(true);
    const [lineDrawMode, setLineDrawMode] = useState('off');
    const [lineStart, setLineStart] = useState(null);
    const [lineChainStart, setLineChainStart] = useState(null);
    const [placeLocked, setPlaceLocked] = useState({ x: null, y: null, z: null });
    const [lineLocked,  setLineLocked]  = useState({ x: null, y: null, z: null });
    const lineDrawHeight = 0;

    useEffect(() => {
        if (!pendingElement) setPlaceLocked({ x: null, y: null, z: null });
    }, [pendingElement]);

    useEffect(() => {
        if (lineDrawMode === 'off') setLineLocked({ x: null, y: null, z: null });
    }, [lineDrawMode]);

    // 부재 배치 / 선 작도 / 측정 / 워크 모드 진입·해제 시 App.js에 알림 (FloatingAgent 숨김)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        onPlacementModeChange?.(pendingElement !== null || lineDrawMode !== 'off' || measureMode || walkMode);
    }, [pendingElement, lineDrawMode, measureMode, walkMode, onPlacementModeChange]); // eslint-disable-line no-use-before-define

    const [lineColor, setLineColor] = useState('#60a5fa');
    const [lineWidth, setLineWidth] = useState(2);
    const [selectedLineId, setSelectedLineId] = useState(null);
    const [multiSelectedLineIds, setMultiSelectedLineIds] = useState(new Set());

    useEffect(() => {
        const pid = selectedProject?.projectId;
        if (!pid) return;
        AxiosCustom.get(`${API_BASE}/lines?projectId=${pid}`)
            .then(res => {
                const loaded = (res.data || []).map(d => ({
                    lineId: d.lineId,
                    start: [d.startX, d.startY, d.startZ],
                    end: [d.endX, d.endY, d.endZ],
                    color: d.color,
                    lineWidth: d.lineWidth,
                    pointsJson: d.pointsJson ?? null,
                    closed: !!d.closed,
                    shapeHeight: d.shapeHeight ?? 0,
                    lineType: d.lineType ?? 'line',
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
                    lineType: d.lineType ?? 'line',
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

    const visibleLines = linesVisible ? lines : [];

    const handleStartPlacement = useCallback((data) => {
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

    // 선 다중 선택 토글 (Shift+클릭)
    const handleLineMultiSelect = useCallback((lineId) => {
        setMultiSelectedLineIds(prev => {
            const next = new Set(prev);
            if (next.has(lineId)) next.delete(lineId);
            else next.add(lineId);
            return next;
        });
        setShowLeftPanel(true);
        setSelectedElement(null);
        setSelectedElements(new Set());
    }, [setSelectedElement, setSelectedElements]);

    // 여러 선 합치기: 선택된 선들을 하나의 폴리라인으로 합침
    const mergeSelectedLines = useCallback(() => {
        const allIds = new Set([...multiSelectedLineIds, ...(selectedLineId ? [selectedLineId] : [])]);
        if (allIds.size < 2) return;

        const selectedLinesData = lines.filter(l => allIds.has(l.lineId));
        if (selectedLinesData.length < 2) return;

        // 순서대로 점들을 연결 (끝점-시작점 연결 시도)
        const getLinePoints = (line) => {
            if (line.pointsJson) {
                try {
                    const p = typeof line.pointsJson === 'string' ? JSON.parse(line.pointsJson) : line.pointsJson;
                    if (Array.isArray(p) && p.length >= 2) return p;
                } catch (_) {}
            }
            return [line.start, line.end];
        };

        let mergedPoints = getLinePoints(selectedLinesData[0]);
        for (let i = 1; i < selectedLinesData.length; i++) {
            const pts = getLinePoints(selectedLinesData[i]);
            const lastPt = mergedPoints[mergedPoints.length - 1];
            const threshold = 0.05;
            const dStart = Math.hypot(pts[0][0] - lastPt[0], pts[0][1] - lastPt[1], (pts[0][2] ?? 0) - (lastPt[2] ?? 0));
            const dEnd   = Math.hypot(pts[pts.length-1][0] - lastPt[0], pts[pts.length-1][1] - lastPt[1], (pts[pts.length-1][2] ?? 0) - (lastPt[2] ?? 0));
            if (dEnd < threshold) {
                // 끝점이 가깝다 → 역순으로 붙이기 (끝점 중복 제거)
                mergedPoints = [...mergedPoints, ...[...pts].reverse().slice(1)];
            } else if (dStart < threshold) {
                // 시작점이 가깝다 → 그대로 붙이기 (시작점 중복 제거)
                mergedPoints = [...mergedPoints, ...pts.slice(1)];
            } else {
                // 연결 안 됨 → 그냥 이어붙이기
                mergedPoints = [...mergedPoints, ...pts];
            }
        }

        const firstLine = selectedLinesData[0];
        const pid = selectedProject?.projectId;
        const start = mergedPoints[0];
        const end = mergedPoints[mergedPoints.length - 1];

        // 기존 선들 삭제
        for (const lineId of allIds) deleteLine(lineId);

        // 합쳐진 폴리라인 생성
        AxiosCustom.post(`${API_BASE}/line`, {
            projectId: pid,
            startX: start[0], startY: start[1], startZ: start[2] ?? 0,
            endX: end[0], endY: end[1], endZ: end[2] ?? 0,
            color: firstLine.color,
            lineWidth: firstLine.lineWidth,
            lineType: firstLine.lineType ?? 'line',
            pointsJson: JSON.stringify(mergedPoints),
            closed: false,
            shapeHeight: 0,
        }).then(res => {
            const d = res.data;
            setLines(prev => [...prev, {
                lineId: d.lineId,
                start: [d.startX, d.startY, d.startZ],
                end: [d.endX, d.endY, d.endZ],
                color: d.color,
                lineWidth: d.lineWidth,
                lineType: firstLine.lineType ?? 'line',
                pointsJson: JSON.stringify(mergedPoints),
                closed: false,
                shapeHeight: 0,
            }]);
        }).catch(err => console.error('합치기 저장 실패:', err));

        setMultiSelectedLineIds(new Set());
        setSelectedLineId(null);
    }, [multiSelectedLineIds, selectedLineId, lines, selectedProject, deleteLine]);

    // 선 분해: 선택된 선을 개별 선분으로 분리
    const decomposeSelectedLine = useCallback((lineId) => {
        const line = lines.find(l => l.lineId === lineId);
        if (!line) return;

        let pts;
        if (line.pointsJson) {
            try {
                pts = typeof line.pointsJson === 'string' ? JSON.parse(line.pointsJson) : line.pointsJson;
            } catch (_) { pts = [line.start, line.end]; }
        } else {
            pts = [line.start, line.end];
        }

        if (pts.length <= 2 && !line.closed) {
            alert('이미 단일 선분입니다. 분해할 수 없습니다.');
            return;
        }

        const segments = [];
        for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);
        if (line.closed && pts.length >= 3) segments.push([pts[pts.length - 1], pts[0]]);

        deleteLine(lineId);

        const pid = selectedProject?.projectId;
        for (const [s, e] of segments) {
            AxiosCustom.post(`${API_BASE}/line`, {
                projectId: pid,
                startX: s[0], startY: s[1], startZ: s[2] ?? 0,
                endX: e[0], endY: e[1], endZ: e[2] ?? 0,
                color: line.color,
                lineWidth: line.lineWidth,
                lineType: line.lineType ?? 'line',
                pointsJson: null,
                closed: false,
                shapeHeight: 0,
            }).then(res => {
                const d = res.data;
                setLines(prev => [...prev, {
                    lineId: d.lineId,
                    start: [d.startX, d.startY, d.startZ],
                    end: [d.endX, d.endY, d.endZ],
                    color: d.color,
                    lineWidth: d.lineWidth,
                    lineType: line.lineType ?? 'line',
                    pointsJson: null,
                    closed: false,
                    shapeHeight: 0,
                }]);
            }).catch(err => console.error('분해 저장 실패:', err));
        }

        setSelectedLineId(null);
        setMultiSelectedLineIds(new Set());
    }, [lines, selectedProject, deleteLine]);

    const closeLineChain = useCallback(() => {
        if (lineStart && lineChainStart &&
            JSON.stringify(lineStart) !== JSON.stringify(lineChainStart)) {
            addLine(lineStart, lineChainStart, lineColor, lineWidth);
        }
        setLineDrawMode('off');
        setLineStart(null);
        setLineChainStart(null);
    }, [lineStart, lineChainStart, lineColor, lineWidth, addLine]);

    const updateLineData = useCallback((lineId, updates) => {
        setLines(prev => prev.map(l => l.lineId === lineId ? { ...l, ...updates } : l));
    }, []);

    // 꼭짓점 드래그 완료 — 로컬 상태는 onVertexUpdate(updateLineData)에서 실시간 반영됨.
    // 서버 저장은 Save 버튼 또는 Ctrl+S에서 처리하므로 여기서는 API 호출하지 않음.
    const saveLineVertexDrag = useCallback((_lineId, _latestPoints) => {
        // no-op: local state already updated via onVertexUpdate
    }, []);

    // ── 전역 저장 (Save 버튼 / Ctrl+S) ──────────────────────────────
    const handleGlobalSave = useCallback(() => {
        if (selectedLineId) {
            const currentLine = lines.find(l => l.lineId === selectedLineId);
            if (currentLine) saveUpdateLine(currentLine);
        } else if (selectedElement) {
            saveUpdateElement();
        }
    }, [selectedLineId, lines, selectedElement, saveUpdateLine, saveUpdateElement]); // eslint-disable-line react-hooks/exhaustive-deps

    const saveUpdateLine = useCallback((lineData) => {
        const pointsArr = lineData.pointsJson
            ? (typeof lineData.pointsJson === 'string' ? JSON.parse(lineData.pointsJson) : lineData.pointsJson)
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
            lineType: lineData.lineType ?? 'line',
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

    const [envId, setEnvId] = useState(DEFAULT_ENV_ID);
    const envPreset = useMemo(
        () => ENV_PRESETS.find(p => p.id === envId) ?? ENV_PRESETS[0],
        [envId]
    );

    const [mainCameraYaw, setMainCameraYaw] = useState(0);

    // ── 거리/각도 측정 ──
    const [measureMode, setMeasureMode] = useState(false);
    const [measurePoints, setMeasurePoints] = useState({ a: null, b: null });
    const handleMeasureClick = useCallback((pt) => {
        setMeasurePoints(prev => {
            if (!prev.a) return { a: pt, b: null };
            if (!prev.b) return { ...prev, b: pt };
            return { a: pt, b: null }; // 세 번째 클릭 → 새 측정 시작
        });
    }, []);

    // ── 치수 표시 ──
    const [showDimensions, setShowDimensions] = useState(false);

    // ── Named View ──
    const [savedViews, setSavedViews] = useState(() => {
        try { return JSON.parse(localStorage.getItem('bim_saved_views') || '[]'); }
        catch { return []; }
    });
    const [showViewsPanel, setShowViewsPanel] = useState(false);
    const orbitTargetRef = useRef(new THREE.Vector3(0, 0, 0));

    const saveCurrentView = useCallback((name) => {
        const cam = cameraRef.current;
        if (!cam) return;
        const view = {
            id: Date.now().toString(), name,
            position: [cam.position.x, cam.position.y, cam.position.z],
            target:   [orbitTargetRef.current.x, orbitTargetRef.current.y, orbitTargetRef.current.z],
        };
        const updated = [...savedViews, view];
        setSavedViews(updated);
        try { localStorage.setItem('bim_saved_views', JSON.stringify(updated)); } catch {}
    }, [savedViews, cameraRef]);

    const deleteView = useCallback((id) => {
        const updated = savedViews.filter(v => v.id !== id);
        setSavedViews(updated);
        try { localStorage.setItem('bim_saved_views', JSON.stringify(updated)); } catch {}
    }, [savedViews]);

    const restoreView = useCallback((view) => {
        setViewPreset({
            id: 'named',
            position: new THREE.Vector3(...view.position),
            target:   new THREE.Vector3(...view.target),
            ts: Date.now(),
        });
    }, []);

    // ── 단면 절단 ──
    const [sectionCutEnabled, setSectionCutEnabled] = useState(false);
    const [sectionCutAxis,    setSectionCutAxis]    = useState('z');
    const [sectionCutValue,   setSectionCutValue]   = useState(20);

    // ── Walk / Fly 모드 ──
    const [walkMode, setWalkMode] = useState(false);

    // ── 속성 필터 선택 (Quick Select) ──
    const [showQuickSelect, setShowQuickSelect] = useState(false);

    // ── 배열 복사 다이얼로그 ──
    const [showArrayDialog, setShowArrayDialog] = useState(false);

    // ── 대칭 복사 다이얼로그 ──
    const [showMirrorDialog, setShowMirrorDialog] = useState(false);

    const navigationTargetRef = useRef(null);
    const handleMiniMapNavigate = useCallback((x, z) => {
        navigationTargetRef.current = { x, z };
    }, []);

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

    const totalSelectedCount = useMemo(() => {
        const ids = new Set([
            ...selectedElements,
            ...(selectedElement ? [selectedElement.data.elementId] : []),
        ]);
        return ids.size;
    }, [selectedElements, selectedElement]);

    const resolvedModelData = useMemo(() => {
        return modelData.map(el => {
            const layer = layers.find(l => l.elementIds.includes(el.elementId));
            const hidden = layer ? !layer.visible : false;
            const resolvedColor   = elementColors[el.elementId] || layer?.color || null;
            const resolvedOpacity = elementOpacities[el.elementId] ?? null;
            return { ...el, resolvedColor, resolvedOpacity, hidden };
        });
    }, [modelData, layers, elementColors, elementOpacities]);

    const visibleModelData = useMemo(
        () => resolvedModelData.filter(el => !el.hidden),
        [resolvedModelData]
    );

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

    const [selBox, setSelBox] = useState(null);

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
            const py = Number(el.positionY) || 0;
            const pz = Number(el.positionZ) || 0;
            const sz = Number(el.sizeZ) || 1;
            const center = new THREE.Vector3(px, pz + sz / 2, py);
            center.project(camera);
            const sx = (center.x + 1) / 2 * domRect.width;
            const sc = (1 - center.y) / 2 * domRect.height;
            return sx >= minX && sx <= maxX && sc >= minY && sc <= maxY;
        }).map(el => el.elementId);

        applyRubberBandSelection(hit);
    }, [cameraRef, mainViewRef, modelData, applyRubberBandSelection]);

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

    useEffect(() => {
        const onKeyDown = (e) => {
            // Ctrl+S / Cmd+S — 전역 저장 (입력 포커스 위치 무관하게 항상 처리)
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                handleGlobalSave();
                return;
            }
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
                if (walkMode) { setWalkMode(false); }
                else if (measureMode) {
                    if (measurePoints.a && !measurePoints.b) setMeasurePoints({ a: null, b: null });
                    else { setMeasureMode(false); setMeasurePoints({ a: null, b: null }); }
                }
                else if (lineDrawMode !== 'off') { finishLineDraw(); }
                else if (pendingElement) { cancelPlacement(); }
                else if (isSelectMode) { toggleSelectMode(); }
                else {
                    setSelectedElement(null);
                    setSelectedElements(new Set());
                    setSelectedLineId(null);
                    setMultiSelectedLineIds(new Set());
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedElement, pendingElement, isSelectMode, lineDrawMode, deleteSelectedElements,
        cancelPlacement, toggleSelectMode, setTransformMode, setSelectedElement, setSelectedElements,
        undo, finishLineDraw, selectedLineId, deleteLine, setSelectedLineId,
        walkMode, measureMode, measurePoints, handleGlobalSave]);

    return (
        <div ref={rootContainerRef} className="w-full bg-space-900 flex flex-col overflow-hidden"
            style={bimFs
                ? { position: 'fixed', inset: 0, zIndex: 9999, height: '100dvh', width: '100vw' }
                : { height: '85dvh' }
            }>
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

            {/* 필터 선택 다이얼로그 */}
            {showQuickSelect && (
                <QuickSelectPanel
                    modelData={modelData}
                    onSelect={(ids) => {
                        setSelectedElements(ids);
                        setSelectedElement(null);
                    }}
                    onClose={() => setShowQuickSelect(false)}
                />
            )}

            {/* 배열 복사 다이얼로그 */}
            {showArrayDialog && (
                <ArrayCopyDialog
                    selectedElements={selectedElements}
                    selectedElement={selectedElement}
                    onApply={arrayElements}
                    onClose={() => setShowArrayDialog(false)}
                />
            )}

            {/* 대칭 복사 다이얼로그 */}
            {showMirrorDialog && (
                <MirrorCopyDialog
                    selectedElements={selectedElements}
                    selectedElement={selectedElement}
                    modelData={modelData}
                    onApply={mirrorElements}
                    onClose={() => setShowMirrorDialog(false)}
                />
            )}

            {/* ─── 툴바 ─── */}
            <div className="pb-1.5 px-3 border-b border-space-800 shrink-0 w-full select-none">

                {/* ── 모바일: 3행 레이아웃 ── */}
                <div className="flex flex-col gap-1.5 md:hidden">

                    {/* 행 1: 목록 ↔ 에디터·구조분석 */}
                    <div className="flex items-center justify-between gap-2">
                        <button
                            className="text-gray-400 hover:text-white text-xs font-semibold px-2 py-1 rounded-lg border border-space-700/60 bg-space-800/40 transition shrink-0"
                            onClick={() => { setViceComponent('bim-projects'); setModelData([]); }}
                        >{t('backToList')}</button>
                        <div className="flex gap-0.5 bg-space-950 border border-space-800 rounded-xl p-0.5">
                            <button onClick={() => setBimSubView('editor')} className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                                style={{ backgroundColor: bimSubView === 'editor' ? '#1e3a5f' : 'transparent', color: bimSubView === 'editor' ? '#60a5fa' : '#8896a4' }}
                            >{t('editor')}</button>
                            <button onClick={() => setBimSubView('structural')} className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                                style={{ backgroundColor: bimSubView === 'structural' ? '#1a3520' : 'transparent', color: bimSubView === 'structural' ? '#4ade80' : '#8896a4' }}
                            >{t('structuralAnalysis')}</button>
                            <button onClick={() => setBimSubView('workplan')} className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                                style={{ backgroundColor: bimSubView === 'workplan' ? '#1e1a3f' : 'transparent', color: bimSubView === 'workplan' ? '#c084fc' : '#8896a4' }}
                            >작업계획</button>
                        </div>
                    </div>

                    {bimSubView === 'editor' && (<>
                    {/* 행 2: 뷰모드 ↔ 배경 */}
                    <div className="flex items-center justify-between gap-2">
                        {isDroneProject ? (
                            <span className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-700/30 text-emerald-300 border border-emerald-600/40">2D Only</span>
                        ) : (
                            <div className="flex items-center bg-space-950 p-0.5 border border-space-800 rounded-lg">
                                {[{mode:'3d',label:'3D'},{mode:'xy',label:'XY'},{mode:'xz',label:'XZ'},{mode:'yz',label:'YZ'}].map(({mode,label}) => (
                                    <button key={mode} onClick={() => setViewMode(mode)}
                                        className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition ${viewMode===mode?'bg-emerald-600/40 text-emerald-300':'text-gray-500 hover:text-gray-300'}`}
                                    >{label}</button>
                                ))}
                            </div>
                        )}
                        {viewMode === '3d' && !isDroneProject ? <EnvSelector currentId={envId} onChange={setEnvId} /> : <span />}
                    </div>

                    {/* 행 3: 편집도구 ↔ 내보내기 */}
                    <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                            <button onClick={() => showLeftPanel ? closeLeftPanel() : setShowLeftPanel(true)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold border transition ${showLeftPanel?'bg-blue-700/30 text-blue-300 border-blue-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                            >⚙ {t('edit')}</button>
                            <button onClick={() => setSnapEnabled(v => !v)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold border transition ${snapEnabled?'bg-yellow-600/20 text-yellow-300 border-yellow-500/40':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                            >{t('snap')}</button>
                            {ifcMeshes && ifcMeshes.length > 0 && (
                                <button onClick={() => setFitCameraTrigger(v => v + 1)}
                                    className="px-2 py-1 rounded-lg text-xs font-semibold border bg-sky-800/30 text-sky-300 border-sky-600/50 hover:bg-sky-700/40 transition"
                                >{t('fit')}</button>
                            )}
                            <button onClick={() => showLayerPanel ? closeLayerPanel() : setShowLayerPanel(true)}
                                className={`px-2 py-1 rounded-lg text-xs font-semibold border transition ${showLayerPanel?'bg-teal-700/30 text-teal-300 border-teal-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                            >{t('layer')}{layers.length > 0 && ` (${layers.length})`}</button>
                        </div>
                        <div className="flex items-center bg-space-950 p-0.5 border border-space-800 rounded-lg">
                            <button onClick={handleExportExcel} disabled={!modelData?.length}
                                className="px-2 py-0.5 rounded text-[11px] font-medium text-emerald-400 hover:bg-emerald-950/50 disabled:opacity-20"
                            >XL</button>
                            <button onClick={handleExportPDF} disabled={!modelData?.length || exporting}
                                className="px-2 py-0.5 rounded text-[11px] font-medium text-purple-400 hover:bg-purple-950/50 disabled:opacity-20"
                            >{exporting ? '..' : 'PDF'}</button>
                        </div>
                    </div>

                    {/* 행 4: 신규 도구 (수평 스크롤) */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                        <button onClick={() => { setMeasureMode(v => { if (!v) setMeasurePoints({a:null,b:null}); return !v; }); }}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 ${measureMode?'bg-yellow-600/30 text-yellow-300 border-yellow-500/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        >{t('toolMeasure')}</button>
                        <button onClick={() => setShowDimensions(v => !v)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 ${showDimensions?'bg-cyan-700/30 text-cyan-300 border-cyan-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        >{t('toolDimensions')}</button>
                        <button onClick={() => setSectionCutEnabled(v => !v)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 ${sectionCutEnabled?'bg-orange-600/30 text-orange-300 border-orange-500/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        >{t('toolSection')}</button>
                        <button onClick={() => setWalkMode(v => !v)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 ${walkMode?'bg-green-700/30 text-green-300 border-green-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        >{t('toolWalk')}</button>
                        <div className="h-4 w-px bg-space-700 shrink-0 mx-0.5" />
                        <button onClick={() => setShowQuickSelect(true)}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60"
                        >{t('toolFilter')}</button>
                        <button onClick={() => setShowArrayDialog(true)}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60"
                        >{t('toolArray')}</button>
                        <button onClick={() => setShowMirrorDialog(true)}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60"
                        >{t('toolMirror')}</button>
                        <button
                            onClick={() => {
                                const ids = new Set([...selectedElements, ...(selectedElement?[selectedElement.data.elementId]:[])]);
                                if (ids.size === 0) { alert(t('groupNoSelection')); return; }
                                const name = window.prompt(t('groupNameDefault',{n:''}).trim(), t('groupNameDefault',{n:layers.length+1}));
                                if (!name) return;
                                createGroupLayer(name, ids);
                            }}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60"
                        >{t('toolGroup')}</button>
                        <button onClick={() => setShowViewsPanel(v => !v)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition shrink-0 ${showViewsPanel?'bg-blue-700/30 text-blue-300 border-blue-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        >{t('toolViews')}{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</button>
                    </div>
                    </>)}
                </div>

                {/* ── 데스크탑: 한 줄 레이아웃 ── */}
                <div className=" hidden md:flex items-center gap-4 overflow-x-auto">

                    {/* 목록 */}
                    <button className="text-gray-400 hover:text-white text-xs font-semibold px-2 py-1.5 rounded-lg border border-space-700/60 bg-space-800/40 transition shrink-0"
                        onClick={() => { setViceComponent('bim-projects'); setModelData([]); }}
                    >{t('backToList')}</button>

                    {/* 서브탭 */}
                    <div className="flex gap-0.5 bg-space-950 border border-space-800 rounded-xl p-0.5 shrink-0">
                        <button onClick={() => setBimSubView('editor')} className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                            style={{ backgroundColor: bimSubView === 'editor' ? '#1e3a5f' : 'transparent', color: bimSubView === 'editor' ? '#60a5fa' : '#8896a4' }}
                        >{t('editor')}</button>
                        <button onClick={() => setBimSubView('structural')} className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                            style={{ backgroundColor: bimSubView === 'structural' ? '#1a3520' : 'transparent', color: bimSubView === 'structural' ? '#4ade80' : '#8896a4' }}
                        >{t('structuralAnalysis')}</button>
                        <button onClick={() => setBimSubView('workplan')} className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                            style={{ backgroundColor: bimSubView === 'workplan' ? '#1e1a3f' : 'transparent', color: bimSubView === 'workplan' ? '#c084fc' : '#8896a4' }}
                        >작업계획</button>
                    </div>

                    {bimSubView === 'editor' && (<>
                    {/* 구분선 */}
                    <div className="h-5 w-px bg-space-700 shrink-0" />

                    {/* 뷰모드 + 배경 */}
                    {isDroneProject ? (
                        <span className="px-2 py-1 rounded-lg text-xs font-bold bg-emerald-700/30 text-emerald-300 border border-emerald-600/40 shrink-0">2D Only</span>
                    ) : (
                        <div className="flex items-center bg-space-950 p-0.5 border border-space-800 rounded-lg shrink-0">
                            {[{mode:'3d',label:'3D'},{mode:'xy',label:'XY'},{mode:'xz',label:'XZ'},{mode:'yz',label:'YZ'}].map(({mode,label}) => (
                                <button key={mode} onClick={() => setViewMode(mode)}
                                    className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition ${viewMode===mode?'bg-emerald-600/40 text-emerald-300':'text-gray-500 hover:text-gray-300'}`}
                                >{label}</button>
                            ))}
                        </div>
                    )}
                    {viewMode === '3d' && !isDroneProject && <EnvSelector currentId={envId} onChange={setEnvId} />}

                    {/* 구분선 */}
                    <div className="h-5 w-px bg-space-700 shrink-0" />

                    {/* 편집 도구 그룹 */}
                    <button onClick={() => showLeftPanel ? closeLeftPanel() : setShowLeftPanel(true)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${showLeftPanel?'bg-blue-700/30 text-blue-300 border-blue-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                    >⚙ {t('edit')}</button>
                    <button onClick={() => setSnapEnabled(v => !v)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${snapEnabled?'bg-yellow-600/20 text-yellow-300 border-yellow-500/40':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                    >{t('snap')}</button>
                    {ifcMeshes && ifcMeshes.length > 0 && (
                        <button onClick={() => setFitCameraTrigger(v => v + 1)}
                            className="px-2 py-1 rounded-lg text-xs font-semibold border bg-sky-800/30 text-sky-300 border-sky-600/50 hover:bg-sky-700/40 transition shrink-0"
                        >{t('fit')}</button>
                    )}
                    <button onClick={() => showLayerPanel ? closeLayerPanel() : setShowLayerPanel(true)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${showLayerPanel?'bg-teal-700/30 text-teal-300 border-teal-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                    >{t('layer')}{layers.length > 0 && ` (${layers.length})`}</button>

                    {/* 구분선 */}
                    <div className="h-5 w-px bg-space-700 shrink-0" />

                    {/* 구분선 */}
                    <div className="h-5 w-px bg-space-700 shrink-0" />

                    {/* 도구 그룹 */}
                    <button onClick={() => { setMeasureMode(v => { if (!v) setMeasurePoints({a:null,b:null}); return !v; }); }}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${measureMode?'bg-yellow-600/30 text-yellow-300 border-yellow-500/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        title={t('tooltipMeasure')}
                    >{t('toolMeasure')}</button>
                    <button onClick={() => setShowDimensions(v => !v)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${showDimensions?'bg-cyan-700/30 text-cyan-300 border-cyan-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        title={t('tooltipDimensions')}
                    >{t('toolDimensions')}</button>
                    <button onClick={() => setSectionCutEnabled(v => !v)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${sectionCutEnabled?'bg-orange-600/30 text-orange-300 border-orange-500/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        title={t('tooltipSection')}
                    >{t('toolSection')}</button>
                    <button onClick={() => setWalkMode(v => !v)}
                        className={`px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 ${walkMode?'bg-green-700/30 text-green-300 border-green-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                        title={t('tooltipWalk')}
                    >{t('toolWalk')}</button>

                    {/* 구분선 */}
                    <div className="h-5 w-px bg-space-700 shrink-0" />

                    {/* 편집 작업 그룹 */}
                    <button onClick={() => setShowQuickSelect(true)}
                        className="px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60 hover:text-violet-300"
                        title={t('tooltipFilter')}
                    >{t('toolFilter')}</button>
                    <button onClick={() => setShowArrayDialog(true)}
                        className="px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60 hover:text-emerald-300"
                        title={t('tooltipArray')}
                    >{t('toolArray')}</button>
                    <button onClick={() => setShowMirrorDialog(true)}
                        className="px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60 hover:text-pink-300"
                        title={t('tooltipMirror')}
                    >{t('toolMirror')}</button>
                    <button
                        onClick={() => {
                            const ids = new Set([
                                ...selectedElements,
                                ...(selectedElement ? [selectedElement.data.elementId] : []),
                            ]);
                            if (ids.size === 0) { alert(t('groupNoSelection')); return; }
                            const name = window.prompt(t('groupNameDefault', { n: '' }).trim(), t('groupNameDefault', { n: layers.length + 1 }));
                            if (!name) return;
                            createGroupLayer(name, ids);
                        }}
                        className="px-2 py-1 rounded-lg text-xs font-semibold border transition shrink-0 bg-space-800/40 text-gray-400 border-space-700/60 hover:text-teal-300"
                        title={t('tooltipGroup')}
                    >{t('toolGroup')}</button>

                    {/* 구분선 */}
                    <div className="h-5 w-px bg-space-700 shrink-0" />

                    {/* Named View */}
                    <div className="relative shrink-0">
                        <button
                            onClick={() => setShowViewsPanel(v => !v)}
                            className={`px-2 py-1 rounded-lg text-xs font-semibold border transition ${showViewsPanel?'bg-blue-700/30 text-blue-300 border-blue-600/50':'bg-space-800/40 text-gray-400 border-space-700/60'}`}
                            title={t('tooltipViews')}
                        >{t('toolViews')}{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</button>
                        {showViewsPanel && (
                            <>
                                <div className="fixed inset-0" style={{zIndex:9998}} onClick={() => setShowViewsPanel(false)} />
                                <div style={{
                                    position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:9999,
                                    background:'#0f1c2e', border:'1px solid #1e3a5f',
                                    borderRadius:12, padding:12, minWidth:200, width:'max-content',
                                    maxWidth:'calc(100vw - 2rem)',
                                    boxShadow:'0 8px 32px rgba(0,0,0,0.7)',
                                }}>
                                    <p className="text-xs text-gray-500 mb-2 font-medium">{t('savedViewsTitle')}</p>
                                    {savedViews.length === 0 && <p className="text-xs text-gray-600 mb-2">{t('savedViewsNone')}</p>}
                                    {savedViews.map(v => (
                                        <div key={v.id} className="flex items-center gap-1 mb-1">
                                            <button onClick={() => { restoreView(v); setShowViewsPanel(false); }}
                                                className="flex-1 text-left text-xs text-gray-300 hover:text-blue-300 truncate">{v.name}</button>
                                            <button onClick={() => deleteView(v.id)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => { const name = window.prompt(t('savedViewsNamePrompt'), t('savedViewsDefault', { n: savedViews.length + 1 })); if (name) { saveCurrentView(name); setShowViewsPanel(false); } }}
                                        className="w-full mt-2 py-1 rounded bg-blue-700/50 text-blue-300 text-xs font-semibold hover:bg-blue-600/60 transition"
                                    >{t('savedViewsSave')}</button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* 내보내기 그룹 */}
                    <div className="flex items-center bg-space-950 p-0.5 border border-space-800 rounded-lg shrink-0">
                        <button onClick={handleExportExcel} disabled={!modelData?.length}
                            className="px-2 py-0.5 rounded text-[11px] font-medium text-emerald-400 hover:bg-emerald-950/50 disabled:opacity-20"
                        >XL</button>
                        <button onClick={handleExportPDF} disabled={!modelData?.length || exporting}
                            className="px-2 py-0.5 rounded text-[11px] font-medium text-purple-400 hover:bg-purple-950/50 disabled:opacity-20"
                        >{exporting ? '..' : 'PDF'}</button>
                    </div>
                    </>)}
                </div>
            </div>

            {/* 배치 / 선택 모드 배너 */}
            {bimSubView === 'editor' && pendingElement && (
                <div className="mb-2 mx-4 mt-2 px-3 py-2 rounded-xl flex items-center gap-2 text-sm flex-wrap shrink-0"
                     style={{ backgroundColor: '#1a2f4a', border: '1px solid #2a5080' }}>
                    <span className="text-blue-400">📍</span>
                    <span className="text-blue-200 font-medium text-xs">
                        {t('placeModeTitle')} — <span className="text-white">{pendingElement.elementType?.replace('Ifc', '')}</span>
                    </span>
                    <button onClick={cancelPlacement}
                            className="ml-auto text-xs px-2 py-1 rounded border border-blue-700/60 text-blue-400 hover:text-white transition">
                        {t('escCancel')}
                    </button>
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto" style={{ display: bimSubView === 'structural' ? 'block' : 'none' }}>
                <StructuralDashboard selectedProject={selectedProject} modelData={modelData} />
            </div>

            <div className="flex-1 min-h-0 overflow-auto" style={{ display: bimSubView === 'workplan' ? 'block' : 'none' }}>
                <WorkPlanDashboard selectedProject={selectedProject} modelData={modelData} />
            </div>

            <div
                ref={panelContainerRef}
                className="flex-1 min-h-0 flex flex-col md:flex-row mt-2"
                style={{ gap: 0, display: bimSubView === 'editor' ? undefined : 'none' }}
            >
                {(showLeftPanel || leftClosing) && !bimFs && (
                    <>
                    {/* 모바일: 배경 딤 */}
                    {!isDesktop && (
                        <div
                            className={leftClosing ? 'bim-panel-dim-out' : 'bim-panel-dim'}
                            onClick={closeLeftPanel}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 49,
                                backgroundColor: 'rgba(0,0,0,0.55)',
                                backdropFilter: 'blur(2px)',
                            }}
                        />
                    )}
                    <div
                        className={`min-h-0 flex flex-col gap-3 overflow-y-auto modal-scroll${!isDesktop ? (leftClosing ? ' bim-panel-left-out' : ' bim-panel-left') : ''}`}
                        onAnimationEnd={() => {
                            if (leftClosing) { setShowLeftPanel(false); setLeftClosing(false); }
                        }}
                        style={isDesktop
                            ? { width: `${leftPanelPct}%`, minWidth: 120, paddingRight: 6 }
                            : {
                                position: 'fixed', left: 0, top: 0, bottom: 0,
                                width: '82vw', maxWidth: 320,
                                zIndex: 50,
                                backgroundColor: '#080f1a',
                                borderRight: '1px solid #1e3a5f',
                                padding: '0 0 0 0',
                                boxShadow: '6px 0 32px rgba(0,0,0,0.7)',
                            }
                        }
                    >
                    {/* 모바일 패널 헤더 */}
                    {!isDesktop && (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '14px 16px 10px',
                            borderBottom: '1px solid #1e3a5f',
                            position: 'sticky', top: 0, zIndex: 1,
                            backgroundColor: '#080f1a',
                        }}>
                            <span style={{ color: '#93c5fd', fontSize: 13, fontWeight: 700 }}>
                                ✏️ {t('editTools')}
                            </span>
                            <button
                                onClick={closeLeftPanel}
                                style={{
                                    width: 28, height: 28, borderRadius: 6,
                                    backgroundColor: '#1c2a3a', border: '1px solid #253347',
                                    color: '#8896a4', fontSize: 14, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >✕</button>
                        </div>
                    )}
                    <div className={isDesktop ? 'flex flex-col gap-3' : 'flex flex-col gap-3 px-3 pt-2'}>
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

                        {/* 다중 선 선택 액션 바 */}
                        {(multiSelectedLineIds.size >= 1 || (selectedLineId && multiSelectedLineIds.size >= 1)) && (
                            <Card
                                title={`선 ${multiSelectedLineIds.size + (selectedLineId ? 1 : 0)}개 선택됨`}
                                right={
                                    <button
                                        onClick={() => { setMultiSelectedLineIds(new Set()); setSelectedLineId(null); }}
                                        className="text-gray-500 hover:text-gray-300 text-xs"
                                    >✕ 해제</button>
                                }
                            >
                                <div className="space-y-2">
                                    <p className="text-xs text-gray-500">
                                        Shift+클릭으로 선을 추가 선택하세요
                                    </p>
                                    <button
                                        onClick={mergeSelectedLines}
                                        disabled={(multiSelectedLineIds.size + (selectedLineId ? 1 : 0)) < 2}
                                        className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition disabled:opacity-30"
                                    >
                                        선 합치기 (Merge) — {multiSelectedLineIds.size + (selectedLineId ? 1 : 0)}개 → 1개
                                    </button>
                                </div>
                            </Card>
                        )}

                        {selectedLineId && (
                            <Card title={t('editLine')} right={<Chip color="blue">{t('drawLineChip')}</Chip>}>
                                <LinePropertyPanel
                                    line={lines.find(l => l.lineId === selectedLineId)}
                                    onUpdate={updateLineData}
                                    onSave={saveUpdateLine}
                                    onDelete={deleteLine}
                                    onDecompose={decomposeSelectedLine}
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
                                elementOpacity={selectedElement ? (elementOpacities[selectedElement.data.elementId] ?? null) : null}
                                onSetOpacity={(val) => {
                                    if (selectedElement) setElementOpacity(selectedElement.data.elementId, val);
                                }}
                            />
                        </Card>
                    </div>{/* end content wrapper */}
                    </div>{/* end panel overlay div */}
                    </>
                )}{/* end showLeftPanel */}

                {showLeftPanel && isDesktop && (
                    <div
                        onMouseDown={(e) => handlePanelDragStart('left', e)}
                        onTouchStart={(e) => handlePanelDragStart('left', e)}
                        className="hidden md:flex items-center justify-center shrink-0 z-10 group relative"
                        style={{ width: 10, cursor: 'col-resize', touchAction: 'none' }}
                    >
                        <div
                            className="h-16 rounded-full transition-all duration-150 group-hover:h-24 group-hover:w-1"
                            style={{ width: 3, backgroundColor: '#334155' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#334155'}
                        />
                    </div>
                )}

                {/* 중앙 3D 뷰어 */}
                <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0" style={{ paddingLeft: showLeftPanel && isDesktop ? 4 : 0, paddingRight: showLayerPanel && isDesktop ? 4 : 0 }}>
                    <Card
                        title={`${viewMode === '3d' ? t('view3D') : viewMode.toUpperCase() + ' 2D'} — ${selectedProject?.projectName || 'BIM'}`}
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
                        className="flex-1 flex flex-col relative"
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
                                    cursor: pendingElement || isSelectMode || lineDrawMode === 'click' || measureMode ? 'crosshair' : walkMode ? 'move' : 'default',
                                }}
                            >
                                <>
                                    <div ref={mainViewRef} className="absolute inset-0 z-10 touch-none" />

                                    {/* 전체화면 토글 버튼 */}
                                    <button
                                        onClick={toggleBimFs}
                                        title={bimFs ? t('exitFullscreen') : t('enterFullscreen')}
                                        className="absolute top-3 right-3 z-20 flex items-center justify-center rounded-lg transition-all sm:hidden"
                                        style={{
                                            width: 38, height: 38,
                                            backgroundColor: bimFs ? 'rgba(30,58,95,0.95)' : 'rgba(6,16,26,0.85)',
                                            border: `1px solid ${bimFs ? '#3b82f6' : '#253347'}`,
                                            color: bimFs ? '#60a5fa' : '#8896a4',
                                            backdropFilter: 'blur(4px)',
                                            fontSize: 18,
                                        }}
                                    >
                                        {bimFs ? '⊠' : '⛶'}
                                    </button>

                                    <Canvas
                                        eventSource={mainViewRef}
                                        className="!absolute inset-0 rounded-xl pointer-events-none z-0"
                                        camera={{ position: [15, 12, 15], up: [0, 0, 1], fov: 55 }}
                                        shadows
                                        onPointerMissed={() => {
                                            if (!isSelectMode) {
                                                setSelectedElement(null);
                                                setSelectedElements(new Set());
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
                                            multiSelectedLineIds={multiSelectedLineIds}
                                            onLineSelect={(id) => {
                                                setSelectedLineId(id);
                                                setMultiSelectedLineIds(new Set());
                                                if (id) {
                                                    setShowLeftPanel(true);
                                                    setSelectedElement(null);
                                                    setSelectedElements(new Set());
                                                }
                                            }}
                                            onLineMultiSelect={handleLineMultiSelect}
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
                                            measureMode={measureMode}
                                            measurePointA={measurePoints.a}
                                            measurePointB={measurePoints.b}
                                            onMeasureClick={handleMeasureClick}
                                            showDimensions={showDimensions}
                                            sectionCutEnabled={sectionCutEnabled}
                                            sectionCutAxis={sectionCutAxis}
                                            sectionCutValue={sectionCutValue}
                                            walkMode={walkMode}
                                            onWalkModeExit={() => setWalkMode(false)}
                                            orbitTargetRef={orbitTargetRef}
                                        />
                                        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                                            <GizmoViewport axisColors={['#ff4060', '#80ff80', '#2080ff']} labelColor="white"/>
                                        </GizmoHelper>
                                    </Canvas>

                                    {viewMode === '3d' && (
                                        <div className="absolute bottom-16 left-3 z-20 pointer-events-auto flex flex-col gap-1 hidden sm:flex">
                                            {[
                                                { id: 'iso',   label: 'ISO',  title: '등각뷰' },
                                                { id: 'top',   label: 'TOP',  title: '평면도' },
                                                { id: 'front', label: 'FRT',  title: '정면도' },
                                                { id: 'right', label: 'RGT',  title: '우측면도' },
                                            ].map(({ id, label, title }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => applyViewPreset(id)}
                                                    title={title}
                                                    className={`w-10 h-8 rounded text-xs font-bold transition-all ${
                                                        viewPreset?.id === id
                                                            ? 'bg-blue-600/80 text-white border border-blue-400'
                                                            : 'bg-space-800/80 text-gray-400 border border-space-600 hover:bg-space-700/80'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {viewMode === '3d' && (
                                        <>
                                            <div
                                                ref={minimapContainerRef}
                                                className="absolute top-3 right-3 w-40 h-40 border border-space-500 rounded-xl overflow-hidden shadow-2xl z-20 pointer-events-auto hidden sm:block"
                                                style={{ cursor: 'crosshair' }}
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
                                        </>
                                    )}

                                    {viewMode !== '3d' && (
                                        <div className="absolute top-3 left-3 z-20 bg-space-900/80 border border-emerald-700/60 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-semibold pointer-events-none">
                                            {viewMode === 'xy' ? t('viewXYLabel') : viewMode === 'xz' ? t('viewXZLabel') : t('viewYZLabel')}
                                        </div>
                                    )}

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
                                            }}
                                        />
                                    )}

                                    {selectedElement && (
                                        <div className="absolute bottom-3 left-3 bg-space-900/80 border border-space-700 rounded-lg px-3 py-2 text-xs text-gray-300 z-20">
                                            <span className="text-orange-400 font-bold">{selectedElement.data.elementType}</span>
                                            <span className="ml-2 text-gray-500">{selectedElement.data.elementId}</span>
                                        </div>
                                    )}

                                    {/* 단면 절단 컨트롤 */}
                                    {sectionCutEnabled && (
                                        <div className="absolute top-3 left-3 z-30 bg-space-900/95 border border-orange-600/50 rounded-xl px-3 py-2.5 shadow-xl pointer-events-auto"
                                             style={{ minWidth: 190, maxWidth: 'calc(100% - 1.5rem)' }}>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="text-orange-300 text-xs font-bold">{t('sectionCutTitle')}</span>
                                                <button onClick={() => setSectionCutEnabled(false)} className="ml-auto text-gray-500 hover:text-white text-xs">✕</button>
                                            </div>
                                            <div className="flex gap-1 mb-2">
                                                {[['x', t('sectionAxisX')], ['y', t('sectionAxisY')], ['z', t('sectionAxisZ')]].map(([a, lbl]) => (
                                                    <button key={a} onClick={() => setSectionCutAxis(a)}
                                                        className={`flex-1 py-0.5 rounded text-xs font-bold border transition ${sectionCutAxis===a?'bg-orange-600/60 text-orange-200 border-orange-500':'bg-space-700 text-gray-400 border-space-600'}`}
                                                    >{lbl}</button>
                                                ))}
                                            </div>
                                            <input type="range" min="-30" max="30" step="0.1"
                                                value={sectionCutValue}
                                                onChange={e => setSectionCutValue(parseFloat(e.target.value))}
                                                className="w-full accent-orange-500"
                                            />
                                            <div className="text-center text-xs text-gray-400 mt-1">{sectionCutValue.toFixed(1)} m</div>
                                        </div>
                                    )}

                                    {/* Walk 모드 안내 */}
                                    {walkMode && (
                                        <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 bg-green-900/90 border border-green-600/60 rounded-xl px-3 py-2 shadow-xl pointer-events-auto"
                                             style={{ maxWidth: 'calc(100% - 1.5rem)', width: 'max-content' }}>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-green-300 text-xs font-bold shrink-0">{t('walkModeTitle')}</span>
                                                <span className="text-gray-400 text-xs hidden sm:inline">{t('walkModeHint')}</span>
                                                <button onClick={() => setWalkMode(false)} className="text-gray-500 hover:text-white text-xs shrink-0">✕ ESC</button>
                                            </div>
                                        </div>
                                    )}

                                    {/* 측정 모드 상태 표시 */}
                                    {measureMode && (
                                        <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 bg-yellow-900/90 border border-yellow-600/60 rounded-xl px-3 py-2 shadow-xl pointer-events-auto"
                                             style={{ maxWidth: 'calc(100% - 1.5rem)', width: 'max-content' }}>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-yellow-300 text-xs font-bold shrink-0">{t('measureModeTitle')}</span>
                                                <span className="text-gray-400 text-xs">
                                                    {!measurePoints.a ? t('measureClickFirst') : !measurePoints.b ? t('measureClickSecond') : t('measureDone')}
                                                </span>
                                                <button onClick={() => { setMeasureMode(false); setMeasurePoints({a:null,b:null}); }} className="text-gray-500 hover:text-white text-xs shrink-0">✕</button>
                                            </div>
                                        </div>
                                    )}

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
                                </>
                            </div>
                        )}
                    </Card>
                </div>

                {showLayerPanel && isDesktop && (
                    <div
                        onMouseDown={(e) => handlePanelDragStart('right', e)}
                        onTouchStart={(e) => handlePanelDragStart('right', e)}
                        className="hidden md:flex items-center justify-center shrink-0 z-10 group"
                        style={{ width: 10, cursor: 'col-resize', touchAction: 'none' }}
                    >
                        <div
                            className="h-16 rounded-full"
                            style={{ width: 3, backgroundColor: '#334155' }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#14b8a6'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#334155'}
                        />
                    </div>
                )}

                {(showLayerPanel || layerClosing) && (
                    <>
                    {/* 모바일: 배경 딤 */}
                    {!isDesktop && (
                        <div
                            className={layerClosing ? 'bim-panel-dim-out' : 'bim-panel-dim'}
                            onClick={closeLayerPanel}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 49,
                                backgroundColor: 'rgba(0,0,0,0.55)',
                                backdropFilter: 'blur(2px)',
                            }}
                        />
                    )}
                    <div
                        className={`shrink-0 flex flex-col min-h-0 overflow-y-auto modal-scroll${!isDesktop ? (layerClosing ? ' bim-panel-right-out' : ' bim-panel-right') : ''}`}
                        onAnimationEnd={() => {
                            if (layerClosing) { setShowLayerPanel(false); setLayerClosing(false); }
                        }}
                        style={isDesktop
                            ? { width: `${rightPanelPct}%`, minWidth: 120, paddingLeft: 6 }
                            : {
                                position: 'fixed', right: 0, top: 0, bottom: 0,
                                width: '82vw', maxWidth: 320,
                                zIndex: 50,
                                backgroundColor: '#080f1a',
                                borderLeft: '1px solid #1e3a5f',
                                padding: '0 0 32px 0',
                                boxShadow: '-6px 0 32px rgba(0,0,0,0.7)',
                            }
                        }
                    >
                    {/* 모바일 레이어 패널 헤더 */}
                    {!isDesktop && (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '14px 16px 10px',
                            borderBottom: '1px solid #1e3a5f',
                            position: 'sticky', top: 0, zIndex: 1,
                            backgroundColor: '#080f1a',
                        }}>
                            <span style={{ color: '#5eead4', fontSize: 13, fontWeight: 700 }}>
                                🗂 {t('layerManager')}
                            </span>
                            <button
                                onClick={closeLayerPanel}
                                style={{
                                    width: 28, height: 28, borderRadius: 6,
                                    backgroundColor: '#1c2a3a', border: '1px solid #253347',
                                    color: '#8896a4', fontSize: 14, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >✕</button>
                        </div>
                    )}
                    <div className={isDesktop ? 'flex flex-col gap-3' : 'flex flex-col gap-3 px-3 pt-2'}>
                        <Card
                            title={isDesktop ? t('layerManager') : ''}
                            right={<Chip color="green">{layers.length + (lines.length > 0 ? 1 : 0)} {t('itemsUnit')}</Chip>}
                        >
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
                                onSelectLine={(lineId) => { setSelectedLineId(lineId); }}
                                selectedLineId={selectedLineId}
                            />
                        </Card>

                        <Card title={t('elementList')} right={<Chip color="green">{t('liveChip')}</Chip>} className="shrink-0">
                            <p className="text-xs text-gray-600 mb-2">{t('tapToSelectAll')}</p>
                            <CardGridWrapper>
                                {['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcSlab', 'IfcPier', 'IfcRebar'].map(type => {
                                    const matching = modelData.filter(e => e.elementType === type);
                                    const count = matching.length;
                                    const isAllSelected = count > 0 && matching.every(e => selectedElements.has(e.elementId));
                                    return (
                                        <div
                                            key={type}
                                            onClick={() => {
                                                if (count === 0) return;
                                                setSelectedElement(null);
                                                setSelectedElements(new Set(matching.map(e => e.elementId)));
                                            }}
                                            className="rounded-lg p-2 flex flex-col items-center gap-0.5 transition-all"
                                            style={{
                                                backgroundColor: isAllSelected ? 'rgba(59,130,246,0.25)' : 'rgba(51,65,85,0.6)',
                                                border: isAllSelected ? '1px solid #3b82f6' : '1px solid transparent',
                                                cursor: count > 0 ? 'pointer' : 'default',
                                                opacity: count === 0 ? 0.4 : 1,
                                            }}
                                        >
                                            <span className="text-xs truncate w-full text-center"
                                                  style={{ color: isAllSelected ? '#93c5fd' : '#9ca3af' }}>
                                                {type.replace('Ifc', '')}
                                            </span>
                                            <span className="text-lg font-bold"
                                                  style={{ color: isAllSelected ? '#60a5fa' : '#f1f5f9' }}>
                                                {count}
                                            </span>
                                        </div>
                                    );
                                })}
                            </CardGridWrapper>
                        </Card>
                    </div>{/* end content wrapper */}
                    </div>{/* end panel overlay div */}
                    </>
                )}{/* end showLayerPanel */}
            </div>

            {/* BIM Agent Chat — 구조 안정성 검토 & WBS 스케줄링 */}
            {bimSubView === 'editor' && selectedProject && (
                <BimAgentChat
                    selectedProject={selectedProject}
                    onShowStructural={() => setBimSubView('structural')}
                />
            )}
        </div>
    );
}