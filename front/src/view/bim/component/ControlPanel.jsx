import React from 'react';

/**
 * BIM 요소 생성 및 편집 모드를 제어하는 외부 컨트롤 패널 컴포넌트입니다.
 * * @param {function} addNewElement - 새로운 BIM 요소를 모델에 추가하는 함수
 * @param {string} currentMode - 현재 TransformControls의 모드 ('translate', 'rotate', 'scale')
 * @param {function} setMode - TransformControls의 모드를 설정하는 함수
 */
export default function ControlPanel({ addNewElement, currentMode, setMode }) {
    
    // 새 요소 추가 시 사용할 기본 데이터 템플릿
    const elementTemplates = {
        'IfcColumn': {
            elementType: 'IfcColumn',
            material: 'Steel Grade B',
            positionData: '[0, 0, 0]',
            sizeData: '[0.5, 6.0, 0.5]',
            projectId: 'P-NEW',
        },
        'IfcBeam': {
            elementType: 'IfcBeam',
            material: 'Concrete C40',
            positionData: '[0, 6.0, 0]', // 기둥 위에 배치되도록 기본 위치 설정
            sizeData: '[1.0, 0.5, 8.0]',
            projectId: 'P-NEW',
        },
        'IfcWall': {
            elementType: 'IfcWall',
            material: 'Concrete C30',
            positionData: '[-10, 3, 0]',
            sizeData: '[0.2, 6.0, 20.0]',
            projectId: 'P-NEW',
        }
    };

    return (
        <div className="space-y-4 p-4 border-b border-space-700">
            <h3 className="text-lg font-semibold text-white">모델 편집 도구</h3>

            {/* A. 요소 생성 버튼 그룹 */}
            <div className="space-y-2">
                <p className="text-sm font-medium text-gray-400">새 요소 생성:</p>
                <div className="grid grid-cols-3 gap-2">
                    {Object.keys(elementTemplates).map(type => (
                        <button
                            key={type}
                            onClick={() => addNewElement(elementTemplates[type])}
                            className="p-2 text-xs rounded-lg bg-green-700/60 text-green-200 hover:bg-green-600/60 transition-colors"
                        >
                            {type.replace('Ifc', '')} 생성
                        </button>
                    ))}
                </div>
            </div>

            {/* B. 조작 모드 전환 그룹 */}
            <div className="space-y-2">
                <p className="text-sm font-medium text-gray-400">3D 조작 모드:</p>
                <div className="grid grid-cols-3 gap-2">
                    {['translate', 'rotate', 'scale'].map(mode => (
                        <button
                            key={mode}
                            onClick={() => setMode(mode)}
                            className={`p-2 text-xs rounded-lg transition-colors capitalize ${
                                currentMode === mode 
                                    ? 'bg-blue-600 text-white shadow-lg' 
                                    : 'bg-space-700/70 text-gray-300 hover:bg-space-600'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
