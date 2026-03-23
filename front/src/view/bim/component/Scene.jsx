import React, { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, TransformControls } from '@react-three/drei';
import { BimElement } from '../element/BimElement';

/**
 * BIM 3D 씬 컴포넌트
 *
 * Revit-like 기능:
 * - translate 모드: 부재 이동 (Revit의 이동 핸들)
 * - rotate  모드: 부재 회전 (Revit의 회전 핸들)
 * - scale   모드: 부재 크기 조정 (Revit의 치수 핸들)
 *
 * 조작 완료(pointerUp) 시 positionX/Y/Z 또는 sizeX/Y/Z를 서버에 반영
 */
export default function Scene({
    modelData,
    onElementSelect,
    selectedElement,
    updateElementData,
    setMainCameraPosition,
    transformMode,   // 'translate' | 'rotate' | 'scale'
}) {
    const { camera } = useThree();
    const controlsRef = useRef();

    // 미니맵용 카메라 위치 지속 업데이트
    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
    });

    /**
     * TransformControls 조작 완료 시 호출
     * - translate 모드: mesh.position → positionX/Y/Z 업데이트
     * - scale 모드:     mesh.scale × 원본 size → sizeX/Y/Z 업데이트
     */
    const handleTransformChange = (e) => {
        const mesh = e.target?.object;
        if (!mesh || !mesh.userData?.elementId) return;

        const elementId = mesh.userData.elementId;
        const element = modelData.find(el => el.elementId === elementId);
        if (!element) return;

        if (transformMode === 'translate') {
            // Y 위치: Three.js center Y → BIM bottom Y 변환
            const rawSize = mesh.userData.rawSize ?? [1, 1, 1];
            const bottomY = mesh.position.y - rawSize[1] / 2;

            updateElementData(elementId, {
                positionX: parseFloat(mesh.position.x.toFixed(3)),
                positionY: parseFloat(bottomY.toFixed(3)),
                positionZ: parseFloat(mesh.position.z.toFixed(3)),
            });
        } else if (transformMode === 'scale') {
            // scale 핸들로 늘인 비율 × 원본 크기 = 새 크기
            const rawSize = mesh.userData.rawSize ?? [1, 1, 1];
            updateElementData(elementId, {
                sizeX: parseFloat((rawSize[0] * mesh.scale.x).toFixed(3)),
                sizeY: parseFloat((rawSize[1] * mesh.scale.y).toFixed(3)),
                sizeZ: parseFloat((rawSize[2] * mesh.scale.z).toFixed(3)),
            });
            // scale을 1로 리셋 (rawSize에 반영했으므로)
            mesh.scale.set(1, 1, 1);
        }
    };

    // TransformControls가 활성화된 동안 OrbitControls 비활성화
    // (두 컨트롤이 동시에 마우스 이벤트를 받으면 충돌)
    useEffect(() => {
        const tc = controlsRef.current;
        if (!tc) return;
        const disableOrbit = () => { if (tc.orbit) tc.orbit.enabled = false; };
        const enableOrbit  = () => { if (tc.orbit) tc.orbit.enabled = true; };
        tc.addEventListener('dragging-changed', (e) => {
            // OrbitControls의 enabled를 직접 제어
            const orbitCtrl = document.querySelector('canvas')?.__r3f?.controls;
            if (orbitCtrl) orbitCtrl.enabled = !e.value;
        });
    }, [controlsRef.current]);

    return (
        <>
            {/* OrbitControls: 카메라 회전/줌/패닝 */}
            <OrbitControls enableZoom={true} makeDefault />
            <ambientLight intensity={0.5} />
            <spotLight position={[10, 15, 10]} angle={0.2} penumbra={1} castShadow intensity={1.2} />
            <directionalLight position={[-10, 10, -5]} intensity={0.4} />

            {/* TransformControls: 선택된 부재에 Revit-like 핸들 표시 */}
            {selectedElement?.meshRef?.current && (
                <TransformControls
                    ref={controlsRef}
                    object={selectedElement.meshRef.current}
                    mode={transformMode}          // translate / rotate / scale
                    onObjectChange={handleTransformChange}
                />
            )}

            {/* 씬의 모든 부재 렌더링 */}
            {modelData.map((element) => (
                <BimElement
                    key={element.elementId}
                    element={{
                        ...element,
                        selected: selectedElement?.data.elementId === element.elementId,
                    }}
                    onElementSelect={onElementSelect}
                />
            ))}

            {/* 바닥 그리드 (Revit 작업 평면과 유사) */}
            <gridHelper args={[100, 100, '#334155', '#1e293b']} position={[0, -0.01, 0]} />

            <Environment preset="city" />
        </>
    );
}
