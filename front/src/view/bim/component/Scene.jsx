import React, { useRef, useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, getBaseColor } from '../element/BimElement';
import { BimLine } from '../element/BimLine';
import SkyEnvironment from './SkyEnvironment';

// ================================================================
// 스냅 상수 & 유틸
// ================================================================
const SNAP_THRESHOLD = 0.8;
const HANDLE_HALF    = 0.13; // 핸들 정육면체 반변 (m)

/** XZ 평면 기준 가장 가까운 스냅 꼭짓점 반환 (없으면 null) */
function findSnapVertex(wx, wz, verts) {
    let best = null, min = SNAP_THRESHOLD;
    for (const v of verts) {
        const d = Math.hypot(wx - v[0], wz - v[2]);
        if (d < min) { min = d; best = v; }
    }
    return best;
}

/**
 * 배치 고스트의 스마트 스냅:
 * 센터 + 4 바닥코너 중 가장 가까운 꼭짓점을 찾아
 * 해당 코너가 snap vertex에 맞도록 센터를 이동시킨다.
 */
function findSmartSnap(mouseX, mouseZ, sizeX, sizeZ, verts) {
    if (!verts.length) return null;
    const hx = sizeX / 2, hz = sizeZ / 2;
    const checks = [[0,0],[hx,hz],[hx,-hz],[-hx,hz],[-hx,-hz]];
    let bestX = null, bestZ = null, min = SNAP_THRESHOLD;
    for (const [ox, oz] of checks) {
        for (const v of verts) {
            const d = Math.hypot((mouseX + ox) - v[0], (mouseZ + oz) - v[2]);
            if (d < min) { min = d; bestX = v[0] - ox; bestZ = v[2] - oz; }
        }
    }
    return bestX !== null ? [bestX, bestZ] : null;
}

// ================================================================
// 카메라 ref 주입
// ================================================================
function CameraSync({ cameraRef }) {
    const { camera } = useThree();
    useEffect(() => { if (cameraRef) cameraRef.current = camera; }, [camera, cameraRef]);
    return null;
}

