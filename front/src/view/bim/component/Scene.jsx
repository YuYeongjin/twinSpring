import React, { useRef, useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls, OrthographicCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, getBaseColor } from '../element/BimElement';
import { BimLine } from '../element/BimLine';
import { IFCMeshGroup } from '../element/IFCMeshGroup';
import SkyEnvironment from './SkyEnvironment';

// ================================================================
// 스냅 상수 & 유틸
// ================================================================
const SNAP_THRESHOLD = 0.8;
const HANDLE_HALF    = 0.13;

/**
 * viewMode에 맞는 레이캐스트 교차 평면 반환
 * - '3d' / 'xy' : Y=0 수평 평면 (바닥)
 * - 'xz'        : Z=avgZ 수직 평면 (정면도 — 카메라가 Z+ 방향에서 -Z 바라봄)
 * - 'yz'        : X=avgX 수직 평면 (측면도 — 카메라가 X+ 방향에서 -X 바라봄)
 */
function getSnapPlane(viewMode, snapVertices) {
    if (viewMode === 'xz') {
        const avgZ = snapVertices.length
            ? snapVertices.reduce((s, v) => s + v[2], 0) / snapVertices.length : 0;
        return new THREE.Plane(new THREE.Vector3(0, 0, 1), -avgZ);
    }
    if (viewMode === 'yz') {
        const avgX = snapVertices.length
            ? snapVertices.reduce((s, v) => s + v[0], 0) / snapVertices.length : 0;
        return new THREE.Plane(new THREE.Vector3(1, 0, 0), -avgX);
    }
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // xy / 3d
}

/**
 * viewMode별 2D 거리로 가장 가까운 스냅 꼭짓점 반환
 * - xy/3d : XZ 거리 (바닥 평면)
 * - xz    : XY 거리 (정면 — X=동서, Y=높이)
 * - yz    : ZY 거리 (측면 — Z=남북, Y=높이)
 */
function findSnapVertex(wa, wb, verts, viewMode) {
    let best = null, min = SNAP_THRESHOLD;
    for (const v of verts) {
        let d;
        if (viewMode === 'xz')     d = Math.hypot(wa - v[0], wb - v[1]); // X·Y
        else if (viewMode === 'yz') d = Math.hypot(wa - v[2], wb - v[1]); // Z·Y
        else                        d = Math.hypot(wa - v[0], wb - v[2]); // X·Z
        if (d < min) { min = d; best = v; }
    }
    return best;
}

/**
 * 배치 고스트의 스마트 스냅 (viewMode 인식)
 */
function findSmartSnap(mA, mB, sA, sB, verts, viewMode) {
    if (!verts.length) return null;
    const ha = sA / 2, hb = sB / 2;
    const checks = [[0,0],[ha,hb],[ha,-hb],[-ha,hb],[-ha,-hb]];
    let bestA = null, bestB = null, min = SNAP_THRESHOLD;
    for (const [oa, ob] of checks) {
        for (const v of verts) {
            let d, va, vb;
            if (viewMode === 'xz')     { va = v[0]; vb = v[1]; }
            else if (viewMode === 'yz') { va = v[2]; vb = v[1]; }
            else                        { va = v[0]; vb = v[2]; }
            d = Math.hypot((mA + oa) - va, (mB + ob) - vb);
            if (d < min) { min = d; bestA = va - oa; bestB = vb - ob; }
        }
    }
    return bestA !== null ? [bestA, bestB] : null;
}

// ================================================================
// 3D 모드에서 잠긴 축에 따른 동적 스냅 평면 반환
// - X 고정: Three.js X=val 수직 평면 (Y·Z 자유)
// - Y 고정: Three.js Z=val 수직 평면 (X·Z 자유)
// - Z 고정 / 미고정: 수평 평면 at height (기존 동작)
// ================================================================
function getDynamicSnapPlane3D(lockedAxes) {
    const xl = lockedAxes?.x != null;
    const yl = lockedAxes?.y != null;
    const zl = lockedAxes?.z != null;
    if (xl && !yl && !zl)
        return new THREE.Plane(new THREE.Vector3(1, 0, 0), -(lockedAxes.x));
    if (yl && !xl && !zl)
        return new THREE.Plane(new THREE.Vector3(0, 0, 1), -(lockedAxes.y));
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), -(lockedAxes?.z ?? 0));
}

