import React, { useRef, useState, useEffect, useMemo, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, getBaseColor } from '../element/BimElement';
import SkyEnvironment from './SkyEnvironment';

// ================================================================
// 카메라 ref 주입
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
function PlacementGhost({ template, onConfirm }) {
    const meshRef = useRef();
    const { camera, raycaster, mouse } = useThree();

    const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const hitPoint   = useMemo(() => new THREE.Vector3(), []);

    const sizeX = template.sizeX ?? 1;
    const sizeY = template.sizeY ?? 1;
    const sizeZ = template.sizeZ ?? 1;

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(floorPlane, hitPoint) && meshRef.current) {
            meshRef.current.position.set(hitPoint.x, sizeY / 2, hitPoint.z);
        }
    });

    return (
        <>
            <mesh ref={meshRef} position={[0, sizeY / 2, 0]}>
                <boxGeometry args={[sizeX, sizeY, sizeZ]} />
                <meshStandardMaterial
                    color={getBaseColor(template.elementType)}
                    opacity={0.45}
                    transparent
                    depthWrite={false}
                />
            </mesh>
            <mesh position={[0, sizeY / 2, 0]} ref={null}>
                <boxGeometry args={[sizeX + 0.02, sizeY + 0.02, sizeZ + 0.02]} />
                <meshBasicMaterial color="#60a5fa" wireframe transparent opacity={0.6} />
            </mesh>
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
    selectedElements,
    updateElementData,
    setMainCameraPosition,
    setMainCameraYaw,
    transformMode,
    pendingElement,
    onPlacementConfirm,
    isSelectMode,
    cameraRef,
    envPreset,
    navigationTargetRef,  // { x, z } — 미니맵 클릭 시 이동 목표
    pushUndo,             // () → void — 드래그 시작 전 undo 스냅샷 저장
}) {
    const { camera } = useThree();
    const transformRef = useRef();
    const [isDragging, setIsDragging] = useState(false);
    const orbitRef = useRef();

    // 드래그 시작 시 모든 선택 부재의 초기 위치를 저장
    const startPositionsRef = useRef({});

    // 카메라 위치 + yaw → 미니맵 마커, 미니맵 클릭 네비게이션
    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
        setMainCameraYaw?.(camera.rotation.y);

        // 미니맵 클릭 네비게이션: 목표 위치로 부드럽게 이동
        if (navigationTargetRef?.current) {
            const target = navigationTargetRef.current;
            const currentHeight = camera.position.y;
            camera.position.lerp(
                new THREE.Vector3(target.x, currentHeight, target.z),
                0.1
            );
            // OrbitControls target도 동기화
            if (orbitRef.current) {
                orbitRef.current.target.lerp(
                    new THREE.Vector3(target.x, 0, target.z),
                    0.1
                );
                orbitRef.current.update();
            }
            // 충분히 가까워지면 완료
            const dist = Math.sqrt(
                Math.pow(camera.position.x - target.x, 2) +
                Math.pow(camera.position.z - target.z, 2)
            );
            if (dist < 0.5) navigationTargetRef.current = null;
        }
    });

    // ================================================================
    // TransformControls 드래그 완료 처리
    // 다중 선택 translate: 모든 부재에 동일한 delta 적용
    // ================================================================
    const handleTransformComplete = (mesh) => {
        if (!mesh || !mesh.userData?.elementId) return;
        const elementId = mesh.userData.elementId;

        if (transformMode === 'translate') {
            const rawSize  = mesh.userData.rawSize ?? [1, 1, 1];
            const bottomY  = mesh.position.y - rawSize[1] / 2;
            const newX     = parseFloat(mesh.position.x.toFixed(3));
            const newY     = parseFloat(bottomY.toFixed(3));
            const newZ     = parseFloat(mesh.position.z.toFixed(3));

            // 드래그 시작 시 저장한 원래 위치 기반 delta 계산
            const startPos = startPositionsRef.current[elementId];
            const deltaX   = newX - (startPos?.positionX ?? newX);
            const deltaY   = newY - (startPos?.positionY ?? newY);
            const deltaZ   = newZ - (startPos?.positionZ ?? newZ);

            // 주 선택 부재 업데이트
            updateElementData(elementId, { positionX: newX, positionY: newY, positionZ: newZ });

            // 나머지 선택 부재들도 같은 delta 만큼 이동
            if (selectedElements && selectedElements.size > 1) {
                for (const selId of selectedElements) {
                    if (selId === elementId) continue;
                    const sp = startPositionsRef.current[selId];
                    if (!sp) continue;
                    updateElementData(selId, {
                        positionX: parseFloat(((sp.positionX ?? 0) + deltaX).toFixed(3)),
                        positionY: parseFloat(((sp.positionY ?? 0) + deltaY).toFixed(3)),
                        positionZ: parseFloat(((sp.positionZ ?? 0) + deltaZ).toFixed(3)),
                    });
                }
            }

        } else if (transformMode === 'scale') {
            const rawSize = mesh.userData.rawSize ?? [1, 1, 1];
            updateElementData(elementId, {
                sizeX: parseFloat((rawSize[0] * mesh.scale.x).toFixed(3)),
                sizeY: parseFloat((rawSize[1] * mesh.scale.y).toFixed(3)),
                sizeZ: parseFloat((rawSize[2] * mesh.scale.z).toFixed(3)),
            });
            mesh.scale.set(1, 1, 1);

        } else if (transformMode === 'rotate') {
            // 회전값(라디안)을 element 데이터에 저장
            updateElementData(elementId, {
                rotationX: parseFloat(mesh.rotation.x.toFixed(5)),
                rotationY: parseFloat(mesh.rotation.y.toFixed(5)),
                rotationZ: parseFloat(mesh.rotation.z.toFixed(5)),
            });
        }
    };

    useEffect(() => {
        const controls = transformRef.current;
        if (!controls) return;

        const onDraggingChanged = (e) => {
            setIsDragging(e.value);

            if (e.value && controls.object) {
                // 드래그 시작: undo 스냅샷 저장
                pushUndo?.();
                // 드래그 시작: 모든 선택 부재의 현재 위치를 스냅샷
                startPositionsRef.current = {};
                modelData.forEach(el => {
                    startPositionsRef.current[el.elementId] = {
                        positionX: el.positionX ?? 0,
                        positionY: el.positionY ?? 0,
                        positionZ: el.positionZ ?? 0,
                    };
                });
            }

            if (!e.value && controls.object) {
                handleTransformComplete(controls.object);
            }
        };

        controls.addEventListener('dragging-changed', onDraggingChanged);
        return () => controls.removeEventListener('dragging-changed', onDraggingChanged);
    }, [transformMode, modelData, updateElementData, selectedElements]);

    const orbitEnabled = !isDragging && !isSelectMode;

    return (
        <>
            <CameraSync cameraRef={cameraRef} />

            <OrbitControls ref={orbitRef} enabled={orbitEnabled} enableZoom makeDefault />

            {/* 환경 조명: 프리셋 기반 동적 설정 */}
            <ambientLight intensity={envPreset?.light?.ambientIntensity ?? 0.7} />
            <directionalLight
                position={envPreset?.light?.dirPos ?? [10, 10, 10]}
                color={envPreset?.light?.dirColor ?? '#ffffff'}
                intensity={envPreset?.light?.dirIntensity ?? 1.0}
                castShadow
                shadow-mapSize={[2048, 2048]}
            />
            <directionalLight position={[-10, 5, -10]} intensity={(envPreset?.light?.dirIntensity ?? 1.0) * 0.2} />

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

            {/* 그리드: 환경에 따라 색상 조정 */}
            <gridHelper
                args={[100, 100,
                    envPreset?.id === 'night' ? '#1a2040' : '#334155',
                    envPreset?.id === 'night' ? '#0d1020' : '#1e293b',
                ]}
                position={[0, -0.01, 0]}
            />

            {/* 하늘 / 별 / HDR 환경 */}
            <Suspense fallback={null}>
                {envPreset && <SkyEnvironment preset={envPreset} />}
            </Suspense>

            {/* XYZ 좌표축 기즈모 (좌측 하단) */}
            <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
                <GizmoViewport
                    axisColors={['#ff4060', '#80ff80', '#2080ff']}
                    labelColor="white"
                />
            </GizmoHelper>
        </>
    );
}
