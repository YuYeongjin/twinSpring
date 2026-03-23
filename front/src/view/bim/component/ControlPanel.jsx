import React from 'react';

/**
 * BIM 편집 도구 패널 (Revit의 구성요소 배치 + 수정 도구)
 *
 * 기능:
 * A. 부재 생성 — 클릭 시 서버에 POST 요청 후 3D 씬에 즉시 추가
 * B. 조작 모드 전환 — TransformControls 모드 변경
 *    - translate : 이동 (단축키 T)
 *    - rotate    : 회전 (단축키 R)
 *    - scale     : 크기 조정 (단축키 S)
 */
export default function ControlPanel({ addNewElement, currentMode, setMode }) {

    /**
     * 부재 생성 템플릿
     * Revit의 "패밀리 유형"에 해당 — 각 유형별 기본 치수와 재료를 정의
     * positionX/Y/Z: 원점(0,0,0)에 배치 후 사용자가 이동
     */
    const elementTemplates = [
        {
            label: '기둥',
            icon: '▮',
            color: 'bg-yellow-800/50 text-yellow-200 hover:bg-yellow-700/60',
            data: {
                elementType: 'IfcColumn',
                material: 'Concrete C30',
                positionX: 0, positionY: 0, positionZ: 0,
                sizeX: 0.5, sizeY: 6.0, sizeZ: 0.5,  // 500×6000×500 mm (기본 기둥)
            },
        },
        {
            label: '보',
            icon: '━',
            color: 'bg-gray-700/60 text-gray-200 hover:bg-gray-600/70',
            data: {
                elementType: 'IfcBeam',
                material: 'Steel Grade A',
                positionX: 0, positionY: 6.0, positionZ: 0,
                sizeX: 8.0, sizeY: 0.5, sizeZ: 0.3,  // 8000×500×300 mm
            },
        },
        {
            label: '벽',
            icon: '▬',
            color: 'bg-slate-700/60 text-slate-200 hover:bg-slate-600/70',
            data: {
                elementType: 'IfcWall',
                material: 'Concrete C25',
                positionX: 0, positionY: 0, positionZ: 0,
                sizeX: 0.2, sizeY: 3.0, sizeZ: 5.0,  // 200×3000×5000 mm
            },
        },
        {
            label: '슬래브',
            icon: '▭',
            color: 'bg-blue-900/50 text-blue-200 hover:bg-blue-800/60',
            data: {
                elementType: 'IfcSlab',
                material: 'Concrete C30',
                positionX: 0, positionY: 3.0, positionZ: 0,
                sizeX: 8.0, sizeY: 0.25, sizeZ: 8.0, // 8000×250×8000 mm
            },
        },
        {
            label: '교각',
            icon: '⬛',
            color: 'bg-orange-900/50 text-orange-200 hover:bg-orange-800/60',
            data: {
                elementType: 'IfcPier',
                material: 'Concrete C50',
                positionX: 0, positionY: 0, positionZ: 0,
                sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, // 3000×10000×3000 mm
            },
        },
    ];

    /** 조작 모드 목록 (Revit의 수정 도구 탭과 유사) */
    const modes = [
        { key: 'translate', label: '이동',   icon: '✥', shortcut: 'T' },
        { key: 'rotate',    label: '회전',   icon: '↺', shortcut: 'R' },
        { key: 'scale',     label: '크기',   icon: '⤢', shortcut: 'S' },
    ];

    return (
        <div className="space-y-4">

            {/* A. 부재 생성 버튼 그룹 */}
            <div>
                <p className="text-xs font-medium text-gray-400 mb-2">새 부재 배치</p>
                <div className="flex flex-col gap-1.5">
                    {elementTemplates.map(({ label, icon, color, data }) => (
                        <button
                            key={data.elementType}
                            onClick={() => addNewElement(data)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${color}`}
                        >
                            <span className="text-base leading-none">{icon}</span>
                            <span>{label}</span>
                            <span className="ml-auto text-xs opacity-50">{data.elementType.replace('Ifc', '')}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="border-t border-space-700 pt-3">
                {/* B. 조작 모드 전환 */}
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
                            {/* 키보드 단축키 표시 */}
                            <kbd className="ml-auto text-xs bg-black/30 px-1 py-0.5 rounded opacity-60">{shortcut}</kbd>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