// ================================================================
// 카메라를 항상 바라보는 투명 클릭 평면
// 수직/수평 구분 없이 어느 시점에서도 클릭을 캡처한다.
// ================================================================
function BillboardClickPlane({ onClick }) {
    const ref = useRef();
    const { camera } = useThree();
    useFrame(() => { if (ref.current) ref.current.quaternion.copy(camera.quaternion); });
    return (
        <mesh ref={ref} onClick={onClick} renderOrder={-1}>
            <planeGeometry args={[2000, 2000]} />
            <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
    );
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
// IFC 로드 시 카메라 자동 맞춤 (Auto-fit)
// IFC 모델의 AABB를 계산해 전체가 화면에 들어오도록 카메라를 재배치한다.
// fitTrigger 가 바뀌면 수동으로도 재실행된다.
// ================================================================
function CameraAutoFit({ ifcMeshes, modelData, orbitRef, fitTrigger }) {
    const { camera } = useThree();
    const prevRef = useRef({ meshes: null, trigger: -1 });

    useEffect(() => {
        if (!ifcMeshes || ifcMeshes.length === 0) {
            prevRef.current = { meshes: null, trigger: -1 };
            return;
        }
        // 메시도 같고 트리거도 같으면 이미 처리된 것
        if (prevRef.current.meshes === ifcMeshes && prevRef.current.trigger === fitTrigger) return;
        prevRef.current = { meshes: ifcMeshes, trigger: fitTrigger };

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        if (modelData && modelData.length > 0) {
            // 좌표 규칙: positionX/Y=평면, positionZ=높이 / Three.js: X=posX, Y=posZ, Z=posY
            for (const el of modelData) {
                const px = Number(el.positionX) || 0;
                const py = Number(el.positionY) || 0;  // floor Y → Three.js Z
                const pz = Number(el.positionZ) || 0;  // height  → Three.js Y
                const hx = (Number(el.sizeX) || 0.1) / 2;
                const hy = (Number(el.sizeY) || 0.1) / 2;  // floor Y half
                const sz = Number(el.sizeZ) || 0.1;         // height size
                if (px - hx < minX) minX = px - hx;
                if (px + hx > maxX) maxX = px + hx;
                if (pz       < minY) minY = pz;          // Three.js Y = data Z
                if (pz + sz  > maxY) maxY = pz + sz;
                if (py - hy < minZ) minZ = py - hy;      // Three.js Z = data Y
                if (py + hy > maxZ) maxZ = py + hy;
            }
        } else {
            // 느린 경로: 첫 번째 메시 정점 직접 순회 (fallback)
            const m = ifcMeshes[0];
            for (let i = 0; i < m.positions.length; i += 3) {
                const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
        }

        if (!isFinite(minX)) return;

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;

        // 모델의 최대 치수를 기준으로 카메라 거리 산출
        const span   = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.5);
        const fovRad = (camera.fov * Math.PI) / 180;
        const dist   = (span / 2) / Math.tan(fovRad / 2) * 1.8; // 1.8배 여유

        // 북동 45° 사선에서 바라보도록 카메라 배치
        camera.position.set(
            cx + dist * 0.65,
            cy + dist * 0.55,
            cz + dist * 0.65,
        );
        camera.lookAt(cx, cy, cz);

        if (orbitRef?.current) {
            orbitRef.current.target.set(cx, cy, cz);
            orbitRef.current.update();
        }
    }, [ifcMeshes, modelData, fitTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // 좌표 규칙: positionX/Y=평면, positionZ=높이 / Three.js: X=posX, Y=posZ, Z=posY
    const pX = Number(element.positionX) || 0;
    const pY = Number(element.positionY) || 0;   // floor Y → Three.js Z
    const pZ = Number(element.positionZ) || 0;   // height  → Three.js Y
    const sX = Math.max(0.1, Number(element.sizeX) || 1);
    const sY = Math.max(0.1, Number(element.sizeY) || 1);   // floor Y size → Three.js Z size
    const sZ = Math.max(0.1, Number(element.sizeZ) || 1);   // height size  → Three.js Y size
    const hx = sX / 2, hy = sY / 2;

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
                dir, new THREE.Vector3(pX, pZ + sZ, pY)  // Three.js 상단 중심
            );
        } else {
            // 바닥 수평 평면 — Three.js Y = data Z (height base)
            plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -pZ);
        }

        const rc  = new THREE.Raycaster();
        const hit = new THREE.Vector3();

        const onMove = (ev) => {
            rc.setFromCamera(getNDC(ev.clientX, ev.clientY), camera);
            if (!rc.ray.intersectPlane(plane, hit)) return;

            // ── 높이 핸들 ─────────────────────────────────────────────
            if (type === 'top') {
                const newSZ = Math.max(0.1, parseFloat((hit.y - pZ).toFixed(3)));
                updateElementData(element.elementId, { sizeZ: newSZ });
                return;
            }

            // ── XY floor 핸들 (스냅 적용) ─────────────────────────────
            // hit.x = Three.jsX = dataX, hit.z = Three.jsZ = dataY
            let hx2 = hit.x, hy2 = hit.z;
            if (snapEnabled && snapVertices.length > 0) {
                const sv = findSnapVertex(hit.x, hit.z, snapVertices);
                if (sv) { hx2 = sv[0]; hy2 = sv[2]; }
            }

            const [ax, , az] = anchor;  // anchor: [threeX, threeY, threeZ=dataY]
            const updates = {};
            if (type === 'corner' || type === 'edge-x') {
                updates.sizeX     = Math.max(0.1, parseFloat(Math.abs(hx2 - ax).toFixed(3)));
                updates.positionX = parseFloat(((hx2 + ax) / 2).toFixed(3));
            }
            if (type === 'corner' || type === 'edge-z') {
                updates.sizeY     = Math.max(0.1, parseFloat(Math.abs(hy2 - az).toFixed(3)));  // data sizeY
                updates.positionY = parseFloat(((hy2 + az) / 2).toFixed(3));                   // data posY
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
        pX, pY, pZ, sZ,
        element.elementId, camera, getNDC,
        snapEnabled, snapVertices,
        updateElementData, pushUndo, onDragStateChange,
    ]);

    // ── 핸들 정의 — Three.js 좌표: X=dataX, Y=dataZ(height), Z=dataY(floorY)
    const handles = useMemo(() => [
        // 바닥 코너 (파란색) — X + Y(floorY) 동시 조절
        { id:'c0', pos:[pX+hx, pZ, pY+hy], type:'corner', anchor:[pX-hx, pZ, pY-hy], color:'#3b82f6', cursor:'nw-resize' },
        { id:'c1', pos:[pX+hx, pZ, pY-hy], type:'corner', anchor:[pX-hx, pZ, pY+hy], color:'#3b82f6', cursor:'ne-resize' },
        { id:'c2', pos:[pX-hx, pZ, pY+hy], type:'corner', anchor:[pX+hx, pZ, pY-hy], color:'#3b82f6', cursor:'ne-resize' },
        { id:'c3', pos:[pX-hx, pZ, pY-hy], type:'corner', anchor:[pX+hx, pZ, pY+hy], color:'#3b82f6', cursor:'nw-resize' },
        // X축 엣지 중점 (보라색) — X만 조절
        { id:'ex0', pos:[pX+hx, pZ, pY], type:'edge-x', anchor:[pX-hx, pZ, pY], color:'#8b5cf6', cursor:'ew-resize' },
        { id:'ex1', pos:[pX-hx, pZ, pY], type:'edge-x', anchor:[pX+hx, pZ, pY], color:'#8b5cf6', cursor:'ew-resize' },
        // Y(floorY)축 엣지 중점 (보라색) — Y만 조절 (type='edge-z' 유지, hit.z 기준)
        { id:'ey0', pos:[pX, pZ, pY+hy], type:'edge-z', anchor:[pX, pZ, pY-hy], color:'#8b5cf6', cursor:'ns-resize' },
        { id:'ey1', pos:[pX, pZ, pY-hy], type:'edge-z', anchor:[pX, pZ, pY+hy], color:'#8b5cf6', cursor:'ns-resize' },
        // 상단 중심 (초록색) — 높이 조절
        { id:'top', pos:[pX, pZ+sZ, pY], type:'top', anchor:null, color:'#10b981', cursor:'n-resize' },
    ], [pX, pY, pZ, hx, hy, sZ]);

    const hs = HANDLE_HALF * 2; // 핸들 한 변 길이

    return (
        <group>
            {/* CAD 바운딩 박스 와이어프레임 — Three.js [X, Y=center_height, Z=floorY] */}
            <mesh position={[pX, pZ + sZ / 2, pY]}>
                <boxGeometry args={[sX + 0.02, sZ + 0.02, sY + 0.02]} />
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
                        array={new Float32Array([pX, pZ, pY,  pX, pZ + sZ, pY])}
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
// 꼭짓점 스냅 인디케이터 (항상 표시 — 마우스 근처 꼭짓점 강조)
// ================================================================
function VertexSnapIndicator({ snapVertices, snapEnabled, viewMode = '3d' }) {
    const { camera, raycaster, mouse } = useThree();
    const groupRef = useRef();
    const plane = useMemo(() => getSnapPlane(viewMode, snapVertices), [viewMode, snapVertices]);

    useFrame(() => {
        if (!groupRef.current) return;
        if (!snapEnabled || !snapVertices.length) {
            groupRef.current.visible = false;
            return;
        }

        raycaster.setFromCamera(mouse, camera);
        const hit = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, hit)) return;

        // viewMode별 스냅 검색 좌표 선택
        const [wa, wb] = viewMode === 'xz' ? [hit.x, hit.y]
                       : viewMode === 'yz' ? [hit.z, hit.y]
                       : [hit.x, hit.z];
        const nearest = findSnapVertex(wa, wb, snapVertices, viewMode);
        groupRef.current.visible = !!nearest;
        if (nearest) {
            groupRef.current.position.set(nearest[0], (nearest[1] ?? 0) + 0.03, nearest[2]);
        }
    });

    return (
        <group ref={groupRef} visible={false}>
            {/* 외부 링 (XZ 수평) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.28, 0.055, 10, 40]} />
                <meshBasicMaterial color="#ffd700" depthTest={false} />
            </mesh>
            {/* 내부 작은 링 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.12, 0.035, 8, 32]} />
                <meshBasicMaterial color="#ff8c00" depthTest={false} />
            </mesh>
            {/* 중심 점 */}
            <mesh>
                <sphereGeometry args={[0.07, 10, 10]} />
                <meshBasicMaterial color="#ffffff" depthTest={false} />
            </mesh>
            {/* 십자선 X */}
            <line>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        array={new Float32Array([-0.55, 0.01, 0,  0.55, 0.01, 0])}
                        count={2}
                        itemSize={3}
                    />
                </bufferGeometry>
                <lineBasicMaterial color="#ffd700" depthTest={false} />
            </line>
            {/* 십자선 Z */}
            <line>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        array={new Float32Array([0, 0.01, -0.55,  0, 0.01, 0.55])}
                        count={2}
                        itemSize={3}
                    />
                </bufferGeometry>
                <lineBasicMaterial color="#ffd700" depthTest={false} />
            </line>
        </group>
    );
}

// ================================================================
// HoverTracker — 마우스 → 월드 좌표 실시간 추적 (렌더 없음)
// ================================================================
function HoverTracker({ drawHeight, snapVertices, snapEnabled, onHoverPosition, lockedAxes, shiftRef, lineStart, viewMode = '3d' }) {
    const { camera, raycaster, mouse } = useThree();
    const hitPoint = useMemo(() => new THREE.Vector3(), []);

    // 3D 모드: 잠긴 축에 따라 스냅 평면을 동적으로 선택
    const snapPlane = useMemo(() => {
        if (viewMode !== '3d') return getSnapPlane(viewMode, snapVertices);
        return getDynamicSnapPlane3D(lockedAxes);
    }, [viewMode, snapVertices, lockedAxes]);

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(snapPlane, hitPoint)) return;

        let ex, ey, ez;

        if (viewMode === '3d') {
            const xl = lockedAxes?.x != null;
            const yl = lockedAxes?.y != null;
            const zl = lockedAxes?.z != null;

            if (xl && !yl && !zl) {
                // X 고정 → 수직 평면: hitPoint에서 높이(Y)·깊이(Z) 읽기
                ex = lockedAxes.x;
                ey = hitPoint.y;  // Three.js Y = data Z (높이)
                ez = hitPoint.z;  // Three.js Z = data Y (깊이)
            } else if (yl && !xl && !zl) {
                // Y(data) 고정 → 수직 평면: hitPoint에서 X·높이(Y) 읽기
                ex = hitPoint.x;
                ey = hitPoint.y;  // Three.js Y = 높이
                ez = lockedAxes.y;
            } else {
                // Z 고정 / 미고정 → 수평 평면 (기존 동작 + 스냅)
                ex = hitPoint.x; ey = zl ? lockedAxes.z : drawHeight; ez = hitPoint.z;
                if (snapEnabled && snapVertices.length > 0) {
                    const sv = findSnapVertex(hitPoint.x, hitPoint.z, snapVertices);
                    if (sv) { ex = sv[0]; ey = sv[1] ?? drawHeight; ez = sv[2]; }
                }
                if (xl) ex = lockedAxes.x;
                if (yl) ez = lockedAxes.y;
            }
        } else {
            // 2D 직교 뷰 — 기존 로직
            ex = hitPoint.x; ey = drawHeight; ez = hitPoint.z;
            if (snapEnabled && snapVertices.length > 0) {
                const [wa, wb] = viewMode === 'xz' ? [hitPoint.x, hitPoint.y]
                               : viewMode === 'yz' ? [hitPoint.z, hitPoint.y]
                               : [hitPoint.x, hitPoint.z];
                const sv = findSnapVertex(wa, wb, snapVertices, viewMode);
                if (sv) { ex = sv[0]; ey = sv[1] ?? drawHeight; ez = sv[2]; }
            }
            if (viewMode === 'xz' || viewMode === 'yz') ey = hitPoint.y;
            if (lockedAxes?.x != null) ex = lockedAxes.x;
            if (lockedAxes?.y != null) ez = lockedAxes.y;
            if (lockedAxes?.z != null) ey = lockedAxes.z;
        }

        if (shiftRef?.current && lineStart) {
            const xl = lockedAxes?.x != null, yl = lockedAxes?.y != null;
            const dx = ex - lineStart[0], dz = ez - (lineStart[1] ?? 0);
            if (!xl && !yl) {
                if (Math.abs(dx) >= Math.abs(dz)) ez = lineStart[1] ?? 0;
                else ex = lineStart[0];
            }
        }
        onHoverPosition?.({ x: ex, y: ez, z: ey });
    });

    return null;
}