// ================================================================
// 부재 리사이즈 핸들 (CAD 스타일)
// ================================================================
function ElementResizeHandles({
    element, updateElementData, pushUndo,
    snapVertices, snapEnabled,
    onDragStateChange,
}) {
    const { camera, gl } = useThree();

    const x  = Number(element.positionX) || 0;
    const y  = Number(element.positionY) || 0;
    const z  = Number(element.positionZ) || 0;
    const sx = Math.max(0.1, Number(element.sizeX) || 1);
    const sy = Math.max(0.1, Number(element.sizeY) || 1);
    const sz = Math.max(0.1, Number(element.sizeZ) || 1);
    const hx = sx / 2, hz = sz / 2;

    /** 클라이언트 좌표 → NDC */
    const getNDC = useCallback((cx, cy) => {
        const r = gl.domElement.getBoundingClientRect();
        return new THREE.Vector2(
            ((cx - r.left) / r.width)  *  2 - 1,
            ((cy - r.top)  / r.height) * -2 + 1,
        );
    }, [gl]);

    /**
     * 핸들 드래그 시작 팩토리
     * @param {'corner'|'edge-x'|'edge-z'|'top'} type
     * @param {[number,number,number]|null} anchor  고정점 (opposite corner)
     * @param {string} cursor  CSS cursor 이름
     */
    const makeDragHandler = useCallback((type, anchor, cursor) => (e) => {
        e.stopPropagation();
        pushUndo?.();
        onDragStateChange?.(true);
        document.body.style.cursor = cursor;

        // ── 드래그 평면 결정 ──────────────────────────────────────────
        let plane;
        if (type === 'top') {
            // 카메라 방향 수직 평면 (높이 조절용)
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            dir.y = 0; dir.normalize();
            plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                dir, new THREE.Vector3(x, y + sy, z)
            );
        } else {
            // 바닥 수평 평면 (XZ 치수 조절용)
            plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
        }

        const rc  = new THREE.Raycaster();
        const hit = new THREE.Vector3();

        const onMove = (ev) => {
            rc.setFromCamera(getNDC(ev.clientX, ev.clientY), camera);
            if (!rc.ray.intersectPlane(plane, hit)) return;

            // ── 높이 핸들 ─────────────────────────────────────────────
            if (type === 'top') {
                const newSY = Math.max(0.1, parseFloat((hit.y - y).toFixed(3)));
                updateElementData(element.elementId, { sizeY: newSY });
                return;
            }

            // ── XZ 핸들 (스냅 적용) ───────────────────────────────────
            let hx2 = hit.x, hz2 = hit.z;
            if (snapEnabled && snapVertices.length > 0) {
                const sv = findSnapVertex(hit.x, hit.z, snapVertices);
                if (sv) { hx2 = sv[0]; hz2 = sv[2]; }
            }

            const [ax, , az] = anchor;
            const updates = {};
            if (type === 'corner' || type === 'edge-x') {
                updates.sizeX     = Math.max(0.1, parseFloat(Math.abs(hx2 - ax).toFixed(3)));
                updates.positionX = parseFloat(((hx2 + ax) / 2).toFixed(3));
            }
            if (type === 'corner' || type === 'edge-z') {
                updates.sizeZ     = Math.max(0.1, parseFloat(Math.abs(hz2 - az).toFixed(3)));
                updates.positionZ = parseFloat(((hz2 + az) / 2).toFixed(3));
            }
            updateElementData(element.elementId, updates);
        };

        const onUp = () => {
            onDragStateChange?.(false);
            document.body.style.cursor = '';
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup',   onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup',   onUp);
    }, [
        x, y, z, sx, sy, sz,
        element.elementId, camera, getNDC,
        snapEnabled, snapVertices,
        updateElementData, pushUndo, onDragStateChange,
    ]);

    // ── 핸들 정의 ────────────────────────────────────────────────────
    const handles = useMemo(() => [
        // 바닥 코너 (파란색) — X + Z 동시 조절
        { id:'c0', pos:[x+hx,y,z+hz], type:'corner',  anchor:[x-hx,y,z-hz], color:'#3b82f6', cursor:'nw-resize' },
        { id:'c1', pos:[x+hx,y,z-hz], type:'corner',  anchor:[x-hx,y,z+hz], color:'#3b82f6', cursor:'ne-resize' },
        { id:'c2', pos:[x-hx,y,z+hz], type:'corner',  anchor:[x+hx,y,z-hz], color:'#3b82f6', cursor:'ne-resize' },
        { id:'c3', pos:[x-hx,y,z-hz], type:'corner',  anchor:[x+hx,y,z+hz], color:'#3b82f6', cursor:'nw-resize' },
        // 바닥 엣지 중점 (보라색) — 단일 축 조절
        { id:'ex0', pos:[x+hx,y,z],   type:'edge-x',  anchor:[x-hx,y,z],    color:'#8b5cf6', cursor:'ew-resize' },
        { id:'ex1', pos:[x-hx,y,z],   type:'edge-x',  anchor:[x+hx,y,z],    color:'#8b5cf6', cursor:'ew-resize' },
        { id:'ez0', pos:[x,y,z+hz],   type:'edge-z',  anchor:[x,y,z-hz],    color:'#8b5cf6', cursor:'ns-resize' },
        { id:'ez1', pos:[x,y,z-hz],   type:'edge-z',  anchor:[x,y,z+hz],    color:'#8b5cf6', cursor:'ns-resize' },
        // 상단 중심 (초록색) — 높이 조절
        { id:'top', pos:[x,y+sy,z],   type:'top',     anchor:null,           color:'#10b981', cursor:'n-resize'  },
    ], [x, y, z, hx, hz, sy]);

    const hs = HANDLE_HALF * 2; // 핸들 한 변 길이

    return (
        <group>
            {/* CAD 바운딩 박스 와이어프레임 */}
            <mesh position={[x, y + sy / 2, z]}>
                <boxGeometry args={[sx + 0.02, sy + 0.02, sz + 0.02]} />
                <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.35} />
            </mesh>

            {/* 핸들 */}
            {handles.map(hd => (
                <mesh
                    key={hd.id}
                    position={hd.pos}
                    onPointerDown={makeDragHandler(hd.type, hd.anchor, hd.cursor)}
                    onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = hd.cursor; }}
                    onPointerOut={()  => { document.body.style.cursor = ''; }}
                    renderOrder={999}
                >
                    <boxGeometry args={[hs, hs, hs]} />
                    <meshBasicMaterial color={hd.color} depthTest={false} />
                </mesh>
            ))}

            {/* 상단 핸들 수직선 (높이 표시) */}
            <line>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        array={new Float32Array([x, y, z,  x, y + sy, z])}
                        count={2}
                        itemSize={3}
                    />
                </bufferGeometry>
                <lineBasicMaterial color="#10b981" transparent opacity={0.5} />
            </line>
        </group>
    );
}

