import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Box, View, PerspectiveCamera, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, parseVectorData, getBaseColor } from '../element/BimElement';

export default function Scene({ modelData, onElementSelect, selectedElement, updateElementData, setMainCameraPosition }) {
    const { camera } = useThree();
    const controlsRef = useRef();

    // 카메라 위치를 지속적으로 업데이트
    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
    });

    const handleTransformEnd = (e) => {
        const mesh = e.target.object;
        // TransformControls이 반환하는 객체가 유효한지 체크
        if (!mesh || !mesh.userData || !mesh.userData.elementId) return;

        const newPos = mesh.position;
        const elementId = mesh.userData.elementId;

        const elementToUpdate = modelData.find(e => e.elementId === elementId);
        if (elementToUpdate) {
            const rawSize = mesh.userData.rawSize;
            const height = rawSize ? rawSize[1] : 0;

            // Y축 위치는 밑면 기준으로 다시 변환 (Center Y -> Bottom Y)
            const bottomY = newPos.y - height / 2;

            updateElementData(elementId, {
                positionData: `[${newPos.x.toFixed(2)}, ${bottomY.toFixed(2)}, ${newPos.z.toFixed(2)}]`
            });
        }
    };

    return (
        <>
            <OrbitControls enableZoom={true} makeDefault />
            <ambientLight intensity={0.5} />
            <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} castShadow />

            {/* TransformControls 렌더링 안정성 강화 */}
            {selectedElement && selectedElement.meshRef.current && (
                <TransformControls
                    ref={controlsRef}
                    object={selectedElement.meshRef.current}
                    mode="translate"
                    onObjectChange={handleTransformEnd}
                />
            )}

            {modelData.map((element) => (
                <BimElement
                    key={element.elementId}
                    element={{ ...element, selected: selectedElement?.data.elementId === element.elementId }}
                    onElementSelect={onElementSelect}
                />
            ))}
            <Environment preset="city" />
        </>
    );
}