// ================================================================
// 배치 고스트 (스마트 스냅 — 센터 + 코너)
// ================================================================
function PlacementGhost({ template, onConfirm, snapVertices, snapEnabled, onHoverPosition, lockedAxes, shiftRef, viewMode = '3d' }) {
    const meshRef    = useRef();
    const wireRef    = useRef();
    const snapRef    = useRef();
    const { camera, raycaster, mouse } = useThree();

    // 3D 모드: 잠긴 축에 따라 스냅 평면을 동적으로 선택
    const snapPlane = useMemo(() => {
        if (viewMode !== '3d') return getSnapPlane(viewMode, snapVertices);
        return getDynamicSnapPlane3D(lockedAxes);
    }, [viewMode, snapVertices, lockedAxes]);

    const hitPoint  = useMemo(() => new THREE.Vector3(), []);
    const snappedPos = useRef({ x: 0, y: 0, z: 0 }); // BIM data coords

    const sizeX = template.sizeX ?? 1;
    const sizeY = template.sizeY ?? 1;
    const sizeZ = template.sizeZ ?? 1;

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(snapPlane, hitPoint)) return;

        let px, py, pz; // Three.js coords
        let snapA, snapB, snapResult;

        if (viewMode === 'xz') {
            snapA = hitPoint.x; snapB = hitPoint.y;
            snapResult = snapEnabled && snapVertices.length
                ? findSmartSnap(snapA, snapB, sizeX, sizeZ, snapVertices, viewMode) : null;
            [snapA, snapB] = snapResult ?? [snapA, snapB];
            px = snapA; py = snapB; pz = hitPoint.z;
        } else if (viewMode === 'yz') {
            snapA = hitPoint.z; snapB = hitPoint.y;
            snapResult = snapEnabled && snapVertices.length
                ? findSmartSnap(snapA, snapB, sizeY, sizeZ, snapVertices, viewMode) : null;
            [snapA, snapB] = snapResult ?? [snapA, snapB];
            px = hitPoint.x; py = snapB; pz = snapA;
        } else {
            // 3D 모드: 잠긴 축에 따라 hit 좌표 추출 방식 변경
            const xl = lockedAxes?.x != null;
            const yl = lockedAxes?.y != null;
            const zl = lockedAxes?.z != null;

            if (xl && !yl && !zl) {
                // X 고정 → 수직 평면에서 Y(깊이)·Z(높이) 읽기
                px = lockedAxes.x;
                py = hitPoint.y;   // 높이 (Three.js Y = data Z)
                pz = hitPoint.z;   // 깊이 (Three.js Z = data Y)
            } else if (yl && !xl && !zl) {
                // Y(data) 고정 → 수직 평면에서 X·Z(높이) 읽기
                px = hitPoint.x;
                py = hitPoint.y;   // 높이
                pz = lockedAxes.y;
            } else {
                // Z 고정 / 미고정 → 수평 평면 (기존 동작 + 스냅)
                snapA = hitPoint.x; snapB = hitPoint.z;
                snapResult = snapEnabled && snapVertices.length
                    ? findSmartSnap(snapA, snapB, sizeX, sizeY, snapVertices, viewMode) : null;
                [snapA, snapB] = snapResult ?? [snapA, snapB];
                if (shiftRef?.current) {
                    if (!xl) snapA = Math.round(snapA * 2) / 2;
                    if (!yl) snapB = Math.round(snapB * 2) / 2;
                }
                px = xl ? lockedAxes.x : snapA;
                py = zl ? lockedAxes.z : 0;
                pz = yl ? lockedAxes.y : snapB;
            }
        }

        // snappedPos: BIM data coords { x=dataX, y=dataY, z=dataZ(height) }
        snappedPos.current = { x: px, y: pz, z: py };
        onHoverPosition?.({ x: px, y: pz, z: py });

        const ghostY = py + sizeZ / 2;
        if (meshRef.current)  meshRef.current.position.set(px, ghostY, pz);
        if (wireRef.current)  wireRef.current.position.set(px, ghostY, pz);
        if (snapRef.current) {
            snapRef.current.visible = !!snapResult;
            if (snapResult) snapRef.current.position.set(px, py + 0.1, pz);
        }
    });

    return (
        <>
            <mesh ref={meshRef} position={[0, sizeZ / 2, 0]}>
                <boxGeometry args={[sizeX, sizeZ, sizeY]} />
                <meshStandardMaterial color={getBaseColor(template.elementType)} opacity={0.45} transparent depthWrite={false} />
            </mesh>
            <mesh ref={wireRef} position={[0, sizeZ / 2, 0]}>
                <boxGeometry args={[sizeX + 0.02, sizeZ + 0.02, sizeY + 0.02]} />
                <meshBasicMaterial color="#60a5fa" wireframe transparent opacity={0.6} />
            </mesh>
            <mesh ref={snapRef} visible={false}>
                <sphereGeometry args={[0.22, 16, 16]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.85} />
            </mesh>
            {/* 클릭 평면 — 카메라를 항상 바라보는 빌보드 (수직/수평 제한 없음) */}
            <BillboardClickPlane
                onClick={e => {
                    e.stopPropagation();
                    const s = snappedPos.current;
                    onConfirm({
                        x: lockedAxes?.x ?? s.x,
                        y: lockedAxes?.y ?? s.y,
                        z: lockedAxes?.z ?? s.z,
                    });
                }}
            />
        </>
    );
}