// ================================================================
// 배치 고스트 (스마트 스냅 — 센터 + 코너)
// ================================================================
function PlacementGhost({ template, onConfirm, snapVertices, snapEnabled }) {
    const meshRef   = useRef();
    const snapRef   = useRef();
    const { camera, raycaster, mouse } = useThree();

    const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const hitPoint   = useMemo(() => new THREE.Vector3(), []);
    const snappedPos = useRef([0, 0]); // [x, z]

    const sizeX = template.sizeX ?? 1;
    const sizeY = template.sizeY ?? 1;
    const sizeZ = template.sizeZ ?? 1;

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return;

        let px = hitPoint.x, pz = hitPoint.z;
        let snapped = false;

        if (snapEnabled && snapVertices.length > 0) {
            const r = findSmartSnap(hitPoint.x, hitPoint.z, sizeX, sizeZ, snapVertices);
            if (r) { [px, pz] = r; snapped = true; }
        }

        snappedPos.current = [px, pz];
        if (meshRef.current) meshRef.current.position.set(px, sizeY / 2, pz);

        if (snapRef.current) {
            snapRef.current.visible = snapped;
            if (snapped) snapRef.current.position.set(px, 0.1, pz);
        }
    });

    return (
        <>
            <mesh ref={meshRef} position={[0, sizeY / 2, 0]}>
                <boxGeometry args={[sizeX, sizeY, sizeZ]} />
                <meshStandardMaterial
                    color={getBaseColor(template.elementType)}
                    opacity={0.45} transparent depthWrite={false}
                />
            </mesh>
            {/* 와이어프레임 */}
            <mesh position={[0, sizeY / 2, 0]}>
                <boxGeometry args={[sizeX + 0.02, sizeY + 0.02, sizeZ + 0.02]} />
                <meshBasicMaterial color="#60a5fa" wireframe transparent opacity={0.6} />
            </mesh>
            {/* 스냅 인디케이터 */}
            <mesh ref={snapRef} visible={false}>
                <sphereGeometry args={[0.22, 16, 16]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.85} />
            </mesh>
            {/* 클릭 평면 */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.001, 0]}
                onClick={e => {
                    e.stopPropagation();
                    onConfirm({ x: snappedPos.current[0], y: 0, z: snappedPos.current[1] });
                }}
            >
                <planeGeometry args={[500, 500]} />
                <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
            </mesh>
        </>
    );
}

