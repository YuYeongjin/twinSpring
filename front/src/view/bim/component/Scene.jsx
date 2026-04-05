import React, { useRef, useState, useEffect, useMemo, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, getBaseColor } from '../element/BimElement';

// ================================================================
// 카메라 ref 주입 (BimDashboard 의 cameraRef 에 연결)
// ================================================================
function CameraSync({ cameraRef }) {
    const { camera } = useThree();
    useEffect(() => {
        if (cameraRef) cameraRef.current = camera;
    }, [camera, cameraRef]);
    return null;
}

// ================================================================
// 배치 고스트 + 바닥 클릭 평면
// ================================================================
/**
 * pendingElement 가 있을 때 마우스 커서를 따라다니는 반투명 고스트 메시.
 * useFrame 에서 직접 mesh.position을 업데이트하므로 re-render 없이 60fps.
 * 바닥 평면(y=0) 과의 교점을 구해 위치를 결정.
 */
function PlacementGhost({ template, onConfirm }) {
    const meshRef = useRef();
    const { camera, raycaster, mouse } = useThree();

    // 바닥 평면: Y=0, 위쪽 방향
    const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const hitPoint   = useMemo(() => new THREE.Vector3(), []);

    const sizeX = template.sizeX ?? 1;
    const sizeY = template.sizeY ?? 1;
    const sizeZ = template.sizeZ ?? 1;

    // 매 프레임: 레이캐스터로 바닥 교점 계산 → 메시 위치 갱신 (Re-render 없음)
    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(floorPlane, hitPoint) && meshRef.current) {
            meshRef.current.position.set(hitPoint.x, sizeY / 2, hitPoint.z);
        }
    });

    return (
        <>
            {/* 고스트 메시 */}
            <mesh ref={meshRef} position={[0, sizeY / 2, 0]}>
                <boxGeometry args={[sizeX, sizeY, sizeZ]} />
                <meshStandardMaterial
                    color={getBaseColor(template.elementType)}
                    opacity={0.45}
                    transparent
                    depthWrite={false}
                />
            </mesh>

            {/* 고스트 윤곽선 (wireframe) */}
            <mesh position={[0, sizeY / 2, 0]} ref={null}>
                <boxGeometry args={[sizeX + 0.02, sizeY + 0.02, sizeZ + 0.02]} />
                <meshBasicMaterial color="#60a5fa" wireframe transparent opacity={0.6} />
            </mesh>

            {/* 바닥 클릭 캐처 — 클릭 시 배치 확정 */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.001, 0]}
                onClick={(e) => {
                    e.stopPropagation();
                    onConfirm({ x: hitPoint.x, y: 0, z: hitPoint.z });
                }}
            >
                <planeGeometry args={[500, 500]} />
                <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
            </mesh>
        </>
    );
}

// ================================================================
// 메인 Scene
// ================================================================
export default function Scene({
    modelData,
    onElementSelect,
    selectedElement,
    selectedElements,   // Set<string> — 다중 선택된 elementId 집합
    updateElementData,
    setMainCameraPosition,
    transformMode,
    pendingElement,     // 배치 대기 중인 부재 템플릿
    onPlacementConfirm, // (position) => void
    isSelectMode,       // 러버밴드 선택 모드 (OrbitControls 비활성)
    cameraRef,          // Three.js camera ref (러버밴드 투영용)
}) {
    const { camera } = useThree();
    const transformRef = useRef();
    const [isDragging, setIsDragging] = useState(false);

    // 카메라 위치 → 미니맵 마커
    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
    });

    // TransformControls 드래그 완료 처리
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

    useEffect(() => {
        const controls = transformRef.current;
        if (!controls) return;
        const onDraggingChanged = (e) => {
            setIsDragging(e.value);
            if (!e.value && controls.object) {
                handleTransformComplete(controls.object);
            }
        };
        controls.addEventListener('dragging-changed', onDraggingChanged);
        return () => controls.removeEventListener('dragging-changed', onDraggingChanged);
    }, [transformMode, modelData, updateElementData]);

    // OrbitControls: 드래그 중이거나 선택 모드일 때 비활성
    const orbitEnabled = !isDragging && !isSelectMode;

    return (
        <>
            {/* 카메라 ref 주입 */}
            <CameraSync cameraRef={cameraRef} />

            <OrbitControls enabled={orbitEnabled} enableZoom makeDefault />
            <ambientLight intensity={0.5} />
            <spotLight position={[10, 15, 10]} angle={0.2} penumbra={1} castShadow intensity={1.2} />
            <directionalLight position={[-10, 10, -5]} intensity={0.4} />

            {/* TransformControls — 단일 선택된 부재에만 표시 */}
            {selectedElement?.meshRef?.current && (
                <TransformControls
                    ref={transformRef}
                    object={selectedElement.meshRef.current}
                    mode={transformMode}
                />
            )}

            {/* BIM 부재 목록 */}
            {modelData.map((element) => (
                <BimElement
                    key={element.elementId}
                    element={{
                        ...element,
                        selected:      selectedElement?.data?.elementId === element.elementId,
                        multiSelected: selectedElements?.has(element.elementId) &&
                                       selectedElement?.data?.elementId !== element.elementId,
                    }}
                    onElementSelect={onElementSelect}
                    isPlacementMode={!!pendingElement}
                />
            ))}

            {/* 배치 고스트 */}
            {pendingElement && (
                <PlacementGhost
                    template={pendingElement}
                    onConfirm={onPlacementConfirm}
                />
            )}

            <gridHelper args={[100, 100, '#334155', '#1e293b']} position={[0, -0.01, 0]} />

            <Suspense fallback={null}>
                <Environment preset="city" />
            </Suspense>
        </>
    );
}