// ================================================================
// 선 작도 미리보기 (스냅 + 시작점 마커)
// ================================================================
function LinePreview({ lineStart, lineColor, lineWidth, drawHeight, snapVertices, snapEnabled, lockedAxes, viewMode = '3d' }) {
    const { camera, raycaster, mouse } = useThree();

    const snapPlane = useMemo(() => getSnapPlane(viewMode, snapVertices), [viewMode, snapVertices]);
    const hitPoint  = useMemo(() => new THREE.Vector3(), []);
    const snapSphRef = useRef();

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
        if (!raycaster.ray.intersectPlane(snapPlane, hitPoint)) return;

        let ex = hitPoint.x, ey = drawHeight, ez = hitPoint.z;
        let snapped = false;

        if (snapEnabled && snapVertices.length > 0) {
            const [wa, wb] = viewMode === 'xz' ? [hitPoint.x, hitPoint.y]
                           : viewMode === 'yz' ? [hitPoint.z, hitPoint.y]
                           : [hitPoint.x, hitPoint.z];
            const sv = findSnapVertex(wa, wb, snapVertices, viewMode);
            if (sv) { ex = sv[0]; ey = sv[1] ?? drawHeight; ez = sv[2]; snapped = true; }
        }
        if (!snapped && snapSphRef.current) snapSphRef.current.visible = false;

        if (viewMode === 'xz' || viewMode === 'yz') ey = hitPoint.y;

        if (lockedAxes?.x != null) ex = lockedAxes.x;
        if (lockedAxes?.y != null) ez = lockedAxes.y;
        if (lockedAxes?.z != null) ey = lockedAxes.z;

        if (snapped && snapSphRef.current) {
            snapSphRef.current.position.set(ex, ey, ez);
            snapSphRef.current.visible = true;
        }

        const pos = lineObj.geometry.attributes.position;
        pos.setXYZ(0, lineStart[0], lineStart[2] ?? 0, lineStart[1] ?? 0);
        pos.setXYZ(1, ex, ey, ez);
        pos.needsUpdate = true;
        lineObj.geometry.computeBoundingSphere();
    });

    return (
        <>
            <primitive object={lineObj} />
            <mesh position={[lineStart[0], lineStart[2] ?? 0, lineStart[1] ?? 0]}>
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
// 선 꼭짓점 좌표 추출 (BimLine과 동일한 로직)
// ================================================================
function getLinePoints(line) {
    if (line?.pointsJson) {
        try {
            const p = typeof line.pointsJson === 'string'
                ? JSON.parse(line.pointsJson) : line.pointsJson;
            if (Array.isArray(p) && p.length >= 2) return p;
        } catch (_) {}
    }
    return [line?.start ?? [0, 0, 0], line?.end ?? [1, 0, 1]];
}

// ================================================================
// 선 꼭짓점 드래그 핸들 (선택된 선에만 표시 — CAD 도면 편집 방식)
// ================================================================
function LineVertexHandles({ line, onVertexUpdate, onVertexSave, onDragStateChange }) {
    const { camera, gl } = useThree();

    const getNDC = useCallback((cx, cy) => {
        const r = gl.domElement.getBoundingClientRect();
        return new THREE.Vector2(
            ((cx - r.left) / r.width)  *  2 - 1,
            ((cy - r.top)  / r.height) * -2 + 1,
        );
    }, [gl]);

    const makeDragHandler = useCallback((vertexIndex) => (e) => {
        e.stopPropagation();
        onDragStateChange?.(true);
        document.body.style.cursor = 'crosshair';

        // 드래그 시작 시점의 꼭짓점 좌표를 기준점으로 고정
        // 데이터: [dataX, dataY(floor), dataZ(height)]
        const basePoints = getLinePoints(line).map(p => [p[0], p[1] ?? 0, p[2] ?? 0]);
        const planeZ = basePoints[vertexIndex]?.[2] ?? 0;  // data Z (height) = Three.js Y
        const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeZ);
        const rc     = new THREE.Raycaster();
        const hit    = new THREE.Vector3();
        let latestPoints = basePoints;

        const onMove = (ev) => {
            rc.setFromCamera(getNDC(ev.clientX, ev.clientY), camera);
            if (!rc.ray.intersectPlane(plane, hit)) return;
            // hit.x=Three.jsX=dataX, hit.z=Three.jsZ=dataY
            latestPoints = basePoints.map((p, i) =>
                i === vertexIndex
                    ? [parseFloat(hit.x.toFixed(3)), parseFloat(hit.z.toFixed(3)), planeZ]
                    : p
            );
            onVertexUpdate?.(line.lineId, {
                pointsJson: JSON.stringify(latestPoints),
                start: latestPoints[0],
                end:   latestPoints[latestPoints.length - 1],
            });
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup',   onUp);
            document.body.style.cursor = '';
            onDragStateChange?.(false);
            onVertexSave?.(line.lineId, latestPoints);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup',   onUp);
    }, [line, camera, getNDC, onVertexUpdate, onVertexSave, onDragStateChange]);

    const points = getLinePoints(line);

    return (
        <group>
            {points.map((pos, i) => {
                const isFirst = i === 0;
                const isLast  = i === points.length - 1 && !line.closed;
                const handleColor = isFirst ? '#4ade80' : isLast ? '#f87171' : '#00e5ff';

                return (
                    <group key={i}>
                        {/* 드래그 가능한 꼭짓점 구체 — Three.js: [X, Y=dataZ, Z=dataY] */}
                        <mesh
                            position={[pos[0], (pos[2] ?? 0) + 0.001, pos[1] ?? 0]}
                            onPointerDown={makeDragHandler(i)}
                            onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; }}
                            onPointerOut={() => { document.body.style.cursor = ''; }}
                            renderOrder={1000}
                        >
                            <sphereGeometry args={[0.22, 14, 14]} />
                            <meshBasicMaterial color={handleColor} depthTest={false} />
                        </mesh>

                        {/* 외곽 링 */}
                        <mesh
                            position={[pos[0], (pos[2] ?? 0) + 0.001, pos[1] ?? 0]}
                            rotation={[-Math.PI / 2, 0, 0]}
                            renderOrder={999}
                        >
                            <torusGeometry args={[0.34, 0.04, 8, 32]} />
                            <meshBasicMaterial color={handleColor} transparent opacity={0.55} depthTest={false} />
                        </mesh>

                        {/* 시작점 마커 */}
                        {isFirst && (
                            <mesh position={[pos[0], (pos[2] ?? 0) + 0.42, pos[1] ?? 0]}>
                                <sphereGeometry args={[0.08, 6, 6]} />
                                <meshBasicMaterial color="#4ade80" depthTest={false} />
                            </mesh>
                        )}
                    </group>
                );
            })}

            {/* 중간 꼭짓점 수 표시 라인 (꼭짓점이 3개 이상일 때) */}
            {points.length >= 3 && points.slice(0, -1).map((pos, i) => {
                const next = points[i + 1];
                const mx  = (pos[0] + next[0]) / 2;                          // dataX midpoint
                const my  = ((pos[1] ?? 0) + (next[1] ?? 0)) / 2;           // dataY midpoint → Three.jsZ
                const mz  = ((pos[2] ?? 0) + (next[2] ?? 0)) / 2;           // dataZ midpoint → Three.jsY
                return (
                    <mesh key={`mid-${i}`} position={[mx, mz + 0.001, my]} renderOrder={998}>
                        <sphereGeometry args={[0.09, 6, 6]} />
                        <meshBasicMaterial color="#94a3b8" transparent opacity={0.7} depthTest={false} />
                    </mesh>
                );
            })}
        </group>
    );
}

// ================================================================
// 거리/각도 측정 도구
// ================================================================
function MeasureHelper({ pointA, pointB, active, snapVertices, snapEnabled, viewMode, onClickPoint }) {
    const { camera, raycaster, mouse } = useThree();
    const snapPlane = useMemo(() => getSnapPlane(viewMode, snapVertices), [viewMode, snapVertices]);
    const hitRef    = useMemo(() => new THREE.Vector3(), []);
    const hoverRef  = useRef({ x: 0, y: 0, z: 0 }); // BIM data coords

    const previewPositions = useMemo(() => new Float32Array(6), []);
    const previewGeom = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(previewPositions, 3));
        return g;
    }, [previewPositions]);
    useEffect(() => () => previewGeom.dispose(), [previewGeom]);
    const previewLineRef = useRef();
    const previewDotRef  = useRef();

    useFrame(() => {
        if (!active || !pointA || pointB) return;
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(snapPlane, hitRef)) return;
        let ex = hitRef.x, ey = hitRef.y, ez = hitRef.z;
        if (snapEnabled && snapVertices.length > 0 && viewMode !== 'xz' && viewMode !== 'yz') {
            const sv = findSnapVertex(hitRef.x, hitRef.z, snapVertices);
            if (sv) { ex = sv[0]; ey = sv[1] ?? 0; ez = sv[2]; }
        }
        // BIM data coords: x=BIM_X, y=BIM_Y(floor), z=BIM_Z(height)
        hoverRef.current = { x: ex, y: ez, z: ey };
        // Update preview line: pointA → mouse (Three.js coords: [x, z_height, y_floor])
        const pos = previewGeom.attributes.position;
        pos.setXYZ(0, pointA.x, pointA.z, pointA.y);
        pos.setXYZ(1, ex, ey, ez);
        pos.needsUpdate = true;
        previewGeom.computeBoundingSphere();
        if (previewDotRef.current) previewDotRef.current.position.set(ex, ey, ez);
    });

    if (!active && (!pointA || !pointB)) return null;

    // BIM 3D distance
    const dist3D = pointA && pointB
        ? Math.sqrt((pointB.x-pointA.x)**2 + (pointB.y-pointA.y)**2 + (pointB.z-pointA.z)**2).toFixed(3)
        : null;
    // Horizontal distance (BIM XY plane)
    const distH = pointA && pointB
        ? Math.sqrt((pointB.x-pointA.x)**2 + (pointB.y-pointA.y)**2).toFixed(3)
        : null;
    // Horizontal angle relative to X axis
    const hAngle = pointA && pointB
        ? (Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x) * 180 / Math.PI).toFixed(1)
        : null;

    // Label mid-position in Three.js coords
    const midPos = pointA && pointB
        ? [(pointA.x+pointB.x)/2, (pointA.z+pointB.z)/2, (pointA.y+pointB.y)/2]
        : null;

    return (
        <>
            {pointA && (
                <mesh position={[pointA.x, pointA.z, pointA.y]} renderOrder={1001}>
                    <sphereGeometry args={[0.18, 12, 12]} />
                    <meshBasicMaterial color="#ff6b6b" depthTest={false} />
                </mesh>
            )}
            {pointB && (
                <mesh position={[pointB.x, pointB.z, pointB.y]} renderOrder={1001}>
                    <sphereGeometry args={[0.18, 12, 12]} />
                    <meshBasicMaterial color="#ff6b6b" depthTest={false} />
                </mesh>
            )}
            {pointA && pointB && (
                <line renderOrder={1001}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position"
                            array={new Float32Array([pointA.x,pointA.z,pointA.y, pointB.x,pointB.z,pointB.y])}
                            count={2} itemSize={3} />
                    </bufferGeometry>
                    <lineBasicMaterial color="#ffdd44" depthTest={false} />
                </line>
            )}
            {midPos && dist3D && (
                <Html position={midPos} center zIndexRange={[9999, 9998]}>
                    <div style={{
                        background: 'rgba(0,0,0,0.88)', color: '#ffdd44',
                        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                        border: '1.5px solid #ffdd44', whiteSpace: 'nowrap', userSelect: 'none',
                        fontFamily: 'monospace', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    }}>
                        <div>{dist3D} m</div>
                        <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>H:{distH}m · {hAngle}°</div>
                    </div>
                </Html>
            )}
            {active && pointA && !pointB && (
                <>
                    <line ref={previewLineRef} renderOrder={1000}>
                        <primitive object={previewGeom} attach="geometry" />
                        <lineBasicMaterial color="#ffdd44" transparent opacity={0.5} depthTest={false} />
                    </line>
                    <mesh ref={previewDotRef} renderOrder={1000}>
                        <sphereGeometry args={[0.12, 8, 8]} />
                        <meshBasicMaterial color="#ffdd44" transparent opacity={0.7} depthTest={false} />
                    </mesh>
                </>
            )}
            {active && !(pointA && pointB) && (
                <BillboardClickPlane onClick={(e) => {
                    e.stopPropagation();
                    onClickPoint?.({ ...hoverRef.current });
                }} />
            )}
        </>
    );
}