// ================================================================
// 선 작도 미리보기 (스냅 + 시작점 마커)
// ================================================================
function LinePreview({ lineStart, lineColor, lineWidth, drawHeight, snapVertices, snapEnabled }) {
    const { camera, raycaster, mouse } = useThree();

    const floorPlane = useMemo(
        () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -drawHeight),
        [drawHeight]
    );
    const hitPoint    = useMemo(() => new THREE.Vector3(), []);
    const snapSphRef  = useRef();

    const lineObj = useMemo(() => {
        const positions = new Float32Array(6);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({
            color: new THREE.Color(lineColor ?? '#60a5fa'),
            opacity: 0.6, transparent: true,
        });
        return new THREE.Line(geom, mat);
    }, [lineColor]);

    useEffect(() => () => { lineObj.geometry.dispose(); lineObj.material.dispose(); }, [lineObj]);

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return;

        let ex = hitPoint.x, ez = hitPoint.z;
        let snapped = false;

        if (snapEnabled && snapVertices.length > 0) {
            const sv = findSnapVertex(hitPoint.x, hitPoint.z, snapVertices);
            if (sv) {
                ex = sv[0]; ez = sv[2]; snapped = true;
                if (snapSphRef.current) {
                    snapSphRef.current.position.set(sv[0], sv[1] ?? drawHeight, sv[2]);
                    snapSphRef.current.visible = true;
                }
            }
        }
        if (!snapped && snapSphRef.current) snapSphRef.current.visible = false;

        const pos = lineObj.geometry.attributes.position;
        pos.setXYZ(0, lineStart[0], lineStart[1], lineStart[2]);
        pos.setXYZ(1, ex, drawHeight, ez);
        pos.needsUpdate = true;
        lineObj.geometry.computeBoundingSphere();
    });

    return (
        <>
            <primitive object={lineObj} />
            <mesh position={lineStart}>
                <sphereGeometry args={[0.15, 12, 12]} />
                <meshBasicMaterial color="#4ade80" />
            </mesh>
            <mesh ref={snapSphRef} visible={false}>
                <sphereGeometry args={[0.22, 16, 16]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.85} />
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
    navigationTargetRef,
    pushUndo,
    // 선 작도
    lines = [],
    selectedLineId,
    onLineSelect,
    lineDrawMode,
    lineDrawHeight = 0,
    lineStart  = null,
    lineColor  = '#60a5fa',
    lineWidth  = 2,
    onLineClick,
    // 스냅
    snapEnabled = true,
}) {
    const { camera } = useThree();
    const transformRef     = useRef();
    const orbitRef         = useRef();
    const [isDragging,          setIsDragging]          = useState(false);
    const [isResizeDragging,    setIsResizeDragging]    = useState(false);
    const startPositionsRef = useRef({});

    // ── 스냅 꼭짓점 수집 ─────────────────────────────────────────────
    const snapVertices = useMemo(() => {
        if (!snapEnabled) return [];
        const verts = [];
        for (const line of lines) {
            if (line.start) verts.push(line.start);
            if (line.end)   verts.push(line.end);
            if (line.pointsJson) {
                try {
                    const pts = typeof line.pointsJson === 'string'
                        ? JSON.parse(line.pointsJson) : line.pointsJson;
                    if (Array.isArray(pts)) pts.forEach(p => verts.push(p));
                } catch (_) {}
            }
        }
        for (const el of modelData) {
            const ex = Number(el.positionX)||0, ey = Number(el.positionY)||0, ez = Number(el.positionZ)||0;
            const esx = (Number(el.sizeX)||1)/2, esy = Number(el.sizeY)||1, esz = (Number(el.sizeZ)||1)/2;
            for (const dx of [-1,1]) for (const dz of [-1,1]) {
                verts.push([ex+dx*esx, ey,     ez+dz*esz]);
                verts.push([ex+dx*esx, ey+esy, ez+dz*esz]);
            }
            verts.push([ex, ey, ez]);
            verts.push([ex, ey+esy, ez]);
        }
        return verts;
    }, [snapEnabled, lines, modelData]);

    // ── 카메라 추적 + 미니맵 네비게이션 ─────────────────────────────
    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
        setMainCameraYaw?.(camera.rotation.y);
        if (navigationTargetRef?.current) {
            const t = navigationTargetRef.current;
            camera.position.lerp(new THREE.Vector3(t.x, camera.position.y, t.z), 0.1);
            if (orbitRef.current) {
                orbitRef.current.target.lerp(new THREE.Vector3(t.x, 0, t.z), 0.1);
                orbitRef.current.update();
            }
            if (Math.hypot(camera.position.x - t.x, camera.position.z - t.z) < 0.5)
                navigationTargetRef.current = null;
        }
    });

    // ── TransformControls 드래그 ──────────────────────────────────────
    const handleTransformComplete = (mesh) => {
        if (!mesh?.userData?.elementId) return;
        const id = mesh.userData.elementId;
        if (transformMode === 'translate') {
            const rawSize = mesh.userData.rawSize ?? [1,1,1];
            const bottomY = mesh.position.y - rawSize[1]/2;
            const nx = parseFloat(mesh.position.x.toFixed(3));
            const ny = parseFloat(bottomY.toFixed(3));
            const nz = parseFloat(mesh.position.z.toFixed(3));
            const sp = startPositionsRef.current[id];
            const dx = nx-(sp?.positionX??nx), dy = ny-(sp?.positionY??ny), dz = nz-(sp?.positionZ??nz);
            updateElementData(id, { positionX:nx, positionY:ny, positionZ:nz });
            if (selectedElements?.size > 1) {
                for (const sid of selectedElements) {
                    if (sid === id) continue;
                    const s = startPositionsRef.current[sid];
                    if (!s) continue;
                    updateElementData(sid, {
                        positionX: parseFloat(((s.positionX??0)+dx).toFixed(3)),
                        positionY: parseFloat(((s.positionY??0)+dy).toFixed(3)),
                        positionZ: parseFloat(((s.positionZ??0)+dz).toFixed(3)),
                    });
                }
            }
        } else if (transformMode === 'scale') {
            const rawSize = mesh.userData.rawSize ?? [1,1,1];
            updateElementData(id, {
                sizeX: parseFloat((rawSize[0]*mesh.scale.x).toFixed(3)),
                sizeY: parseFloat((rawSize[1]*mesh.scale.y).toFixed(3)),
                sizeZ: parseFloat((rawSize[2]*mesh.scale.z).toFixed(3)),
            });
            mesh.scale.set(1,1,1);
        } else if (transformMode === 'rotate') {
            updateElementData(id, {
                rotationX: parseFloat(mesh.rotation.x.toFixed(5)),
                rotationY: parseFloat(mesh.rotation.y.toFixed(5)),
                rotationZ: parseFloat(mesh.rotation.z.toFixed(5)),
            });
        }
    };

    useEffect(() => {
        const ctrl = transformRef.current;
        if (!ctrl) return;
        const onDrag = (e) => {
            setIsDragging(e.value);
            if (e.value && ctrl.object) {
                pushUndo?.();
                startPositionsRef.current = {};
                modelData.forEach(el => {
                    startPositionsRef.current[el.elementId] = {
                        positionX: el.positionX ?? 0,
                        positionY: el.positionY ?? 0,
                        positionZ: el.positionZ ?? 0,
                    };
                });
            }
            if (!e.value && ctrl.object) handleTransformComplete(ctrl.object);
        };
        ctrl.addEventListener('dragging-changed', onDrag);
        return () => ctrl.removeEventListener('dragging-changed', onDrag);
    }, [transformMode, modelData, updateElementData, selectedElements]);

    // ── 선 클릭 (스냅 적용) ──────────────────────────────────────────
    const handleLinePlaneClick = (e) => {
        e.stopPropagation();
        let pt = { x: e.point.x, y: e.point.y, z: e.point.z };
        if (snapEnabled && snapVertices.length > 0) {
            const sv = findSnapVertex(e.point.x, e.point.z, snapVertices);
            if (sv) pt = { x: sv[0], y: sv[1] ?? lineDrawHeight, z: sv[2] };
        }
        onLineClick?.(pt);
    };

    // OrbitControls: 드래그 중 / 리사이즈 핸들 드래그 중 / 선택모드 / 선 작도 중 비활성화
    const orbitEnabled = !isDragging && !isResizeDragging && !isSelectMode && lineDrawMode !== 'click';

    // 리사이즈 핸들 표시 조건
    const showHandles = selectedElement && !pendingElement && !isSelectMode;

    return (
        <>
            <CameraSync cameraRef={cameraRef} />

            <OrbitControls ref={orbitRef} enabled={orbitEnabled} enableZoom makeDefault />

            <ambientLight intensity={envPreset?.light?.ambientIntensity ?? 0.7} />
            <directionalLight
                position={envPreset?.light?.dirPos ?? [10,10,10]}
                color={envPreset?.light?.dirColor ?? '#ffffff'}
                intensity={envPreset?.light?.dirIntensity ?? 1.0}
                castShadow shadow-mapSize={[2048,2048]}
            />
            <directionalLight position={[-10,5,-10]} intensity={(envPreset?.light?.dirIntensity??1.0)*0.2} />

            {/* TransformControls */}
            {selectedElement?.meshRef?.current && !isResizeDragging && (
                <TransformControls
                    ref={transformRef}
                    object={selectedElement.meshRef.current}
                    mode={transformMode}
                />
            )}

            {/* BIM 부재 */}
            {modelData.map(element => (
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

            {/* CAD 리사이즈 핸들 */}
            {showHandles && (
                <ElementResizeHandles
                    element={selectedElement.data}
                    updateElementData={updateElementData}
                    pushUndo={pushUndo}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    onDragStateChange={setIsResizeDragging}
                />
            )}

            {/* 배치 고스트 */}
            {pendingElement && (
                <PlacementGhost
                    template={pendingElement}
                    onConfirm={onPlacementConfirm}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                />
            )}

            {/* 선 작도 클릭 평면 */}
            {lineDrawMode === 'click' && (
                <mesh
                    rotation={[-Math.PI/2, 0, 0]}
                    position={[0, lineDrawHeight, 0]}
                    onClick={handleLinePlaneClick}
                >
                    <planeGeometry args={[500,500]} />
                    <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
                </mesh>
            )}

            {/* 선 작도 미리보기 */}
            {lineDrawMode === 'click' && lineStart && (
                <LinePreview
                    lineStart={lineStart}
                    lineColor={lineColor}
                    lineWidth={lineWidth}
                    drawHeight={lineDrawHeight}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                />
            )}

            {/* 선 목록 */}
            {lines.map(line => (
                <BimLine
                    key={line.lineId}
                    line={line}
                    selected={line.lineId === selectedLineId}
                    onClick={onLineSelect}
                />
            ))}

            {/* 그리드 */}
            {!envPreset?.useWater && (
                <gridHelper
                    args={[100,100,
                        envPreset?.id==='night' ? '#1a2040' : '#334155',
                        envPreset?.id==='night' ? '#0d1020' : '#1e293b',
                    ]}
                    position={[0,-0.01,0]}
                />
            )}

            <Suspense fallback={null}>
                {envPreset && <SkyEnvironment preset={envPreset} />}
            </Suspense>

            <GizmoHelper alignment="bottom-left" margin={[72,72]}>
                <GizmoViewport axisColors={['#ff4060','#80ff80','#2080ff']} labelColor="white" />
            </GizmoHelper>
        </>
    );
}
