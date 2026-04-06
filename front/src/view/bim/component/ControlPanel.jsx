import React, { useState } from 'react';

/**
 * BIM 편집 도구 패널
 *
 * A. 부재 배치 — 클릭 시 "배치 모드"로 진입, 3D 뷰어에서 위치를 지정해 배치
 * B. 조작 모드 전환 — TransformControls 모드
 * C. 선택 모드 토글 — 러버밴드 드래그 다중 선택
 * D. 샘플 구조물 — 미리 정의된 구조물 일괄 배치
 */
export default function ControlPanel({
    startPlacement,
    pendingElement,
    cancelPlacement,
    currentMode,
    setMode,
    isSelectMode,
    toggleSelectMode,
    onPlaceSample,       // (elements) => void — 샘플 구조물 일괄 배치
    isPlacingSample,     // boolean — 샘플 배치 중
}) {

    const [showSamples, setShowSamples] = useState(false);

    const elementTemplates = [
        {
            label: '기둥', icon: '▮',
            color: 'bg-yellow-800/50 text-yellow-200 hover:bg-yellow-700/60',
            activeColor: 'bg-yellow-600/70 text-yellow-100 ring-1 ring-yellow-400',
            data: {
                elementType: 'IfcColumn', material: 'Concrete C30',
                sizeX: 0.5, sizeY: 6.0, sizeZ: 0.5,
            },
        },
        {
            label: '보', icon: '━',
            color: 'bg-gray-700/60 text-gray-200 hover:bg-gray-600/70',
            activeColor: 'bg-gray-500/70 text-white ring-1 ring-gray-300',
            data: {
                elementType: 'IfcBeam', material: 'Steel Grade A',
                sizeX: 8.0, sizeY: 0.5, sizeZ: 0.3,
            },
        },
        {
            label: '벽', icon: '▬',
            color: 'bg-slate-700/60 text-slate-200 hover:bg-slate-600/70',
            activeColor: 'bg-slate-500/70 text-white ring-1 ring-slate-300',
            data: {
                elementType: 'IfcWall', material: 'Concrete C25',
                sizeX: 0.2, sizeY: 3.0, sizeZ: 5.0,
            },
        },
        {
            label: '슬래브', icon: '▭',
            color: 'bg-blue-900/50 text-blue-200 hover:bg-blue-800/60',
            activeColor: 'bg-blue-600/70 text-white ring-1 ring-blue-400',
            data: {
                elementType: 'IfcSlab', material: 'Concrete C30',
                sizeX: 8.0, sizeY: 0.25, sizeZ: 8.0,
            },
        },
        {
            label: '교각', icon: '⬛',
            color: 'bg-orange-900/50 text-orange-200 hover:bg-orange-800/60',
            activeColor: 'bg-orange-600/70 text-white ring-1 ring-orange-400',
            data: {
                elementType: 'IfcPier', material: 'Concrete C50',
                sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0,
            },
        },
    ];

    const modes = [
        { key: 'translate', label: '이동', icon: '✥', shortcut: 'T' },
        { key: 'rotate',    label: '회전', icon: '↺', shortcut: 'R' },
        { key: 'scale',     label: '크기', icon: '⤢', shortcut: 'S' },
    ];

    // ── 샘플 구조물 정의 ─────────────────────────────────────────
    const sampleStructures = [
        {
            label: '단층 건물 골조',
            icon: '🏢',
            desc: '기둥 4개 + 보 4개 + 슬래브',
            color: 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50',
            elements: [
                // 기둥 4개 (모서리)
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX: -4,  positionY: 0, positionZ: -4 },
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX:  4,  positionY: 0, positionZ: -4 },
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX: -4,  positionY: 0, positionZ:  4 },
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX:  4,  positionY: 0, positionZ:  4 },
                // 보 4개 (테두리, sizeY 기준 top)
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 8.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0,  positionY: 3.8, positionZ: -4 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 8.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0,  positionY: 3.8, positionZ:  4 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 8.5, positionX: -4,  positionY: 3.8, positionZ:  0 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 8.5, positionX:  4,  positionY: 3.8, positionZ:  0 },
                // 슬래브
                { elementType: 'IfcSlab', material: 'Concrete C30', sizeX: 8.5, sizeY: 0.25, sizeZ: 8.5, positionX:  0,  positionY: 4.2, positionZ:  0 },
            ],
        },
        {
            label: '2경간 교량',
            icon: '🌉',
            desc: '교각 3개 + 상부 슬래브',
            color: 'bg-orange-900/40 text-orange-200 hover:bg-orange-800/50',
            elements: [
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 2.5, sizeY: 8.0, sizeZ: 2.5, positionX: -20, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 2.5, sizeY: 8.0, sizeZ: 2.5, positionX:   0, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 2.5, sizeY: 8.0, sizeZ: 2.5, positionX:  20, positionY: 0, positionZ: 0 },
                { elementType: 'IfcSlab', material: 'Prestressed Concrete', sizeX: 42.0, sizeY: 1.0, sizeZ: 10.0, positionX: 0, positionY: 8.0, positionZ: 0 },
            ],
        },
        {
            label: '라멘 교각',
            icon: '⛩',
            desc: '교각 기둥 2개 + 캡 빔',
            color: 'bg-violet-900/40 text-violet-200 hover:bg-violet-800/50',
            elements: [
                { elementType: 'IfcPier', material: 'Concrete C40', sizeX: 2.0, sizeY: 8.0, sizeZ: 2.0, positionX: -6, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C40', sizeX: 2.0, sizeY: 8.0, sizeZ: 2.0, positionX:  6, positionY: 0, positionZ: 0 },
                { elementType: 'IfcBeam', material: 'Concrete C40', sizeX: 14.0, sizeY: 1.5, sizeZ: 2.5, positionX: 0, positionY: 8.0, positionZ: 0 },
            ],
        },
        {
            label: '3경간 교량',
            icon: '🏗',
            desc: '교각 4개 + 긴 슬래브',
            color: 'bg-sky-900/40 text-sky-200 hover:bg-sky-800/50',
            elements: [
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX: -30, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX: -10, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX:  10, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX:  30, positionY: 0, positionZ: 0 },
                { elementType: 'IfcSlab', material: 'Prestressed Concrete', sizeX: 64.0, sizeY: 1.2, sizeZ: 12.0, positionX: 0, positionY: 10.0, positionZ: 0 },
            ],
        },
        {
            label: '2층 건물 골조',
            icon: '🏬',
            desc: '기둥 4개 + 보 8개 + 슬래브 2개',
            color: 'bg-teal-900/40 text-teal-200 hover:bg-teal-800/50',
            elements: [
                // 기둥 4개 (2층 높이)
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX: -5, positionY: 0, positionZ: -5 },
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX:  5, positionY: 0, positionZ: -5 },
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX: -5, positionY: 0, positionZ:  5 },
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX:  5, positionY: 0, positionZ:  5 },
                // 1층 보 4개
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 3.8, positionZ: -5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 3.8, positionZ:  5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX: -5, positionY: 3.8, positionZ:  0 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX:  5, positionY: 3.8, positionZ:  0 },
                // 1층 슬래브
                { elementType: 'IfcSlab', material: 'Concrete C30', sizeX: 10.5, sizeY: 0.25, sizeZ: 10.5, positionX: 0, positionY: 4.2, positionZ: 0 },
                // 2층 보 4개
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 7.8, positionZ: -5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 7.8, positionZ:  5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX: -5, positionY: 7.8, positionZ:  0 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX:  5, positionY: 7.8, positionZ:  0 },
                // 2층 슬래브 (지붕)
                { elementType: 'IfcSlab', material: 'Concrete C30', sizeX: 10.5, sizeY: 0.25, sizeZ: 10.5, positionX: 0, positionY: 8.2, positionZ: 0 },
            ],
        },
    ];

    return (
        <div className="space-y-4">

            {/* A. 부재 배치 버튼 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-400">새 부재 배치</p>
                    {pendingElement && (
                        <button
                            onClick={cancelPlacement}
                            className="text-xs text-red-400 hover:text-red-300 transition px-1.5 py-0.5 rounded border border-red-700/50"
                        >
                            ✕ 취소
                        </button>
                    )}
                </div>

                <div className="flex flex-col gap-1.5">
                    {elementTemplates.map(({ label, icon, color, activeColor, data }) => {
                        const isActive = pendingElement?.elementType === data.elementType;
                        return (
                            <button
                                key={data.elementType}
                                onClick={() =>
                                    isActive ? cancelPlacement() : startPlacement(data)
                                }
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                    isActive ? activeColor : color
                                }`}
                                title={isActive ? '배치 모드 취소' : `${label} 배치 시작`}
                            >
                                <span className="text-base leading-none">{icon}</span>
                                <span>{label}</span>
                                {isActive ? (
                                    <span className="ml-auto text-xs animate-pulse">📍 배치 중</span>
                                ) : (
                                    <span className="ml-auto text-xs opacity-40">{data.elementType.replace('Ifc', '')}</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {pendingElement && (
                    <p className="mt-2 text-xs text-blue-400 leading-relaxed">
                        3D 뷰어를 클릭하여 배치 &nbsp;•&nbsp; <kbd className="bg-black/30 px-1 rounded">ESC</kbd> 취소
                    </p>
                )}
            </div>

            {/* B. 조작 모드 */}
            <div className="border-t border-space-700 pt-3">
                <p className="text-xs font-medium text-gray-400 mb-2">조작 모드</p>
                <div className="flex flex-col gap-1.5">
                    {modes.map(({ key, label, icon, shortcut }) => (
                        <button
                            key={key}
                            onClick={() => setMode(key)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                currentMode === key
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                                    : 'bg-space-700/70 text-gray-300 hover:bg-space-600'
                            }`}
                        >
                            <span className="text-base leading-none">{icon}</span>
                            <span>{label}</span>
                            <kbd className="ml-auto text-xs bg-black/30 px-1 py-0.5 rounded opacity-60">{shortcut}</kbd>
                        </button>
                    ))}
                </div>
            </div>

            {/* C. 선택 모드 (러버밴드) */}
            <div className="border-t border-space-700 pt-3">
                <p className="text-xs font-medium text-gray-400 mb-2">다중 선택</p>
                <button
                    onClick={toggleSelectMode}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isSelectMode
                            ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/40'
                            : 'bg-space-700/70 text-gray-300 hover:bg-space-600'
                    }`}
                >
                    <span className="text-base leading-none">⬚</span>
                    <span>선택 모드</span>
                    <kbd className="ml-auto text-xs bg-black/30 px-1 py-0.5 rounded opacity-60">Q</kbd>
                </button>
                {isSelectMode ? (
                    <p className="mt-1.5 text-xs text-violet-400 leading-relaxed">
                        드래그로 영역 선택 &nbsp;•&nbsp; <kbd className="bg-black/30 px-1 rounded">Shift</kbd>+클릭 추가
                    </p>
                ) : (
                    <p className="mt-1.5 text-xs text-gray-600">
                        <kbd className="bg-black/30 px-1 rounded">Shift</kbd>+클릭으로 추가 선택
                    </p>
                )}
            </div>

            {/* D. 샘플 구조물 */}
            <div className="border-t border-space-700 pt-3">
                <button
                    onClick={() => setShowSamples(v => !v)}
                    className="w-full flex items-center justify-between mb-2 group"
                >
                    <p className="text-xs font-medium text-gray-400 group-hover:text-gray-200 transition">
                        샘플 구조물
                    </p>
                    <span className="text-xs text-gray-600 group-hover:text-gray-400 transition">
                        {showSamples ? '▲' : '▼'}
                    </span>
                </button>

                {showSamples && (
                    <div className="flex flex-col gap-1.5">
                        {sampleStructures.map(({ label, icon, desc, color, elements }) => (
                            <button
                                key={label}
                                onClick={() => onPlaceSample?.(elements)}
                                disabled={isPlacingSample}
                                className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left disabled:opacity-50 ${color}`}
                                title={desc}
                            >
                                <span className="text-base leading-none mt-0.5 shrink-0">{icon}</span>
                                <div className="min-w-0">
                                    <div className="font-semibold truncate">{label}</div>
                                    <div className="text-xs opacity-60 truncate">{desc}</div>
                                </div>
                                {isPlacingSample && (
                                    <span className="ml-auto shrink-0 animate-pulse text-xs">배치 중...</span>
                                )}
                            </button>
                        ))}
                        <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                            클릭하면 원점(0,0,0) 기준으로 배치됩니다
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