// ================================================================
// 치수 표시 (선택된 부재 크기 라벨)
// ================================================================
function DimensionLabel({ element }) {
    if (!element) return null;
    const pX = Number(element.positionX) || 0;
    const pY = Number(element.positionY) || 0;
    const pZ = Number(element.positionZ) || 0;
    const sX = Number(element.sizeX)     || 0.1;
    const sY = Number(element.sizeY)     || 0.1;
    const sZ = Number(element.sizeZ)     || 0.1;
    // Three.js center
    const cy = pZ + sZ / 2;

    const base = { background:'rgba(0,0,0,0.78)', padding:'2px 7px', borderRadius:5, fontSize:11,
                   fontWeight:700, whiteSpace:'nowrap', userSelect:'none', fontFamily:'monospace' };
    return (
        <>
            {/* Width X */}
            <Html position={[pX, pZ - 0.15, pY + sY/2 + 0.45]} center zIndexRange={[9990,9989]}>
                <div style={{...base, color:'#60a5fa', border:'1px solid #3b82f6'}}>W {sX.toFixed(2)}m</div>
            </Html>
            {/* Depth Y */}
            <Html position={[pX + sX/2 + 0.45, pZ - 0.15, pY]} center zIndexRange={[9990,9989]}>
                <div style={{...base, color:'#a78bfa', border:'1px solid #7c3aed'}}>D {sY.toFixed(2)}m</div>
            </Html>
            {/* Height Z */}
            <Html position={[pX + sX/2 + 0.45, cy, pY]} center zIndexRange={[9990,9989]}>
                <div style={{...base, color:'#4ade80', border:'1px solid #16a34a'}}>H {sZ.toFixed(2)}m</div>
            </Html>
        </>
    );
}

// ================================================================
// 단면 절단 — THREE 글로벌 클리핑 평면 설정
// ================================================================
function SectionCutEffect({ enabled, axis, value }) {
    const { gl } = useThree();
    useEffect(() => {
        if (!enabled) { gl.clippingPlanes = []; return () => { gl.clippingPlanes = []; }; }
        // 축별 법선 벡터: axis=x → Three.js X, axis=y → Three.js Z(BIM Y), axis=z → Three.js Y(BIM Z)
        const normals = {
            x: new THREE.Vector3(-1, 0, 0),
            y: new THREE.Vector3(0, 0, -1),
            z: new THREE.Vector3(0, -1, 0),
        };
        gl.clippingPlanes = [new THREE.Plane(normals[axis] ?? normals.z, value)];
        return () => { gl.clippingPlanes = []; };
    }, [enabled, axis, value, gl]);
    return null;
}

// ================================================================
// Walk / Fly 모드 컨트롤러 (WASD + QE 상하)
// OrbitControls는 그대로 유지하면서 카메라+target을 함께 이동
// ================================================================
function WalkController({ active, orbitRef, onExit }) {
    const keysRef = useRef({});
    const { camera } = useThree();
    useEffect(() => {
        if (!active) return;
        const onDown = (e) => {
            if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
            keysRef.current[e.code] = true;
            if (e.code === 'Escape') onExit?.();
        };
        const onUp = (e) => { keysRef.current[e.code] = false; };
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup',   onUp);
        return () => {
            window.removeEventListener('keydown', onDown);
            window.removeEventListener('keyup',   onUp);
            keysRef.current = {};
        };
    }, [active, onExit]);

    useFrame((_, delta) => {
        if (!active || !orbitRef?.current) return;
        const speed = 8 * delta;
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
        const move  = new THREE.Vector3();
        if (keysRef.current['KeyW'] || keysRef.current['ArrowUp'])    move.addScaledVector(forward,  speed);
        if (keysRef.current['KeyS'] || keysRef.current['ArrowDown'])   move.addScaledVector(forward, -speed);
        if (keysRef.current['KeyA'] || keysRef.current['ArrowLeft'])   move.addScaledVector(right,  -speed);
        if (keysRef.current['KeyD'] || keysRef.current['ArrowRight'])  move.addScaledVector(right,   speed);
        if (keysRef.current['KeyE'] || keysRef.current['PageUp'])   move.y += speed;
        if (keysRef.current['KeyQ'] || keysRef.current['PageDown']) move.y -= speed;
        if (move.lengthSq() > 0) {
            camera.position.add(move);
            orbitRef.current.target.add(move);
            orbitRef.current.update();
        }
    });
    return null;
}

