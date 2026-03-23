import React, { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera, View } from '@react-three/drei';
import * as THREE from 'three';
import { parseVectorData, getBaseColor } from './element/BimElement';
import Scene from './component/Scene';
import ControlPanel from './component/ControlPanel';
import BimDashboardAPI from './BimDashboardAPI';

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
        gray:   "bg-gray-800 text-gray-300 border-gray-700",
    };
    return <span className={`px-2 py-0.5 text-xs border rounded-md ${map[color]}`}>{children}</span>;
}

// ================================================================
// 미니맵 컴포넌트
// ================================================================

function MiniMapElement({ element }) {
    const { size, position } = useMemo(() => {
        const rawSize = [
            Number(element.sizeX) || 1,
            Number(element.sizeY) || 1,
            Number(element.sizeZ) || 1,
        ];
        const rawPos = [
            Number(element.positionX) || 0,
            0.1,
            Number(element.positionZ) || 0,
        ];
        return { size: rawSize, position: rawPos };
    }, [element]);

    return (
        <mesh position={position}>
            <boxGeometry args={[size[0], 0.1, size[2]]} />
            <meshBasicMaterial color={getBaseColor(element.elementType)} />
        </mesh>
    );
}

function CameraMarker({ position }) {
    if (!position || isNaN(position.x)) return null;
    return (
        <mesh position={[position.x, 0.2, position.z]}>
            <circleGeometry args={[1.5, 32]} rotation-x={-Math.PI / 2} />
            <meshBasicMaterial color="#3b82f6" />
        </mesh>
    );
}

function MiniMap({ modelData, mainCameraPosition, minimapContainerElement }) {
    if (!minimapContainerElement) return null;
    return (
        <View index={1} track={minimapContainerElement}>
            <OrthographicCamera makeDefault position={[0, 50, 0]} rotation={[-Math.PI / 2, 0, 0]} zoom={3} near={0.1} far={200} />
            <color attach="background" args={['#1e293b']} />
            {modelData.map(el => <MiniMapElement key={el.elementId} element={el} />)}
            <CameraMarker position={mainCameraPosition} />
        </View>
    );
}

// ================================================================
// 재료 데이터 (Revit Material Library 스타일)
// ================================================================

/**
 * 부재 유형별 사용 가능한 재료 목록
 * Revit의 재료 라이브러리에서 구조 재료를 분류한 방식과 유사
 */
const MATERIAL_OPTIONS = {
    Concrete: [
        'Concrete C20', 'Concrete C25', 'Concrete C30', 'Concrete C35',
        'Concrete C40', 'Concrete C50', 'Prestressed Concrete',
        'High-Strength Concrete C60',
    ],
    Steel: [
        'Steel Grade A', 'Steel Grade B', 'Steel SS400',
        'Steel SHN275', 'Steel SHN355', 'Stainless Steel',
    ],
    Timber: ['Pine LVL', 'Oak', 'Glulam GL28h', 'CLT'],
    Composite: ['Steel-Concrete Composite', 'FRP', 'Carbon Fiber'],
};

// 재료명에 따른 색상 (3D 뷰어에서 재료별 시각화)
const MATERIAL_COLORS = {
    'Concrete': '#b0b0a0',
    'Steel':    '#a0b8d0',
    'Timber':   '#c8a060',
    'Composite':'#80c0a0',
};

// ================================================================
// PropertyPanel - Revit 속성 창 스타일
// ================================================================

/**
 * 선택된 부재의 속성 편집 패널 (Revit의 Properties 창과 유사)
 *
 * 기능:
 * - 부재 유형 표시 (IFC 타입 칩)
 * - 재료 드롭다운 (카테고리별 그룹핑)
 * - 치수 입력 (폭/높이/깊이, 위치 X/Y/Z)
 * - 실시간 3D 반영 (onChange 즉시 updateElementData 호출)
 * - 저장(Save) / 삭제(Delete) 버튼
 */
