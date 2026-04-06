import React, { useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getBaseColor } from '../element/BimElement';

// ================================================================
// 부재 요소 (상단 뷰, 납작한 박스)
// ================================================================
function MiniElem({ element }) {
    const { pos, size, color } = useMemo(() => {
        const x  = Number(element.positionX) || 0;
        const z  = Number(element.positionZ) || 0;
        const sx = Math.max(Number(element.sizeX) || 1, 0.3);
        const sz = Math.max(Number(element.sizeZ) || 1, 0.3);
        return {
            pos:   [x, 0.05, z],
            size:  [sx, 0.1, sz],
            color: element.resolvedColor || getBaseColor(element.elementType),
        };
    }, [element]);

    return (
        <mesh position={pos}>
            <boxGeometry args={size} />
            <meshBasicMaterial color={color} />
        </mesh>
    );
}

// ================================================================
// 카메라 마커 (위치 원 + 방향 화살표)
// ================================================================
function CamMarker({ position, yaw }) {
    if (!position || isNaN(position.x)) return null;
    const x = position.x;
    const z = position.z;
    const angle = yaw ?? 0;

    return (
        <group position={[x, 0.3, z]}>
            {/* 원형 배경 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[1.4, 32]} />
                <meshBasicMaterial color="#1d4ed8" transparent opacity={0.9} />
            </mesh>
            {/* 방향 삼각형 */}
            <mesh rotation={[-Math.PI / 2, 0, -angle]} position={[0, 0.05, 0]}>
                <coneGeometry args={[0.85, 2.2, 3]} />
                <meshBasicMaterial color="#60a5fa" />
            </mesh>
        </group>
    );
}

// ================================================================
// 자동 줌 + 카메라 위치 조정
// ================================================================
function AutoZoom({ modelData }) {
    const { camera } = useThree();
    const prevCount = useRef(-1);

    useEffect(() => {
        if (prevCount.current === modelData.length) return;
        prevCount.current = modelData.length;

        if (modelData.length === 0) {
            camera.zoom = 4;
            camera.position.set(0, 100, 0);
            camera.up.set(0, 0, -1);
            camera.updateProjectionMatrix();
            return;
        }

        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        modelData.forEach(el => {
            const x  = Number(el.positionX) || 0;
            const z  = Number(el.positionZ) || 0;
            const sx = (Number(el.sizeX)    || 1) / 2;
            const sz = (Number(el.sizeZ)    || 1) / 2;
            minX = Math.min(minX, x - sx);
            maxX = Math.max(maxX, x + sx);
            minZ = Math.min(minZ, z - sz);
            maxZ = Math.max(maxZ, z + sz);
        });

        const span = Math.max(maxX - minX, maxZ - minZ, 15) + 10;
        const cx   = (minX + maxX) / 2;
        const cz   = (minZ + maxZ) / 2;

        // 미니맵 픽셀 크기 약 144px → span 미터가 120px에 들어오도록
        camera.zoom = 120 / span;
        camera.position.set(cx, 100, cz);
        camera.up.set(0, 0, -1);
        camera.lookAt(cx, 0, cz);
        camera.updateProjectionMatrix();
    }, [modelData.length, camera]);

    return null;
}

// ================================================================
// 메인 MiniMapCanvas
// ================================================================
export default function MiniMapCanvas({
    modelData,
    mainCameraPosition,
    mainCameraYaw,
    containerElement,
    envId,
    onNavigate,
}) {
    if (!containerElement) return null;

    const bgColor    = envId === 'night' ? '#04091a' : '#0f172a';
    const gridColor1 = envId === 'night' ? '#1a2040' : '#1e3a5f';
    const gridColor2 = envId === 'night' ? '#0d1020' : '#0f2040';

    return createPortal(
        <Canvas
            orthographic
            camera={{ position: [0, 100, 0], up: [0, 0, -1], zoom: 4, near: 1, far: 500 }}
            style={{ width: '100%', height: '100%', borderRadius: '0.75rem' }}
            gl={{ antialias: false, alpha: false }}
        >
            <color attach="background" args={[bgColor]} />
            <ambientLight intensity={4} />

            {/* 자동 줌 */}
            <AutoZoom modelData={modelData} />

            {/* 바닥 그리드 */}
            <gridHelper
                args={[1000, 100, gridColor1, gridColor2]}
                position={[0, 0, 0]}
            />

            {/* 부재 */}
            {modelData.map(el => (
                <MiniElem key={el.elementId} element={el} />
            ))}

            {/* 카메라 위치 + 방향 마커 */}
            <CamMarker position={mainCameraPosition} yaw={mainCameraYaw} />

            {/* 클릭 네비게이션 평면 */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.02, 0]}
                onClick={(e) => {
                    e.stopPropagation();
                    onNavigate?.(e.point.x, e.point.z);
                }}
            >
                <planeGeometry args={[1000, 1000]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
        </Canvas>,
        containerElement
    );
}
