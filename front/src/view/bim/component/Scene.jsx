import React, { useRef, useState, useEffect, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, TransformControls } from '@react-three/drei';
import { BimElement } from '../element/BimElement';

export default function Scene({
    modelData,
    onElementSelect,
    selectedElement,
    updateElementData,
    setMainCameraPosition,
    transformMode,
}) {
    const { camera } = useThree();
    const transformRef = useRef();
    const [isDragging, setIsDragging] = useState(false);

    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
    });

    // 💡 수정됨: 마우스 드래그가 끝났을 때 단 한 번만 호출되는 함수
    const handleTransformComplete = (mesh) => {
        if (!mesh || !mesh.userData?.elementId) return;

        const elementId = mesh.userData.elementId;
        const element = modelData.find(el => el.elementId === elementId);
        if (!element) return;

        if (transformMode === 'translate') {
            const rawSize = mesh.userData.rawSize ?? [1, 1, 1];
            const bottomY = mesh.position.y - rawSize[1] / 2;

            updateElementData(elementId, {
                positionX: parseFloat(mesh.position.x.toFixed(3)),
                positionY: parseFloat(bottomY.toFixed(3)),
                positionZ: parseFloat(mesh.position.z.toFixed(3)),
            });
        } else if (transformMode === 'scale') {
            const rawSize = mesh.userData.rawSize ?? [1, 1, 1];
            updateElementData(elementId, {
                sizeX: parseFloat((rawSize[0] * mesh.scale.x).toFixed(3)),
                sizeY: parseFloat((rawSize[1] * mesh.scale.y).toFixed(3)),
                sizeZ: parseFloat((rawSize[2] * mesh.scale.z).toFixed(3)),
            });
            mesh.scale.set(1, 1, 1);
        }
    };

    // 💡 수정됨: TransformControls의 이벤트 리스너를 useEffect로 안전하게 관리
    useEffect(() => {
        const controls = transformRef.current;
        if (controls) {
            const onDraggingChanged = (e) => {
                setIsDragging(e.value);
                // e.value가 false이면 사용자가 드래그를 마치고 마우스를 놓았다는 뜻
                if (!e.value && controls.object) {
                    handleTransformComplete(controls.object);
                }
            };
            controls.addEventListener('dragging-changed', onDraggingChanged);
            return () => controls.removeEventListener('dragging-changed', onDraggingChanged);
        }
    }, [transformMode, modelData, updateElementData]);

    return (
        <>
            <OrbitControls enabled={!isDragging} enableZoom={true} makeDefault />
            <ambientLight intensity={0.5} />
            <spotLight position={[10, 15, 10]} angle={0.2} penumbra={1} castShadow intensity={1.2} />
            <directionalLight position={[-10, 10, -5]} intensity={0.4} />

            {/* 💡 수정됨: onObjectChange 속성 제거 (무한 상태 업데이트 방지) */}
            {selectedElement?.meshRef?.current && (
                <TransformControls
                    ref={transformRef}
                    object={selectedElement.meshRef.current}
                    mode={transformMode}
                />
            )}

            {modelData.map((element) => (
                <BimElement
                    key={element.elementId}
                    element={{
                        ...element,
                        // 💡 수정됨: .data가 없을 때 에러가 발생하여 씬이 멈추는 것을 방지 (? 추가)
                        selected: selectedElement?.data?.elementId === element.elementId,
                    }}
                    onElementSelect={onElementSelect}
                />
            ))}

            <gridHelper args={[100, 100, '#334155', '#1e293b']} position={[0, -0.01, 0]} />

            <Suspense fallback={null}>
                <Environment preset="city" />
            </Suspense>
        </>
    );
}