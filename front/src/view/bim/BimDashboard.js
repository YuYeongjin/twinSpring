import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { View } from '@react-three/drei';
import * as THREE from 'three';
import Scene from './component/Scene';
import ControlPanel from './component/ControlPanel';
import LayerPanel from './component/LayerPanel';
import BimDashboardAPI from './BimDashboardAPI';
import { ENV_PRESETS, DEFAULT_ENV_ID } from './component/SkyEnvironment';
import MiniMapCanvas from './component/MiniMapCanvas';

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
    } = BimDashboardAPI({ setViceComponent, modelData, setModelData, selectedProject });

    const mainViewRef = useRef(null);

    // ── 레이어 패널 표시 여부 ──────────────────────────────────────
    const [showLayerPanel, setShowLayerPanel] = useState(true);

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
            if (e.key === 'Escape') {
                if (pendingElement) { cancelPlacement(); }
                else if (isSelectMode) { toggleSelectMode(); }
                else { setSelectedElement(null); setSelectedElements(new Set()); }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedElement, pendingElement, isSelectMode, deleteSelectedElements,
        cancelPlacement, toggleSelectMode, setTransformMode, setSelectedElement, setSelectedElements]);

    return (
        <div className="min-h-screen bg-space-900 p-4">

            {/* ── 헤더 ── */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
                <button
                    className="text-gray-300 hover:text-white text-sm"
                    onClick={() => { setViceComponent('bim-projects'); setModelData([]); }}
                >
                    ← 프로젝트 목록
                </button>
                <h2 className="text-xl font-light text-white">BIM 편집기</h2>
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

                <div className="ml-auto flex items-center gap-2">
                    {/* 환경 선택 */}
                    <EnvSelector currentId={envId} onChange={setEnvId} />

                    {/* 레이어 패널 토글 */}
                    <button
                        onClick={() => setShowLayerPanel(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                            showLayerPanel
                                ? 'bg-teal-700/60 text-teal-300 border border-teal-600/60'
                                : 'bg-space-700/70 text-gray-400 border border-space-600'
                        }`}
                        title="레이어 패널 토글"
                    >
                        🗂 레이어
                        {layers.length > 0 && (
                            <span className="px-1 py-0.5 rounded-full text-xs bg-teal-600/40 text-teal-300">
                                {layers.length}
                            </span>
                        )}
                    </button>
                    <span className="text-xs text-gray-600 hidden xl:block">
                        T: 이동&nbsp;|&nbsp;R: 회전&nbsp;|&nbsp;S: 크기&nbsp;|&nbsp;Q: 선택모드&nbsp;|&nbsp;Del: 삭제&nbsp;|&nbsp;Esc: 취소
                    </span>
                </div>
            </div>

            {/* ── 배치 / 선택 모드 배너 ── */}
            {pendingElement && (
                <div className="mb-3 px-4 py-2 rounded-xl flex items-center gap-3 text-sm"
                     style={{ backgroundColor: '#1a2f4a', border: '1px solid #2a5080' }}>
                    <span className="text-blue-400 text-lg">📍</span>
                    <span className="text-blue-200 font-medium">
                        배치 모드 &nbsp;—&nbsp;
                        <span className="text-white">{pendingElement.elementType?.replace('Ifc','')}</span>
                    </span>
                    <span className="text-gray-400 text-xs">3D 뷰어를 클릭하면 해당 위치에 부재가 추가됩니다. 연속 배치 가능.</span>
                    <button onClick={cancelPlacement}
                            className="ml-auto text-xs px-2 py-1 rounded border border-blue-700/60 text-blue-400 hover:text-white transition">
                        ESC 취소
                    </button>
                </div>
            )}
            {isSelectMode && !pendingElement && (
                <div className="mb-3 px-4 py-2 rounded-xl flex items-center gap-3 text-sm"
                     style={{ backgroundColor: '#1f1040', border: '1px solid #5b21b6' }}>
                    <span className="text-violet-400 text-lg">⬚</span>
                    <span className="text-violet-200 font-medium">선택 모드</span>
                    <span className="text-gray-400 text-xs">3D 뷰어에서 드래그하여 영역 선택 &nbsp;•&nbsp; Shift+클릭으로 추가 선택</span>
                    {totalSelectedCount > 0 && (
                        <span className="text-violet-300 text-xs font-semibold">{totalSelectedCount}개 선택됨</span>
                    )}
                    <button onClick={toggleSelectMode}
                            className="ml-auto text-xs px-2 py-1 rounded border border-violet-700/60 text-violet-400 hover:text-white transition">
                        ESC / Q 해제
                    </button>
                </div>
            )}

            <div className="grid grid-cols-12 gap-4 h-[calc(100vh-7rem)]">

                {/* ── 좌측 편집 패널 ── */}
                <div className="col-span-2 flex flex-col gap-4 h-full overflow-y-auto" style={{ minWidth: 0 }}>
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
                                {selectedElement ? 'SELECTED' : totalSelectedCount > 1 ? `${totalSelectedCount}개` : 'NONE'}
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

                {/* ── 중앙 3D 뷰어 ── */}
                <div className={`${showLayerPanel ? 'col-span-7' : 'col-span-10'} flex flex-col gap-4 h-full`} style={{ minWidth: 0 }}>
                    <Card
                        title={`3D BIM Viewer — ${currentProjectId ?? '프로젝트'} (부재 ${modelData.length}개 / 표시 ${visibleModelData.length}개)`}
                        right={
                            <div className="flex gap-2 items-center">
                                <Chip color="orange">
                                    {transformMode === 'translate' ? '이동' : transformMode === 'rotate' ? '회전' : '크기'}
                                </Chip>
                                {pendingElement && <Chip color="blue">배치중</Chip>}
                                {isSelectMode   && <Chip color="violet">선택모드</Chip>}
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
                            <div className="w-full flex-1 relative"
                                 style={{ cursor: pendingElement ? 'crosshair' : isSelectMode ? 'crosshair' : 'default' }}>

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

                                {/* ── 배치 모드 커서 힌트 ── */}
                                {pendingElement && (
                                    <div className="absolute bottom-3 right-3 bg-space-900/80 border border-blue-700/60 rounded-lg px-3 py-2 text-xs text-blue-300 z-20 mr-40">
                                        클릭하여 배치 &nbsp;|&nbsp; <kbd className="bg-black/30 px-1 rounded">ESC</kbd> 취소
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                    {/* 구조 데이터 분석 */}
                    <Card title="구조 데이터 분석" right={<Chip color="green">Live</Chip>} className="h-36">
                        <div className="grid grid-cols-5 gap-3 h-full">
                            {['IfcColumn','IfcBeam','IfcWall','IfcSlab','IfcPier'].map(type => {
                                const count = modelData.filter(e => e.elementType === type).length;
                                return (
                                    <div key={type} className="bg-space-700/60 rounded-xl p-3 flex flex-col justify-between">
                                        <span className="text-xs text-gray-400">{type.replace('Ifc','')}</span>
                                        <span className="text-2xl font-bold text-gray-100">{count}</span>
                                        <span className="text-xs text-gray-500">개</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>

                {/* ── 우측 레이어 패널 ── */}
                {showLayerPanel && (
                    <div className="col-span-3 flex flex-col h-full overflow-hidden" style={{ minWidth: 0 }}>
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
                            className="flex-1 flex flex-col overflow-hidden"
                        >
                            <div className="flex-1 overflow-y-auto">
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
                    </div>
                )}
            </div>
        </div>
    );
}