function PropertyPanel({ selectedElement, updateElementData, saveUpdateElement, deleteSelectedElement }) {
    const [form, setForm] = useState({
        material: '', posX: 0, posY: 0, posZ: 0, sizeX: 1, sizeY: 1, sizeZ: 1,
    });

    // selectedElement 변경 시 폼 초기화
    useEffect(() => {
        if (!selectedElement?.data) return;
        const d = selectedElement.data;
        const n = (v, def = 0) => (v !== undefined && v !== null ? Number(v) : def);
        setForm({
            material: d.material || '',
            posX:  n(d.positionX),
            posY:  n(d.positionY),
            posZ:  n(d.positionZ),
            sizeX: n(d.sizeX, 1),
            sizeY: n(d.sizeY, 1),
            sizeZ: n(d.sizeZ, 1),
        });
    }, [selectedElement]);

    if (!selectedElement) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm p-4 text-center">
                <div className="text-3xl mb-2">🏗️</div>
                <p>3D 뷰어에서 부재를 클릭하여 속성을 편집하세요</p>
                <p className="text-xs mt-2 text-gray-600">또는 좌측 패널에서 새 부재를 생성하세요</p>
            </div>
        );
    }

    const el = selectedElement.data;

    // 부재 타입에 따른 칩 색상
    const typeColor = {
        IfcColumn: 'brown', IfcBeam: 'gray', IfcWall: 'gray',
        IfcSlab: 'blue', IfcPier: 'orange',
    }[el.elementType] ?? 'gray';

    // 입력 변경 → 로컬 폼 + 3D 뷰어 즉시 반영
    const handleChange = (field, value) => {
        const isNum = field !== 'material';
        const parsed = isNum ? (parseFloat(value) || 0) : value;
        const next = { ...form, [field]: parsed };
        setForm(next);

        // 3D Scene 즉시 업데이트 (실시간 미리보기)
        updateElementData(el.elementId, {
            ...el,
            material:  next.material,
            positionX: next.posX, positionY: next.posY, positionZ: next.posZ,
            sizeX:     next.sizeX, sizeY: next.sizeY, sizeZ: next.sizeZ,
        });
    };

    // 입력 필드 공통 스타일
    const inputCls = "w-full rounded-md border border-space-600 bg-space-700/80 px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none";

    return (
        <div className="space-y-4 overflow-y-auto">
            {/* 부재 타입 헤더 */}
            <div className="flex items-center gap-2">
                <Chip color={typeColor}>{el.elementType?.replace('Ifc', '') ?? '?'}</Chip>
                <span className="text-xs text-gray-500 truncate">ID: {el.elementId}</span>
            </div>

            {/* ── 재료 선택 ── */}
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">재료 (Material)</label>
                {/* 카테고리별 grouped select — Revit 재료 라이브러리와 유사한 구조 */}
                <select
                    value={form.material}
                    onChange={e => handleChange('material', e.target.value)}
                    className={inputCls}
                >
                    <option value="">-- 재료 선택 --</option>
                    {Object.entries(MATERIAL_OPTIONS).map(([group, items]) => (
                        <optgroup key={group} label={group}>
                            {items.map(m => <option key={m} value={m}>{m}</option>)}
                        </optgroup>
                    ))}
                </select>
                {/* 재료를 직접 입력할 수도 있도록 텍스트 필드도 제공 */}
                <input
                    type="text"
                    placeholder="또는 직접 입력..."
                    value={form.material}
                    onChange={e => handleChange('material', e.target.value)}
                    className={`${inputCls} mt-1 text-xs`}
                />
            </div>

            {/* ── 치수 입력 (Revit의 Properties > Dimensions) ── */}
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">치수 (m)</label>
                <div className="grid grid-cols-3 gap-1">
                    {/* W = sizeX (폭) */}
                    <div>
                        <span className="text-xs text-gray-500">폭 (W)</span>
                        <input type="number" step="0.01" min="0.01"
                            value={form.sizeX}
                            onChange={e => handleChange('sizeX', e.target.value)}
                            className={inputCls}
                        />
                    </div>
                    {/* H = sizeY (높이) */}
                    <div>
                        <span className="text-xs text-gray-500">높이 (H)</span>
                        <input type="number" step="0.01" min="0.01"
                            value={form.sizeY}
                            onChange={e => handleChange('sizeY', e.target.value)}
                            className={inputCls}
                        />
                    </div>
                    {/* D = sizeZ (깊이/두께) */}
                    <div>
                        <span className="text-xs text-gray-500">깊이 (D)</span>
                        <input type="number" step="0.01" min="0.01"
                            value={form.sizeZ}
                            onChange={e => handleChange('sizeZ', e.target.value)}
                            className={inputCls}
                        />
                    </div>
                </div>
            </div>

            {/* ── 위치 입력 (Revit의 Properties > Constraints) ── */}
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">위치 (m)</label>
                <div className="grid grid-cols-3 gap-1">
                    {['posX', 'posY', 'posZ'].map((f, i) => (
                        <div key={f}>
                            <span className="text-xs text-gray-500">{['X', 'Y', 'Z'][i]}</span>
                            <input type="number" step="0.1"
                                value={form[f]}
                                onChange={e => handleChange(f, e.target.value)}
                                className={inputCls}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* ── 액션 버튼 ── */}
            <div className="flex gap-2 pt-2">
                {/* 저장: 서버 PUT 요청 */}
                <button
                    onClick={saveUpdateElement}
                    className="flex-1 rounded-md bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition"
                >
                    💾 저장
                </button>
                {/* 삭제: 서버 DELETE 후 로컬에서도 제거 */}
                <button
                    onClick={deleteSelectedElement}
                    className="px-3 py-2 rounded-md bg-red-700/60 text-red-300 hover:bg-red-600/80 transition text-xs font-semibold"
                >
                    🗑 삭제
                </button>
            </div>
        </div>
    );
}

// ================================================================
// 메인 BIM 대시보드
// ================================================================

/**
 * BIM 대시보드 — Revit-like 3D 뷰어 + 편집 환경
 *
 * 레이아웃:
 * - 좌측 (col-span-2): 편집 도구 패널 (부재 생성, 조작 모드, 속성 편집)
 * - 우측 (col-span-10): 3D 뷰어 + 미니맵
 *
 * 키보드 단축키:
 * - T: translate 모드
 * - R: rotate 모드
 * - S: scale 모드
 * - Delete: 선택 부재 삭제
 * - Escape: 선택 해제
 */
export default function BimDashboard({ setViceComponent, modelData, setModelData, selectedProject }) {
    const {
        saveUpdateElement,
        selectedElement, setSelectedElement,
        mainCameraPosition, setMainCameraPosition,
        isMiniMapReady, setIsMiniMapReady,
        minimapContainerRef,
        minimapTrackElement, setMinimapTrackElement,
        isLoading,
        handleElementSelect, updateElementData,
        transformMode, setTransformMode,
        addNewElement,
        deleteSelectedElement,
    } = BimDashboardAPI({ setViceComponent, modelData, setModelData, selectedProject });

    /**
     * 현재 프로젝트 ID
     * selectedProject(App에서 전달) → modelData 첫 부재 순서로 폴백
     * 빈 프로젝트(부재 0개)에서도 올바른 ID를 사용하기 위해 selectedProject를 우선
     */
    const currentProjectId = useMemo(
        () => selectedProject?.projectId ?? modelData?.[0]?.projectId ?? null,
        [selectedProject, modelData]
    );

    /**
     * 키보드 단축키 처리
     * Revit과 동일한 키 바인딩 적용
     */
    useEffect(() => {
        const onKeyDown = (e) => {
            // 입력 필드 포커스 중에는 단축키 비활성화
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
            if (e.key === 't' || e.key === 'T') setTransformMode('translate');
            if (e.key === 'r' || e.key === 'R') setTransformMode('rotate');
            if (e.key === 's' || e.key === 'S') setTransformMode('scale');
            if (e.key === 'Delete' || e.key === 'Backspace') deleteSelectedElement();
            if (e.key === 'Escape') setSelectedElement(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedElement, deleteSelectedElement, setTransformMode, setSelectedElement]);

    return (
        <div className="min-h-screen bg-space-900 p-4">
            {/* 헤더 */}
            <div className="flex items-center gap-4 mb-4">
                <button
                    className="text-gray-300 hover:text-white text-sm"
                    onClick={() => { setViceComponent(''); setModelData([]); }}
                >
                    ← 프로젝트 목록
                </button>
                <h2 className="text-xl font-light text-white">BIM 편집기</h2>
                <Chip color="blue">Edit Mode</Chip>
                {/* 키보드 단축키 안내 */}
                <span className="text-xs text-gray-600 ml-auto">
                    T: 이동 &nbsp;|&nbsp; R: 회전 &nbsp;|&nbsp; S: 크기 &nbsp;|&nbsp; Del: 삭제 &nbsp;|&nbsp; Esc: 선택 해제
                </span>
            </div>

            <div className="grid grid-cols-12 gap-4 h-[calc(100vh-7rem)]">

                {/* ── 좌측 편집 패널 (col-span-2) ── */}
                <div className="col-span-2 flex flex-col gap-4 h-full overflow-y-auto">

                    {/* 부재 생성 + 조작 모드 패널 */}
                    <Card title="편집 도구">
                        <ControlPanel
                            addNewElement={(template) => addNewElement(template, currentProjectId)}
                            currentMode={transformMode}
                            setMode={setTransformMode}
                        />
                    </Card>

                    {/* 속성 패널 (Revit Properties 창) */}
                    <Card
                        title="부재 속성"
                        right={
                            <Chip color={selectedElement ? 'orange' : 'gray'}>
                                {selectedElement ? 'SELECTED' : 'NONE'}
                            </Chip>
                        }
                        className="flex-1"
                    >
                        <PropertyPanel
                            selectedElement={selectedElement}
                            updateElementData={updateElementData}
                            saveUpdateElement={saveUpdateElement}
                            deleteSelectedElement={deleteSelectedElement}
                        />
                    </Card>
                </div>

                {/* ── 우측 3D 뷰어 영역 (col-span-10) ── */}
                <div className="col-span-10 flex flex-col gap-4 h-full">

                    <Card
                        title={`3D BIM Viewer — ${currentProjectId ?? '프로젝트'} (부재 ${modelData.length}개)`}
                        right={
                            <div className="flex gap-2 items-center">
                                {/* 현재 조작 모드 표시 */}
                                <Chip color="orange">
                                    {transformMode === 'translate' ? '이동' : transformMode === 'rotate' ? '회전' : '크기'}
                                </Chip>
                                <Chip color="blue">Live</Chip>
                            </div>
                        }
                        className="flex-1 flex flex-col"
                    >
                        {isLoading ? (
                            <div className="flex flex-1 items-center justify-center text-gray-400">
                                <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                            </div>
                        ) : (
                            <div className="w-full flex-1 relative">
                                <Canvas
                                    camera={{ position: [15, 12, 15], fov: 55 }}
                                    shadows
                                    className="rounded-xl"
                                    onPointerMissed={() => setSelectedElement(null)}
                                >
                                    <Scene
                                        modelData={modelData}
                                        onElementSelect={handleElementSelect}
                                        selectedElement={selectedElement}
                                        updateElementData={updateElementData}
                                        setMainCameraPosition={setMainCameraPosition}
                                        transformMode={transformMode}
                                    />

                                    {/* 미니맵 오버레이 */}
                                    {isMiniMapReady && minimapTrackElement && (
                                        <MiniMap
                                            modelData={modelData}
                                            mainCameraPosition={mainCameraPosition}
                                            minimapContainerElement={minimapTrackElement}
                                        />
                                    )}
                                </Canvas>

                                {/* 미니맵 DOM 앵커 */}
                                <div
                                    ref={minimapContainerRef}
                                    className="absolute top-3 right-3 w-36 h-36 bg-space-900/90 border border-space-600 rounded-xl overflow-hidden shadow-2xl"
                                />

                                {/* 선택된 부재 정보 오버레이 (3D 뷰어 좌하단) */}
                                {selectedElement && (
                                    <div className="absolute bottom-3 left-3 bg-space-900/80 border border-space-700 rounded-lg px-3 py-2 text-xs text-gray-300">
                                        <span className="text-accent-orange font-bold">{selectedElement.data.elementType}</span>
                                        <span className="ml-2 text-gray-500">{selectedElement.data.elementId}</span>
                                        <span className="ml-3 text-gray-400">
                                            {selectedElement.data.material || '재료 미설정'}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>

                    {/* 구조 데이터 분석 패널 */}
                    <Card title="구조 데이터 분석" right={<Chip color="green">Live</Chip>} className="h-36">
                        <div className="grid grid-cols-4 gap-3 h-full">
                            {/* 부재 유형별 개수 집계 */}
                            {['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcSlab'].map(type => {
                                const count = modelData.filter(e => e.elementType === type).length;
                                return (
                                    <div key={type} className="bg-space-700/60 rounded-xl p-3 flex flex-col justify-between">
                                        <span className="text-xs text-gray-400">{type.replace('Ifc', '')}</span>
                                        <span className="text-2xl font-bold text-gray-100">{count}</span>
                                        <span className="text-xs text-gray-500">개</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