// ================================================================
// 2D 직교 투영 카메라
// viewMode: 'xy'=평면도(위), 'xz'=정면도(앞), 'yz'=측면도(옆)
// BIM 좌표 → Three.js 변환 기준: posX→X, posY→Z, posZ→Y
// ================================================================
function Ortho2DCamera({ viewMode, modelData, orbitRef }) {
    const bounds = useMemo(() => {
        if (!modelData.length) return { cx: 0, cy: 0, cz: 0, spanXZ: 20, spanXY: 10, spanZY: 20 };
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity; // Three.js Y = BIM Z (높이)
        let minZ = Infinity, maxZ = -Infinity; // Three.js Z = BIM Y (남북)
        for (const el of modelData) {
            const px = Number(el.positionX) || 0;
            const py = Number(el.positionY) || 0;  // BIM Y → Three.js Z
            const pz = Number(el.positionZ) || 0;  // BIM Z (높이) → Three.js Y
            const hx = (Number(el.sizeX) || 0.1) / 2;
            const hy = (Number(el.sizeY) || 0.1) / 2;
            const sz = Number(el.sizeZ) || 0.1;
            if (px - hx < minX) minX = px - hx; if (px + hx > maxX) maxX = px + hx;
            if (pz       < minY) minY = pz;      if (pz + sz  > maxY) maxY = pz + sz;
            if (py - hy < minZ) minZ = py - hy;  if (py + hy > maxZ) maxZ = py + hy;
        }
        return {
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2, // Three.js Y center (높이 중심)
            cz: (minZ + maxZ) / 2, // Three.js Z center (남북 중심)
            spanXZ: Math.max(maxX - minX, maxZ - minZ, 5), // XY 평면도용 (BIM XY)
            spanXY: Math.max(maxX - minX, maxY - minY, 5), // XZ 정면도용 (BIM X × 높이)
            spanZY: Math.max(maxZ - minZ, maxY - minY, 5), // YZ 측면도용 (BIM Y × 높이)
        };
    }, [modelData]);

    const { cx, cy, cz } = bounds;

    // 카메라 위치 · 방향 결정
    const { pos, up, span } = useMemo(() => {
        const pad = 2.5;
        if (viewMode === 'xy') {
            // 평면도: 위에서 아래로 — Three.js Y+ 방향에서 바라봄
            // 화면: X=BIM X(동서), Z=BIM Y(남북)
            const d = bounds.spanXZ * pad;
            return { pos: [cx, cy + d, cz], up: [0, 0, -1], span: bounds.spanXZ };
        } else if (viewMode === 'xz') {
            // 정면도: Three.js Z+ 방향에서 바라봄
            // 화면: X=BIM X(동서), Y=BIM Z(높이)
            const d = bounds.spanXY * pad;
            return { pos: [cx, cy, cz + d], up: [0, 1, 0], span: bounds.spanXY };
        } else {
            // 측면도(yz): Three.js X+ 방향에서 바라봄
            // 화면: Z=BIM Y(남북), Y=BIM Z(높이)
            const d = bounds.spanZY * pad;
            return { pos: [cx + d, cy, cz], up: [0, 1, 0], span: bounds.spanZY };
        }
    }, [viewMode, bounds, cx, cy, cz]);

    // 모델에 맞는 초기 zoom 계산 (canvas 약 800px 기준)
    const zoom = useMemo(() => Math.max(5, Math.min(300, 600 / (span || 10))), [span]);

    // 카메라 전환 시 orbit target을 모델 중심으로 이동
    useEffect(() => {
        if (!orbitRef?.current) return;
        orbitRef.current.target.set(cx, cy, cz);
        orbitRef.current.update();
    }, [viewMode, cx, cy, cz]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <OrthographicCamera
            makeDefault
            position={pos}
            up={up}
            zoom={zoom}
            near={-5000}
            far={5000}
        />
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
    // 선 꼭짓점 드래그
    onLineVertexUpdate,
    onLineVertexSave,
    // 스냅
    snapEnabled = true,
    // 마우스 → 월드 좌표 실시간 콜백 (커맨드바 좌표 표시용)
    onHoverPosition = null,
    // 고정된 축 ({x,y,z} 각 null|number)
    placementLockedAxes = null,
    lineLockedAxes = null,
    // IFC 실제 지오메트리 (옵션) — 있으면 BimElement 박스 대신 렌더링
    ifcMeshes = null,
    // 카메라 자동 맞춤 수동 트리거 (숫자가 바뀌면 재맞춤)
    fitCameraTrigger = 0,
    // 표준 뷰 프리셋: 'iso'|'top'|'front'|'right'|'left'|'back' + 타임스탬프
    viewPreset = null,
    // 2D 투영 뷰 모드: '3d'|'xy'|'xz'|'yz'
    viewMode = '3d',
    // 거리/각도 측정 도구
    measureMode = false,
    measurePointA = null,
    measurePointB = null,
    onMeasureClick = null,
    // 치수 표시
    showDimensions = false,
    // 단면 절단
    sectionCutEnabled = false,
    sectionCutAxis = 'z',
    sectionCutValue = 20,
    // Walk/Fly 모드
    walkMode = false,
    onWalkModeExit = null,
    // Named view 저장용 orbit target ref (외부에서 inject)
    orbitTargetRef = null,
}) {
    const { camera } = useThree();
    const transformRef     = useRef();
    const orbitRef         = useRef();
    const shiftRef         = useRef(false);
    const ifcMeshGroupRef  = useRef();

    // IFC 다중 선택 트랜스폼용 피벗 객체 (가시성 없는 Object3D, TransformControls의 attach 대상)
    const pivotObj = useMemo(() => new THREE.Object3D(), []);
    const pivotInitialState = useRef(null); // { pos, rot, scale, elements: {id → elementData} }

    // 현재 선택된 모든 elementId Set (primary + multiSelected)
    const allSelectedIds = useMemo(() => {
        const ids = new Set(selectedElements);
        if (selectedElement?.data?.elementId) ids.add(selectedElement.data.elementId);
        return ids;
    }, [selectedElements, selectedElement]);

    // 클로저 안에서 최신 allSelectedIds를 쓰기 위한 ref
    const allSelectedIdsRef = useRef(allSelectedIds);
    useEffect(() => { allSelectedIdsRef.current = allSelectedIds; }, [allSelectedIds]);

    useEffect(() => {
        const handler = (e) => { shiftRef.current = e.shiftKey; };
        window.addEventListener('keydown', handler);
        window.addEventListener('keyup', handler);
        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keyup', handler);
        };
    }, []);
    // IFC 모드에서 선택이 바뀌면 피벗을 선택 요소들의 무게중심으로 이동
    useEffect(() => {
        if (!ifcMeshes?.length || allSelectedIds.size === 0) return;
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;
        for (const el of modelData) {
            if (!allSelectedIds.has(el.elementId)) continue;
            // Three.js: X=posX, Y=posZ+sizeZ/2(높이 중심), Z=posY
            sumX += Number(el.positionX) || 0;
            sumY += (Number(el.positionZ) || 0) + (Number(el.sizeZ) || 0) / 2;
            sumZ += Number(el.positionY) || 0;
            count++;
        }
        if (count > 0) {
            pivotObj.position.set(sumX / count, sumY / count, sumZ / count);
            pivotObj.rotation.set(0, 0, 0);
            pivotObj.scale.set(1, 1, 1);
        }
    }, [allSelectedIds, modelData, ifcMeshes, pivotObj]);

    const [isDragging,            setIsDragging]            = useState(false);
    const [isResizeDragging,      setIsResizeDragging]      = useState(false);
    const [isLineVertexDragging,  setIsLineVertexDragging]  = useState(false);
    const startPositionsRef = useRef({});

    // ── 스냅 꼭짓점 수집 ─────────────────────────────────────────────
    // 스냅은 부재 배치(pendingElement) 또는 선 작도(lineDrawMode=click) 중에만 활성화
    // → 일반 선택/편집 중에는 빈 배열을 반환해 인디케이터/핸들 스냅을 완전 비활성화
    const snapVertices = useMemo(() => {
        if (!snapEnabled) return [];
        if (!pendingElement && lineDrawMode !== 'click') return [];
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
            // 좌표 규칙: positionX/Y=평면, positionZ=높이 → Three.js: X=posX, Y=posZ, Z=posY
            const ex = Number(el.positionX)||0, ey = Number(el.positionY)||0, ez = Number(el.positionZ)||0;
            const esx = (Number(el.sizeX)||1)/2, esy = (Number(el.sizeY)||1)/2, esz = Number(el.sizeZ)||1;
            // 스냅 꼭짓점: Three.js [X, Y=height, Z=floorY]
            for (const dx of [-1,1]) for (const dy of [-1,1]) {
                verts.push([ex+dx*esx, ez,      ey+dy*esy]);  // 바닥 코너
                verts.push([ex+dx*esx, ez+esz,  ey+dy*esy]);  // 상단 코너
            }
            verts.push([ex, ez,      ey]);  // 중심 바닥
            verts.push([ex, ez+esz,  ey]);  // 중심 상단
        }
        return verts;
    }, [snapEnabled, pendingElement, lineDrawMode, lines, modelData]);

    // ── 표준 뷰 프리셋 ────────────────────────────────────────────────
    // viewPreset = { id: 'iso'|'top'|'front'|'right'|'left'|'back', ts: number }
    const prevPresetRef = useRef(null);
    useEffect(() => {
        if (!viewPreset || !orbitRef.current) return;
        if (prevPresetRef.current === viewPreset.ts) return;
        prevPresetRef.current = viewPreset.ts;

        // 모델 AABB → 중심 + 스팬 계산
        let cx = 0, cy = 0, cz = 0, span = 20;
        if (modelData.length > 0) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            for (const el of modelData) {
                const px = Number(el.positionX)||0, py = Number(el.positionY)||0, pz = Number(el.positionZ)||0;
                const hx = (Number(el.sizeX)||0.1)/2, hy = (Number(el.sizeY)||0.1)/2, sz = Number(el.sizeZ)||0.1;
                if (px-hx < minX) minX = px-hx; if (px+hx > maxX) maxX = px+hx;
                if (pz    < minY) minY = pz;      if (pz+sz  > maxY) maxY = pz+sz;  // Three.js Y = data Z
                if (py-hy < minZ) minZ = py-hy; if (py+hy > maxZ) maxZ = py+hy;     // Three.js Z = data Y
            }
            cx = (minX+maxX)/2; cy = (minY+maxY)/2; cz = (minZ+maxZ)/2;
            span = Math.max(maxX-minX, maxY-minY, maxZ-minZ, 1);
        }
        const d = span * 1.6;
        const center = new THREE.Vector3(cx, cy, cz);

        // Three.js 좌표계: Y=위(높이), X=동, Z=남(IFC Y)
        // BIM 표준 뷰 (IFC Z-up 기준으로 레이블)
        const positions = {
            iso:   new THREE.Vector3(cx+d*0.65, cy+d*0.55, cz+d*0.65), // 등각
            top:   new THREE.Vector3(cx, cy+d,  cz),                     // 평면도 (위에서 아래)
            bottom:new THREE.Vector3(cx, cy-d,  cz),                     // 하면도
            front: new THREE.Vector3(cx, cy,    cz+d),                   // 정면도
            back:  new THREE.Vector3(cx, cy,    cz-d),                   // 배면도
            right: new THREE.Vector3(cx+d, cy,  cz),                     // 우측면도
            left:  new THREE.Vector3(cx-d, cy,  cz),                     // 좌측면도
        };

        // Named view (커스텀 저장 뷰)
        if (viewPreset.id === 'named') {
            if (viewPreset.position) camera.position.copy(viewPreset.position);
            if (viewPreset.target) {
                orbitRef.current.target.copy(viewPreset.target);
                camera.lookAt(viewPreset.target);
            }
            orbitRef.current.update();
            return;
        }

        const pos = positions[viewPreset.id];
        if (!pos) return;

        camera.position.copy(pos);
        camera.lookAt(center);
        orbitRef.current.target.copy(center);
        orbitRef.current.update();
    }, [viewPreset]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 카메라 추적 + 미니맵 네비게이션 ─────────────────────────────
    useFrame(() => {
        setMainCameraPosition(camera.position.clone());
        setMainCameraYaw?.(camera.rotation.y);
        // Named View 저장용 orbit target 갱신
        if (orbitTargetRef && orbitRef.current) orbitTargetRef.current = orbitRef.current.target.clone();
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

    // ── TransformControls 드래그 완료 ────────────────────────────────
    const handleTransformComplete = useCallback(() => {
        const isIfcMode = !!(ifcMeshes?.length);

        // ── IFC 모드: 피벗 델타 기반 ───────────────────────────────────
        if (isIfcMode) {
            const initial = pivotInitialState.current;
            const ids     = allSelectedIdsRef.current;
            if (!initial || ids.size === 0) return;

            if (transformMode === 'translate') {
                // Three.js X = data X, Three.js Y = data Z (높이), Three.js Z = data Y (깊이)
                const dx = pivotObj.position.x - initial.pos.x;
                const dy = pivotObj.position.y - initial.pos.y; // data Z 방향
                const dz = pivotObj.position.z - initial.pos.z; // data Y 방향

                for (const [id, el] of Object.entries(initial.elements)) {
                    updateElementData(id, {
                        positionX: parseFloat(((el.positionX ?? 0) + dx).toFixed(3)),
                        positionY: parseFloat(((el.positionY ?? 0) + dz).toFixed(3)),
                        positionZ: parseFloat(((el.positionZ ?? 0) + dy).toFixed(3)),
                    });
                }
                // 메시 최종 위치 확정 (change 이벤트로 이미 연속 업데이트 중이었으므로 절대값으로 확정)
                if (initial.meshPositions) {
                    ifcMeshGroupRef.current?.applyTranslateAbsolute(ids, initial.meshPositions, dx, dy, dz);
                }

            } else if (transformMode === 'rotate') {
                // 피벗 회전 변화량: q_final * q_initial^-1
                const qFinal   = new THREE.Quaternion().setFromEuler(pivotObj.rotation);
                const qInitial = new THREE.Quaternion().setFromEuler(initial.rot);
                const dq = qFinal.multiply(qInitial.invert());
                const centroid = initial.pos.clone();

                for (const [id, el] of Object.entries(initial.elements)) {
                    // Three.js 공간에서 원래 중심 좌표
                    const origCenter = new THREE.Vector3(
                        el.positionX ?? 0,
                        (el.positionZ ?? 0) + (el.sizeZ ?? 0) / 2,
                        el.positionY ?? 0,
                    );
                    // 무게중심 기준으로 회전
                    const newCenter = origCenter.clone().sub(centroid).applyQuaternion(dq).add(centroid);
                    const dEuler = new THREE.Euler().setFromQuaternion(dq);
                    updateElementData(id, {
                        positionX: parseFloat(newCenter.x.toFixed(3)),
                        positionY: parseFloat(newCenter.z.toFixed(3)),
                        positionZ: parseFloat((newCenter.y - (el.sizeZ ?? 0) / 2).toFixed(3)),
                        rotationX: parseFloat(((el.rotationX ?? 0) + dEuler.x).toFixed(5)),
                        rotationY: parseFloat(((el.rotationY ?? 0) + dEuler.y).toFixed(5)),
                        rotationZ: parseFloat(((el.rotationZ ?? 0) + dEuler.z).toFixed(5)),
                    });
                }
                ifcMeshGroupRef.current?.applyRotate(ids, centroid, dq);
                pivotObj.rotation.set(0, 0, 0);

            } else if (transformMode === 'scale') {
                const sx = pivotObj.scale.x;
                const sy = pivotObj.scale.y; // Three.js Y scale = data sizeZ
                const sz = pivotObj.scale.z; // Three.js Z scale = data sizeY
                const centroid = initial.pos.clone();

                for (const [id, el] of Object.entries(initial.elements)) {
                    const origCenter = new THREE.Vector3(
                        el.positionX ?? 0,
                        (el.positionZ ?? 0) + (el.sizeZ ?? 0) / 2,
                        el.positionY ?? 0,
                    );
                    const newCenter = origCenter.clone().sub(centroid).multiply(new THREE.Vector3(sx, sy, sz)).add(centroid);
                    updateElementData(id, {
                        positionX: parseFloat(newCenter.x.toFixed(3)),
                        positionY: parseFloat(newCenter.z.toFixed(3)),
                        positionZ: parseFloat((newCenter.y - (el.sizeZ ?? 0) * sy / 2).toFixed(3)),
                        sizeX: parseFloat(((el.sizeX ?? 1) * sx).toFixed(3)),
                        sizeY: parseFloat(((el.sizeY ?? 1) * sz).toFixed(3)),
                        sizeZ: parseFloat(((el.sizeZ ?? 1) * sy).toFixed(3)),
                    });
                }
                ifcMeshGroupRef.current?.applyScale(ids, centroid, sx, sy, sz);
                pivotObj.scale.set(1, 1, 1);
            }
            return;
        }

        // ── 비-IFC 모드 (BimElement 박스): 기존 로직 ──────────────────
        const ctrl = transformRef.current;
        const mesh = ctrl?.object;
        if (!mesh?.userData?.elementId) return;
        const id = mesh.userData.elementId;

        if (transformMode === 'translate') {
            const rawSize = mesh.userData.rawSize ?? [1,1,1];
            const baseZ   = mesh.position.y - rawSize[1] / 2;
            const nx = parseFloat(mesh.position.x.toFixed(3));
            const ny = parseFloat(mesh.position.z.toFixed(3));
            const nz = parseFloat(baseZ.toFixed(3));
            const sp = startPositionsRef.current[id];
            const dx = nx-(sp?.positionX??nx), dy = ny-(sp?.positionY??ny), dz = nz-(sp?.positionZ??nz);
            updateElementData(id, { positionX: nx, positionY: ny, positionZ: nz });
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
            const sx = mesh.scale.x, sy = mesh.scale.y, sz = mesh.scale.z;
            updateElementData(id, {
                sizeX: parseFloat((rawSize[0]*sx).toFixed(3)),
                sizeZ: parseFloat((rawSize[1]*sy).toFixed(3)),
                sizeY: parseFloat((rawSize[2]*sz).toFixed(3)),
            });
            mesh.scale.set(1,1,1);
            // 다중 선택: 보조 요소들도 같은 배율로 크기 변경
            if (selectedElements?.size > 1) {
                for (const sid of selectedElements) {
                    if (sid === id) continue;
                    const s = startPositionsRef.current[sid];
                    if (!s) continue;
                    updateElementData(sid, {
                        sizeX: parseFloat(((s.sizeX??1)*sx).toFixed(3)),
                        sizeZ: parseFloat(((s.sizeZ??1)*sy).toFixed(3)),
                        sizeY: parseFloat(((s.sizeY??1)*sz).toFixed(3)),
                    });
                }
            }
        } else if (transformMode === 'rotate') {
            const rx = mesh.rotation.x, ry = mesh.rotation.y, rz = mesh.rotation.z;
            updateElementData(id, {
                rotationX: parseFloat(rx.toFixed(5)),
                rotationY: parseFloat(ry.toFixed(5)),
                rotationZ: parseFloat(rz.toFixed(5)),
            });
            // 다중 선택: 보조 요소들도 같은 회전 델타 적용
            if (selectedElements?.size > 1) {
                const s0 = startPositionsRef.current[id];
                const drx = rx - (s0?.rotationX??0);
                const dry = ry - (s0?.rotationY??0);
                const drz = rz - (s0?.rotationZ??0);
                for (const sid of selectedElements) {
                    if (sid === id) continue;
                    const s = startPositionsRef.current[sid];
                    if (!s) continue;
                    updateElementData(sid, {
                        rotationX: parseFloat(((s.rotationX??0)+drx).toFixed(5)),
                        rotationY: parseFloat(((s.rotationY??0)+dry).toFixed(5)),
                        rotationZ: parseFloat(((s.rotationZ??0)+drz).toFixed(5)),
                    });
                }
            }
        }
    }, [transformMode, selectedElements, updateElementData, ifcMeshes, pivotObj]);

    useEffect(() => {
        const ctrl = transformRef.current;
        if (!ctrl) return;

        const onDrag = (e) => {
            setIsDragging(e.value);
            if (e.value) {
                pushUndo?.();
                if (ifcMeshes?.length) {
                    // IFC 모드: 피벗 + 메시 초기 상태 스냅샷
                    const elements = {}, meshPositions = {};
                    for (const id of allSelectedIdsRef.current) {
                        const el = modelData.find(d => d.elementId === id);
                        if (el) elements[id] = { ...el };
                        const mp = ifcMeshGroupRef.current?.getMeshPosition(id);
                        if (mp) meshPositions[id] = mp;
                    }
                    pivotInitialState.current = {
                        pos:   pivotObj.position.clone(),
                        rot:   pivotObj.rotation.clone(),
                        scale: pivotObj.scale.clone(),
                        elements,
                        meshPositions,
                    };
                } else {
                    // 비-IFC 모드: 위치 + 크기 + 회전 스냅샷
                    startPositionsRef.current = {};
                    modelData.forEach(el => {
                        startPositionsRef.current[el.elementId] = {
                            positionX: el.positionX ?? 0,
                            positionY: el.positionY ?? 0,
                            positionZ: el.positionZ ?? 0,
                            sizeX: el.sizeX ?? 1,
                            sizeY: el.sizeY ?? 1,
                            sizeZ: el.sizeZ ?? 1,
                            rotationX: el.rotationX ?? 0,
                            rotationY: el.rotationY ?? 0,
                            rotationZ: el.rotationZ ?? 0,
                        };
                    });
                }
            }
            if (!e.value) handleTransformComplete();
        };

        // IFC translate 전용: 드래그 중 메시가 기즈모를 실시간으로 따라오게 한다
        const onChange = () => {
            if (!ifcMeshes?.length || transformMode !== 'translate') return;
            const initial = pivotInitialState.current;
            if (!initial?.meshPositions) return;
            const ids = allSelectedIdsRef.current;
            const dx = pivotObj.position.x - initial.pos.x;
            const dy = pivotObj.position.y - initial.pos.y;
            const dz = pivotObj.position.z - initial.pos.z;
            ifcMeshGroupRef.current?.applyTranslateAbsolute(ids, initial.meshPositions, dx, dy, dz);
        };

        ctrl.addEventListener('dragging-changed', onDrag);
        ctrl.addEventListener('change', onChange);
        return () => {
            ctrl.removeEventListener('dragging-changed', onDrag);
            ctrl.removeEventListener('change', onChange);
        };
    }, [transformMode, modelData, selectedElement, selectedElements, handleTransformComplete, pushUndo, ifcMeshes, pivotObj]);

    // HoverTracker가 계산한 최신 선 위치 (스냅·고정축·shift 직교 모두 반영)
    const lineHoverPosRef = useRef({ x: 0, y: 0, z: 0 });

    // ── 선 클릭: HoverTracker가 이미 처리한 좌표를 그대로 사용 ──────
    const handleLinePlaneClick = (e) => {
        e.stopPropagation();
        // lineHoverPosRef는 HoverTracker의 onHoverPosition에서 data 좌표로 갱신됨
        // { x=dataX, y=dataY, z=dataZ(height) }
        const h = lineHoverPosRef.current;
        onLineClick?.({ x: h.x, y: h.y, z: h.z });
    };

    // OrbitControls: 드래그 중 / 리사이즈 핸들 드래그 중 / 선 꼭짓점 드래그 중 / 선택모드 / 선 작도 중 / 워크모드 비활성화
    const orbitEnabled = !isDragging && !isResizeDragging && !isLineVertexDragging && !isSelectMode && lineDrawMode !== 'click' && !walkMode;

    // 리사이즈 핸들 표시 조건
    const showHandles = selectedElement && !pendingElement && !isSelectMode;

    return (
        <>
            <CameraSync cameraRef={cameraRef} />

            {/* 2D 투영 뷰: OrthographicCamera + 회전 잠금 */}
            {viewMode !== '3d' && (
                <Ortho2DCamera
                    viewMode={viewMode}
                    modelData={modelData}
                    orbitRef={orbitRef}
                />
            )}

            {/* IFC 로드 시 카메라 자동 맞춤 */}
            {ifcMeshes && ifcMeshes.length > 0 && (
                <CameraAutoFit
                    ifcMeshes={ifcMeshes}
                    modelData={modelData}
                    orbitRef={orbitRef}
                    fitTrigger={fitCameraTrigger}
                />
            )}

            <OrbitControls
                ref={orbitRef}
                enabled={orbitEnabled}
                enableZoom
                enableRotate={viewMode === '3d'}
                enablePan
                makeDefault
            />

            {/* CAD 흑백 도면을 위해 전반적 조도를 높이고 그림자 광원을 부드럽게 */}
            <ambientLight intensity={envPreset?.light?.ambientIntensity ?? 1.1} />
            <directionalLight
                position={envPreset?.light?.dirPos ?? [10,10,10]}
                color={envPreset?.light?.dirColor ?? '#ffffff'}
                intensity={envPreset?.light?.dirIntensity ?? 0.7}
                castShadow shadow-mapSize={[2048,2048]}
            />
            <directionalLight position={[-10,5,-10]} intensity={(envPreset?.light?.dirIntensity??0.7)*0.35} />

            {/* 피벗 Object3D — IFC 다중 선택 트랜스폼의 attach 대상 (렌더링 없음) */}
            <primitive object={pivotObj} />

            {/* TransformControls
                - IFC 모드: 선택 요소가 있으면 피벗에 연결 (단일/다중 모두)
                - 비-IFC 모드: 기존처럼 selectedElement mesh에 연결 */}
            {!isResizeDragging && (() => {
                if (ifcMeshes?.length) {
                    if (allSelectedIds.size === 0) return null;
                    return (
                        <TransformControls
                            ref={transformRef}
                            object={pivotObj}
                            mode={transformMode}
                        />
                    );
                }
                if (!selectedElement?.meshRef?.current) return null;
                return (
                    <TransformControls
                        ref={transformRef}
                        object={selectedElement.meshRef.current}
                        mode={transformMode}
                    />
                );
            })()}

            {/* BIM 부재 — IFC 실제 지오메트리가 있으면 대체 렌더링 */}
            {ifcMeshes && ifcMeshes.length > 0 ? (
                <IFCMeshGroup
                    ref={ifcMeshGroupRef}
                    ifcMeshes={ifcMeshes}
                    modelData={modelData}
                    onElementSelect={onElementSelect}
                    selectedElement={selectedElement}
                    selectedElements={selectedElements}
                />
            ) : (
                modelData.map(element => (
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
                ))
            )}

            {/* CAD 리사이즈 핸들 — IFC 모드에서는 숨김 */}
            {showHandles && !ifcMeshes?.length && (
                <ElementResizeHandles
                    element={selectedElement.data}
                    updateElementData={updateElementData}
                    pushUndo={pushUndo}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    onDragStateChange={setIsResizeDragging}
                />
            )}

            {/* 꼭짓점 스냅 인디케이터 — 배치(pendingElement) 또는 선 작도 중에만 표시
                일반 선택/편집 모드에서는 렌더링 자체를 하지 않아 레이캐스트 간섭 원천 차단 */}
            {(!!pendingElement || lineDrawMode === 'click') && (
                <VertexSnapIndicator
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    viewMode={viewMode}
                />
            )}

            {/* 배치 고스트 */}
            {pendingElement && (
                <PlacementGhost
                    template={pendingElement}
                    onConfirm={onPlacementConfirm}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    onHoverPosition={onHoverPosition}
                    lockedAxes={placementLockedAxes}
                    shiftRef={shiftRef}
                    viewMode={viewMode}
                />
            )}

            {/* 선 작도 클릭 평면 + hover tracker */}
            {lineDrawMode === 'click' && (
                <>
                    <HoverTracker
                        drawHeight={lineDrawHeight}
                        snapVertices={snapVertices}
                        snapEnabled={snapEnabled}
                        onHoverPosition={(pos) => {
                            // lineHoverPosRef 갱신 (클릭 핸들러에서 사용)
                            lineHoverPosRef.current = pos;
                            onHoverPosition?.(pos);
                        }}
                        lockedAxes={lineLockedAxes}
                        shiftRef={shiftRef}
                        lineStart={lineStart}
                        viewMode={viewMode}
                    />
                    {/* 카메라 방향 빌보드: 잠긴 축(수직 평면)에서도 클릭 캡처 가능 */}
                    <BillboardClickPlane onClick={handleLinePlaneClick} />
                </>
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
                    lockedAxes={lineLockedAxes}
                    viewMode={viewMode}
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

            {/* 선 꼭짓점 드래그 핸들 — 선이 선택됐고 작도 모드가 아닐 때 표시 */}
            {selectedLineId && lineDrawMode === 'off' && (() => {
                const selLine = lines.find(l => l.lineId === selectedLineId);
                return selLine ? (
                    <LineVertexHandles
                        line={selLine}
                        onVertexUpdate={onLineVertexUpdate}
                        onVertexSave={onLineVertexSave}
                        onDragStateChange={setIsLineVertexDragging}
                    />
                ) : null;
            })()}

            {/* 거리/각도 측정 도구 */}
            {measureMode && (
                <MeasureHelper
                    pointA={measurePointA}
                    pointB={measurePointB}
                    active={measureMode}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    viewMode={viewMode}
                    onClickPoint={onMeasureClick}
                />
            )}

            {/* 치수 표시 */}
            {showDimensions && selectedElement?.data && (
                <DimensionLabel element={selectedElement.data} />
            )}

            {/* 단면 절단 */}
            <SectionCutEffect enabled={sectionCutEnabled} axis={sectionCutAxis} value={sectionCutValue} />

            {/* Walk / Fly 모드 */}
            {walkMode && (
                <WalkController active={walkMode} orbitRef={orbitRef} onExit={onWalkModeExit} />
            )}

            {/* 월드 좌표계 축 (X=빨강, Y=초록, Z=파랑) */}
            <axesHelper args={[5]} />

            {/* 그리드 — 수면/터널/젖은지면 프리셋은 별도 지면을 사용하므로 숨김 */}
            {!envPreset?.useWater && !envPreset?.useTunnel && !envPreset?.useWetGround && (
                <gridHelper
                    args={[100,100,
                        envPreset?.id==='night' ? '#1a2040' : '#334155',
                        envPreset?.id==='night' ? '#0d1020' : '#1e293b',
                    ]}
                    position={[0,-0.01,0]}
                    rotation={[Math.PI / 2, 0, 0]}
                />
            )}

            <Suspense fallback={null}>
                {envPreset && <SkyEnvironment preset={envPreset} />}
            </Suspense>

        </>
    );
}
