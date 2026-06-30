import React, { useRef, useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls, OrthographicCamera, Html, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, getBaseColor } from '../element/BimElement';
import { BimLine } from '../element/BimLine';
import { IFCMeshGroup } from '../element/IFCMeshGroup';
import { GltfBimViewerSuspense } from '../element/GltfBimViewer';
import SkyEnvironment from './SkyEnvironment';

// ================================================================
// 스냅 상수 & 유틸
// ================================================================
const SNAP_THRESHOLD = 3.0;
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
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Z-up 바닥 평면 (법선=Z)
}

/**
 * viewMode별 2D 거리로 가장 가까운 스냅 꼭짓점 반환 (Z-up 기준)
 * verts = [X, Y, Z(높이)]
 * - 3d/xy : X·Y 거리 (바닥 평면 XY)
 * - xz    : X·Z 거리 (정면 — X=동서, Z=높이)
 * - yz    : Y·Z 거리 (측면 — Y=남북, Z=높이)
 */
function findSnapVertex(wa, wb, verts, viewMode) {
    let best = null, min = SNAP_THRESHOLD;
    for (const v of verts) {
        let d;
        if (viewMode === 'xz')     d = Math.hypot(wa - v[0], wb - v[2]); // X·Z(높이)
        else if (viewMode === 'yz') d = Math.hypot(wa - v[1], wb - v[2]); // Y·Z(높이)
        else                        d = Math.hypot(wa - v[0], wb - v[1]); // X·Y (3d/xy)
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
            if (viewMode === 'xz')     { va = v[0]; vb = v[2]; } // X·Z(높이)
            else if (viewMode === 'yz') { va = v[1]; vb = v[2]; } // Y·Z(높이)
            else                        { va = v[0]; vb = v[1]; } // X·Y (3d/xy)
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
function CameraAutoFit({ ifcMeshes, glbUrl, modelData, orbitRef, fitTrigger }) {
    const { camera } = useThree();
    const prevRef = useRef({ key: null, trigger: -1 });

    useEffect(() => {
        const hasData = glbUrl || (ifcMeshes && ifcMeshes.length > 0) || (modelData && modelData.length > 0);
        if (!hasData) {
            prevRef.current = { key: null, trigger: -1 };
            return;
        }
        const currentKey = glbUrl || ifcMeshes || modelData?.[0]?.elementId || 'modelData';
        if (prevRef.current.key === currentKey && prevRef.current.trigger === fitTrigger) return;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        if (modelData && modelData.length > 0) {
            // Z-up 직접 매핑: posX→X, posY→Y, posZ→Z(높이)
            for (const el of modelData) {
                const px = Number(el.positionX) || 0;
                const py = Number(el.positionY) || 0;
                const pz = Number(el.positionZ) || 0;  // 높이
                const hx = (Number(el.sizeX) || 0.1) / 2;
                const hy = (Number(el.sizeY) || 0.1) / 2;
                const sz = Number(el.sizeZ) || 0.1;
                if (px - hx < minX) minX = px - hx;
                if (px + hx > maxX) maxX = px + hx;
                if (py - hy < minY) minY = py - hy;
                if (py + hy > maxY) maxY = py + hy;
                if (pz       < minZ) minZ = pz;
                if (pz + sz  > maxZ) maxZ = pz + sz;
            }
        } else if (ifcMeshes && ifcMeshes.length > 0) {
            // ifcMeshes 모드 fallback: 첫 번째 메시 정점 직접 순회
            const m = ifcMeshes[0];
            for (let i = 0; i < m.positions.length; i += 3) {
                const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            }
        }

        // modelData 미로드 등으로 bounds 계산 불가 시 prevRef를 갱신하지 않고 재시도를 허용
        if (!isFinite(minX)) {
            console.log('[CameraAutoFit] bounds 없음 — modelData.length=', modelData?.length);
            return;
        }

        prevRef.current = { key: currentKey, trigger: fitTrigger };

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;

        // 모델의 최대 치수를 기준으로 카메라 거리 산출
        const span   = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.5);
        const fovRad = (camera.fov * Math.PI) / 180;
        const dist   = (span / 2) / Math.tan(fovRad / 2) * 1.8; // 1.8배 여유

        // Z-up: 동남쪽 + 위에서 바라보도록 배치 (X+, Y-, Z+)
        console.log(`[CameraAutoFit] 카메라 맞춤 — center=(${cx.toFixed(1)},${cy.toFixed(1)},${cz.toFixed(1)}) dist=${dist.toFixed(1)}`);
        camera.position.set(
            cx + dist * 0.65,
            cy - dist * 0.65,
            cz + dist * 0.55,
        );
        camera.lookAt(cx, cy, cz);

        if (orbitRef?.current) {
            orbitRef.current.target.set(cx, cy, cz);
            orbitRef.current.update();
        }
    }, [ifcMeshes, glbUrl, modelData, fitTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Z-up 직접 매핑: posX→X, posY→Y, posZ→Z(높이)
    const pX = Number(element.positionX) || 0;
    const pY = Number(element.positionY) || 0;
    const pZ = Number(element.positionZ) || 0;   // 높이 (Z-up)
    const sX = Math.max(0.1, Number(element.sizeX) || 1);
    const sY = Math.max(0.1, Number(element.sizeY) || 1);
    const sZ = Math.max(0.1, Number(element.sizeZ) || 1);
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
            // Z-up: 카메라 수평 방향 수직 평면 (높이 조절용)
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            dir.z = 0; dir.normalize();
            plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                dir, new THREE.Vector3(pX, pY, pZ + sZ)  // Z-up 상단 중심
            );
        } else {
            // Z-up: 바닥 수평 평면 — normal=[0,0,1], Z=pZ
            plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -pZ);
        }

        const rc  = new THREE.Raycaster();
        const hit = new THREE.Vector3();

        const onMove = (ev) => {
            rc.setFromCamera(getNDC(ev.clientX, ev.clientY), camera);
            if (!rc.ray.intersectPlane(plane, hit)) return;

            // ── 높이 핸들 ─────────────────────────────────────────────
            if (type === 'top') {
                // Z-up: Z방향이 높이
                const newSZ = Math.max(0.1, parseFloat((hit.z - pZ).toFixed(3)));
                updateElementData(element.elementId, { sizeZ: newSZ });
                return;
            }

            // ── XY floor 핸들 (스냅 적용) — Z-up: hit.x=X, hit.y=Y
            let hx2 = hit.x, hy2 = hit.y;
            if (snapEnabled && snapVertices.length > 0) {
                const sv = findSnapVertex(hit.x, hit.y, snapVertices);
                if (sv) { hx2 = sv[0]; hy2 = sv[1]; }
            }

            const [ax, ay] = anchor;  // anchor: [threeX, threeY] Z-up
            const updates = {};
            if (type === 'corner' || type === 'edge-x') {
                updates.sizeX     = Math.max(0.1, parseFloat(Math.abs(hx2 - ax).toFixed(3)));
                updates.positionX = parseFloat(((hx2 + ax) / 2).toFixed(3));
            }
            if (type === 'corner' || type === 'edge-z') {
                updates.sizeY     = Math.max(0.1, parseFloat(Math.abs(hy2 - ay).toFixed(3)));
                updates.positionY = parseFloat(((hy2 + ay) / 2).toFixed(3));
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

    // ── 핸들 정의 — Z-up: X=dataX, Y=dataY, Z=dataZ(높이)
    const handles = useMemo(() => [
        { id:'c0', pos:[pX+hx, pY+hy, pZ], type:'corner', anchor:[pX-hx, pY-hy], color:'#3b82f6', cursor:'nw-resize' },
        { id:'c1', pos:[pX+hx, pY-hy, pZ], type:'corner', anchor:[pX-hx, pY+hy], color:'#3b82f6', cursor:'ne-resize' },
        { id:'c2', pos:[pX-hx, pY+hy, pZ], type:'corner', anchor:[pX+hx, pY-hy], color:'#3b82f6', cursor:'ne-resize' },
        { id:'c3', pos:[pX-hx, pY-hy, pZ], type:'corner', anchor:[pX+hx, pY+hy], color:'#3b82f6', cursor:'nw-resize' },
        { id:'ex0', pos:[pX+hx, pY, pZ], type:'edge-x', anchor:[pX-hx, pY], color:'#8b5cf6', cursor:'ew-resize' },
        { id:'ex1', pos:[pX-hx, pY, pZ], type:'edge-x', anchor:[pX+hx, pY], color:'#8b5cf6', cursor:'ew-resize' },
        { id:'ey0', pos:[pX, pY+hy, pZ], type:'edge-z', anchor:[pX, pY-hy], color:'#8b5cf6', cursor:'ns-resize' },
        { id:'ey1', pos:[pX, pY-hy, pZ], type:'edge-z', anchor:[pX, pY+hy], color:'#8b5cf6', cursor:'ns-resize' },
        { id:'top', pos:[pX, pY, pZ+sZ], type:'top', anchor:null, color:'#10b981', cursor:'n-resize' },
    ], [pX, pY, pZ, hx, hy, sZ]);

    const hs = HANDLE_HALF * 2; // 핸들 한 변 길이

    return (
        <group>
            {/* CAD 바운딩 박스 와이어프레임 — Z-up: [X, Y, Z=높이중심] */}
            <mesh position={[pX, pY, pZ + sZ / 2]}>
                <boxGeometry args={[sX + 0.02, sY + 0.02, sZ + 0.02]} />
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
                        array={new Float32Array([pX, pY, pZ,  pX, pY, pZ + sZ])}
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

        // viewMode별 스냅 검색 좌표 선택 (Z-up: X=동서, Y=남북, Z=높이)
        const [wa, wb] = viewMode === 'xz' ? [hit.x, hit.z]   // 정면: X·Z(높이)
                       : viewMode === 'yz' ? [hit.y, hit.z]   // 측면: Y·Z(높이)
                       : [hit.x, hit.y];                       // 3d/xy: X·Y(바닥)
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
// 선택된 부재 꼭짓점 스냅 포인트 시각화 (항상 표시)
// ================================================================
function ElementSnapPoints({ element }) {
    if (!element) return null;
    const pX = Number(element.positionX) || 0;
    const pY = Number(element.positionY) || 0;
    const pZ = Number(element.positionZ) || 0;
    const sX = (Number(element.sizeX) || 1) / 2;
    const sY = (Number(element.sizeY) || 1) / 2;
    const sZ = Number(element.sizeZ) || 1;

    // Three.js 좌표: X=BIM_X, Y=BIM_Z(height), Z=BIM_Y(floor)
    const pts = [];
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        if (dx === 0 && dz === 0) continue;
        pts.push([pX + dx * sX, pZ,       pY + dz * sY]); // 바닥
        pts.push([pX + dx * sX, pZ + sZ,  pY + dz * sY]); // 상단
    }
    // 중심 바닥 / 상단 / 중간
    pts.push([pX, pZ,        pY]);
    pts.push([pX, pZ + sZ,   pY]);
    pts.push([pX, pZ + sZ/2, pY]);

    return (
        <>
            {pts.map((p, i) => (
                <mesh key={i} position={p} renderOrder={999}>
                    <sphereGeometry args={[0.12, 8, 8]} />
                    <meshBasicMaterial color="#ffd700" depthTest={false} transparent opacity={0.85} />
                </mesh>
            ))}
        </>
    );
}

// ================================================================
// HoverTracker — 마우스 → 월드 좌표 실시간 추적 (렌더 없음)
// ================================================================
function HoverTracker({ drawHeight, snapVertices, snapEnabled, onHoverPosition, lockedAxes, shiftRef, lineStart, viewMode = '3d' }) {
    const { camera, raycaster, mouse } = useThree();
    const hitPoint = useMemo(() => new THREE.Vector3(), []);
    const _proj    = useMemo(() => new THREE.Vector3(), []);

    // 스크린 스페이스로 가장 가까운 스냅 꼭짓점 반환 (줌 레벨 무관)
    const findSnapScreenSpace = useCallback((verts) => {
        let best = null, minDist = 0.07; // NDC 거리 임계값 (화면 폭의 ~3.5%)
        for (const v of verts) {
            _proj.set(v[0], v[1], v[2]).project(camera);
            if (_proj.z > 1) continue; // 카메라 뒤는 무시
            const d = Math.hypot(_proj.x - mouse.x, _proj.y - mouse.y);
            if (d < minDist) { minDist = d; best = v; }
        }
        return best;
    }, [camera, mouse, _proj]);

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
                ex = lockedAxes.x;
                ey = hitPoint.y;
                ez = hitPoint.z;
            } else if (yl && !xl && !zl) {
                ex = hitPoint.x;
                ey = hitPoint.y;
                ez = lockedAxes.y;
            } else {
                ex = hitPoint.x; ey = zl ? lockedAxes.z : drawHeight; ez = hitPoint.z;
                if (snapEnabled && snapVertices.length > 0) {
                    // 스크린 스페이스 스냅 — 줌 레벨과 무관하게 작동
                    const sv = findSnapScreenSpace(snapVertices);
                    if (sv) { ex = sv[0]; ey = sv[1] ?? drawHeight; ez = sv[2]; }
                }
                if (xl) ex = lockedAxes.x;
                if (yl) ez = lockedAxes.y;
            }
        } else {
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
        const planeZ = basePoints[vertexIndex]?.[2] ?? 0;  // data Z (높이) = Three.js Z
        const plane  = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ); // Z-up 수평면
        const rc     = new THREE.Raycaster();
        const hit    = new THREE.Vector3();
        let latestPoints = basePoints;

        const onMove = (ev) => {
            rc.setFromCamera(getNDC(ev.clientX, ev.clientY), camera);
            if (!rc.ray.intersectPlane(plane, hit)) return;
            // Z-up: hit.x=X, hit.y=Y(남북), hit.z=planeZ(고정 높이)
            latestPoints = basePoints.map((p, i) =>
                i === vertexIndex
                    ? [parseFloat(hit.x.toFixed(3)), parseFloat(hit.y.toFixed(3)), planeZ]
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
        if (!active || pointB) return;
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(snapPlane, hitRef)) return;
        // Z-up: hitRef.x=X, hitRef.y=Y(남북), hitRef.z=Z(높이/0 on floor plane)
        let ex = hitRef.x, ey = hitRef.y, ez = hitRef.z;
        if (snapEnabled && snapVertices.length > 0 && viewMode !== 'xz' && viewMode !== 'yz') {
            const sv = findSnapVertex(hitRef.x, hitRef.y, snapVertices);
            if (sv) { ex = sv[0]; ey = sv[1] ?? 0; ez = sv[2]; }
        }
        // BIM data coords (Z-up): x=BIM_X, y=BIM_Y(남북), z=BIM_Z(높이)
        hoverRef.current = { x: ex, y: ey, z: ez };
        // 두 번째 점 대기 중일 때만 프리뷰 선 업데이트
        if (!pointA) return;
        const pos = previewGeom.attributes.position;
        pos.setXYZ(0, pointA.x, pointA.y, pointA.z); // Z-up 직접 매핑
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
    const [activeDim, setActiveDim] = React.useState(null);
    if (!element) return null;
    const pX = Number(element.positionX) || 0;
    const pY = Number(element.positionY) || 0;
    const pZ = Number(element.positionZ) || 0;
    const sX = Number(element.sizeX)     || 0.1;
    const sY = Number(element.sizeY)     || 0.1;
    const sZ = Number(element.sizeZ)     || 0.1;
    const cy = pZ + sZ / 2;

    const stopAll = (e) => { e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.(); };
    const handleClick = (dim) => (e) => {
        stopAll(e);
        setActiveDim(prev => (prev === dim ? null : dim));
    };

    const dimStyle = (dim, color, border) => ({
        background: activeDim === dim ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.82)',
        padding: '3px 9px', borderRadius: 5, fontSize: 11, fontWeight: 700,
        whiteSpace: 'nowrap', userSelect: 'none', fontFamily: 'monospace',
        color, border: activeDim === dim ? `2px solid ${color}` : `1px solid ${border}`,
        cursor: 'pointer', pointerEvents: 'auto',
        boxShadow: activeDim === dim ? `0 0 8px ${color}80` : 'none',
        transition: 'all 0.15s',
    });

    return (
        <>
            {/* Width X */}
            <Html position={[pX, pZ - 0.15, pY + sY/2 + 0.45]} center zIndexRange={[9990,9989]}>
                <div style={dimStyle('x','#60a5fa','#3b82f6')} onClick={handleClick('x')} onPointerDown={stopAll}>
                    W {sX.toFixed(2)}m{activeDim==='x' && <span style={{marginLeft:5,opacity:.7,fontSize:10}}>✓</span>}
                </div>
            </Html>
            {/* Depth Y */}
            <Html position={[pX + sX/2 + 0.45, pZ - 0.15, pY]} center zIndexRange={[9990,9989]}>
                <div style={dimStyle('y','#a78bfa','#7c3aed')} onClick={handleClick('y')} onPointerDown={stopAll}>
                    D {sY.toFixed(2)}m{activeDim==='y' && <span style={{marginLeft:5,opacity:.7,fontSize:10}}>✓</span>}
                </div>
            </Html>
            {/* Height Z */}
            <Html position={[pX + sX/2 + 0.45, cy, pY]} center zIndexRange={[9990,9989]}>
                <div style={dimStyle('z','#4ade80','#16a34a')} onClick={handleClick('z')} onPointerDown={stopAll}>
                    H {sZ.toFixed(2)}m{activeDim==='z' && <span style={{marginLeft:5,opacity:.7,fontSize:10}}>✓</span>}
                </div>
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
        // BIM 좌표: X=동서, Y=남북, Z=높이 / Three.js: X=동서, Y=높이(BIM Z), Z=남북(BIM Y)
        const normals = {
            x: new THREE.Vector3(-1, 0,  0),
            y: new THREE.Vector3( 0, -1, 0),  // BIM Y(높이) → Three.js Y
            z: new THREE.Vector3( 0,  0, -1), // BIM Z(남북) → Three.js Z
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
    const { camera, gl } = useThree();

    useEffect(() => {
        if (!active) return;
        const prevOrder = camera.rotation.order;
        // 현재 쿼터니언을 YXZ 오일러로 재분해 — 방향 보존
        const currentQuat = camera.quaternion.clone();
        camera.rotation.order = 'YXZ';
        camera.rotation.setFromQuaternion(currentQuat, 'YXZ');
        const canvas = gl.domElement;

        // pointer lock 없이 canvas mousemove로 마우스룩
        const onMouseMove = (e) => {
            const sens = 0.003;
            camera.rotation.x = Math.max(
                -Math.PI * 0.42,
                Math.min(Math.PI * 0.42, camera.rotation.x + e.movementX * sens)
            );
            camera.rotation.y -= e.movementY * sens;
        };
        const onDown = (e) => {
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
            keysRef.current[e.code] = true;
            if (e.code === 'Escape') onExit?.();
        };
        const onUp = (e) => { keysRef.current[e.code] = false; };

        canvas.addEventListener('mousemove', onMouseMove);
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup',   onUp);
        return () => {
            canvas.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('keydown', onDown);
            window.removeEventListener('keyup',   onUp);
            keysRef.current = {};
            camera.rotation.order = prevOrder;
        };
    }, [active, camera, gl, onExit]);

    useFrame((_, delta) => {
        if (!active || !orbitRef?.current) return;
        const speed    = 20 * delta;
        const turnSpeed = 1.2 * delta; // A/D 회전 속도 (rad/s)
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
        const move = new THREE.Vector3();
        if (keysRef.current['KeyW'] || keysRef.current['ArrowUp'])   move.addScaledVector(forward,  speed);
        if (keysRef.current['KeyS'] || keysRef.current['ArrowDown'])  move.addScaledVector(forward, -speed);
        if (keysRef.current['KeyQ'] || keysRef.current['ArrowLeft'])  camera.rotation.z += turnSpeed;
        if (keysRef.current['KeyE'] || keysRef.current['ArrowRight']) camera.rotation.z -= turnSpeed;
        if (keysRef.current['KeyA'] || keysRef.current['PageUp'])   move.y += speed;  // 위
        if (keysRef.current['KeyD'] || keysRef.current['PageDown']) move.y -= speed;  // 아래
        camera.position.add(move);
        // orbit target만 동기화 (update() 호출 금지 — OrbitControls가 rotation을 덮어씀)
        if (orbitRef?.current) {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            orbitRef.current.target.copy(camera.position).addScaledVector(dir, 10);
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
        if (!modelData.length) return { cx: 0, cy: 0, cz: 0, spanXY: 20, spanXZ: 10, spanYZ: 20 };
        let minX = Infinity, maxX = -Infinity; // Three.js X = BIM X
        let minY = Infinity, maxY = -Infinity; // Three.js Y = BIM Y (남북)
        let minZ = Infinity, maxZ = -Infinity; // Three.js Z = BIM Z (높이)
        for (const el of modelData) {
            const px = Number(el.positionX) || 0;
            const py = Number(el.positionY) || 0;
            const pz = Number(el.positionZ) || 0;  // 높이
            const hx = (Number(el.sizeX) || 0.1) / 2;
            const hy = (Number(el.sizeY) || 0.1) / 2;
            const sz = Number(el.sizeZ) || 0.1;
            if (px - hx < minX) minX = px - hx; if (px + hx > maxX) maxX = px + hx;
            if (py - hy < minY) minY = py - hy; if (py + hy > maxY) maxY = py + hy;
            if (pz       < minZ) minZ = pz;      if (pz + sz  > maxZ) maxZ = pz + sz;
        }
        return {
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2,
            cz: (minZ + maxZ) / 2,
            spanXY: Math.max(maxX - minX, maxY - minY, 5), // 평면도 (동서 × 남북)
            spanXZ: Math.max(maxX - minX, maxZ - minZ, 5), // 정면도 (동서 × 높이)
            spanYZ: Math.max(maxY - minY, maxZ - minZ, 5), // 측면도 (남북 × 높이)
        };
    }, [modelData]);

    const { cx, cy, cz } = bounds;

    // Z-up 카메라 위치 · 방향 결정
    const { pos, up, span } = useMemo(() => {
        const pad = 2.5;
        if (viewMode === 'xy') {
            // 평면도: Z+ 위에서 아래(-Z)로 바라봄 / 화면: X=동서, Y=남북
            const d = bounds.spanXY * pad;
            return { pos: [cx, cy, cz + d], up: [0, 1, 0], span: bounds.spanXY };
        } else if (viewMode === 'xz') {
            // 정면도: Y- 남쪽에서 북(+Y)으로 바라봄 / 화면: X=동서, Z=높이
            const d = bounds.spanXZ * pad;
            return { pos: [cx, cy - d, cz], up: [0, 0, 1], span: bounds.spanXZ };
        } else {
            // 측면도: X- 서쪽에서 동(+X)으로 바라봄 / 화면: Y=남북, Z=높이
            const d = bounds.spanYZ * pad;
            return { pos: [cx - d, cy, cz], up: [0, 0, 1], span: bounds.spanYZ };
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
// 그룹 이동 고스트 — 선택된 부재들을 마우스를 따라 미리보기로 이동
// ================================================================
function GroupMoveGhost({ groupMovePending, onGroupMoveConfirm }) {
    const { camera, raycaster, mouse } = useThree();
    const groupRef = useRef();
    const lastHitRef = useRef(new THREE.Vector3());
    const { elements, pivotX, pivotY } = groupMovePending;

    const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

    useFrame(() => {
        if (!groupRef.current) return;
        raycaster.setFromCamera(mouse, camera);
        const hit = lastHitRef.current;
        if (!raycaster.ray.intersectPlane(plane, hit)) return;
        // hit.x = dataX, hit.z = dataY(floorY) → delta 계산
        groupRef.current.position.set(hit.x - pivotX, 0, hit.z - pivotY);
    });

    return (
        <>
            {/* 클릭 평면 — 클릭 시 그룹 이동 확정 */}
            <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.002, 0]}
                onClick={e => {
                    e.stopPropagation();
                    onGroupMoveConfirm(lastHitRef.current.x, lastHitRef.current.z);
                }}
            >
                <planeGeometry args={[500, 500]} />
                <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
            </mesh>

            {/* 이동 미리보기: 전체 그룹이 delta만큼 이동하고 각 부재는 원래 상대 위치 유지 */}
            <group ref={groupRef}>
                {elements.map(el => {
                    const px = Number(el.positionX) || 0;
                    const py = Number(el.positionY) || 0;
                    const pz = Number(el.positionZ) || 0;
                    const sx = Math.max(0.1, Number(el.sizeX) || 1);
                    const sy = Math.max(0.1, Number(el.sizeY) || 1);
                    const sz = Math.max(0.1, Number(el.sizeZ) || 1);
                    // Z-up: X=dataX, Y=dataY, Z=dataZ(높이 base)+sz/2
                    return (
                        <mesh key={el.elementId} position={[px, py, pz + sz / 2]}>
                            <boxGeometry args={[sx + 0.05, sy + 0.05, sz + 0.05]} />
                            <meshBasicMaterial color="#60a5fa" wireframe transparent opacity={0.8} />
                        </mesh>
                    );
                })}
            </group>
        </>
    );
}

// ================================================================
// 고스트 이동 — 선택된 부재를 마우스를 따라 미리보기, 클릭으로 위치 확정
// ================================================================
function GhostTranslateElement({ elements, onConfirm }) {
    const { camera, raycaster, mouse, gl } = useThree();
    const ghostRef = useRef();
    const hitRef   = useRef(new THREE.Vector3());

    // Z-up 바닥 평면 (법선=Z)
    const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);

    const centroid = useMemo(() => ({
        x: elements.reduce((s, e) => s + (Number(e.positionX) || 0), 0) / (elements.length || 1),
        y: elements.reduce((s, e) => s + (Number(e.positionY) || 0), 0) / (elements.length || 1),
    }), [elements]);

    // window click 캡처 — 브라우저가 드래그 여부 자동 구분, 캔버스 bounds 내 클릭만 확정
    useEffect(() => {
        const canvas = gl.domElement;
        const onClick = (e) => {
            if (e.target.closest?.('button, input, select, textarea, a')) return;
            const r = canvas.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
            onConfirm(hitRef.current.x - centroid.x, hitRef.current.y - centroid.y);
        };
        window.addEventListener('click', onClick, true);
        return () => window.removeEventListener('click', onClick, true);
    }, [gl, onConfirm, centroid]);

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(plane, hitRef.current)) return;
        if (ghostRef.current) {
            ghostRef.current.position.x = hitRef.current.x - centroid.x;
            ghostRef.current.position.y = hitRef.current.y - centroid.y;
        }
    });

    return (
        <>
            <group ref={ghostRef}>
                {elements.map(el => {
                    const sx = Math.max(0.1, Number(el.sizeX) || 1);
                    const sy = Math.max(0.1, Number(el.sizeY) || 1);
                    const sz = Math.max(0.1, Number(el.sizeZ) || 1);
                    return (
                        <mesh key={el.elementId}
                            position={[Number(el.positionX)||0, Number(el.positionY)||0, (Number(el.positionZ)||0) + sz / 2]}>
                            <boxGeometry args={[sx + 0.06, sy + 0.06, sz + 0.06]} />
                            <meshBasicMaterial color="#60a5fa" transparent opacity={0.45} depthWrite={false} />
                        </mesh>
                    );
                })}
            </group>
        </>
    );
}

// ================================================================
// 고스트 회전 — 선택된 부재를 마우스 방향 기반 90° 스냅 회전 미리보기
// ================================================================
function GhostRotateElement({ elements, onConfirm, rotateAxis = 'z' }) {
    const { camera, mouse, gl } = useThree();
    const ghostRef    = useRef();
    const snapDelta   = useRef(0);
    const labelRef    = useRef(null);
    const centroidVec = useRef(new THREE.Vector3());

    const centroid = useMemo(() => ({
        x: elements.reduce((s, e) => s + (Number(e.positionX) || 0), 0) / (elements.length || 1),
        y: elements.reduce((s, e) => s + (Number(e.positionY) || 0), 0) / (elements.length || 1),
    }), [elements]);

    const topZ = elements.reduce((m, e) => Math.max(m, (Number(e.positionZ)||0) + (Number(e.sizeZ)||1)), 0);
    const SNAP = Math.PI / 2;

    // window click 캡처 — 브라우저가 드래그 여부 자동 구분, 캔버스 bounds 내 클릭만 확정
    useEffect(() => {
        const canvas = gl.domElement;
        const onClick = (e) => {
            if (e.target.closest?.('button, input, select, textarea, a')) return;
            const r = canvas.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
            onConfirm(snapDelta.current);
        };
        window.addEventListener('click', onClick, true);
        return () => window.removeEventListener('click', onClick, true);
    }, [gl, onConfirm]);

    useFrame(() => {
        // 화면 공간 기반 각도 — 카메라 오빗 후에도 일관성 유지
        centroidVec.current.set(centroid.x, centroid.y, 0);
        centroidVec.current.project(camera);
        const dx = mouse.x - centroidVec.current.x;
        const dy = mouse.y - centroidVec.current.y;
        if (Math.hypot(dx, dy) < 0.02) return;

        const snapped = Math.round(Math.atan2(dy, dx) / SNAP) * SNAP;
        snapDelta.current = snapped;
        if (ghostRef.current) {
            if (rotateAxis === 'x')      ghostRef.current.rotation.set(snapped, 0, 0);
            else if (rotateAxis === 'y') ghostRef.current.rotation.set(0, snapped, 0);
            else                         ghostRef.current.rotation.set(0, 0, snapped);
        }
        if (labelRef.current) labelRef.current.textContent = `${Math.round(snapped * 180 / Math.PI)}°`;
    });

    return (
        <>
            <group ref={ghostRef} position={[centroid.x, centroid.y, 0]}>
                {elements.map(el => {
                    const sx = Math.max(0.1, Number(el.sizeX) || 1);
                    const sy = Math.max(0.1, Number(el.sizeY) || 1);
                    const sz = Math.max(0.1, Number(el.sizeZ) || 1);
                    return (
                        <mesh key={el.elementId}
                            position={[(Number(el.positionX)||0)-centroid.x, (Number(el.positionY)||0)-centroid.y, (Number(el.positionZ)||0)+sz/2]}>
                            <boxGeometry args={[sx + 0.06, sy + 0.06, sz + 0.06]} />
                            <meshBasicMaterial color="#a78bfa" transparent opacity={0.45} depthWrite={false} />
                        </mesh>
                    );
                })}
                <Html position={[0, 0, topZ + 1]} center>
                    <div style={{
                        color: '#a78bfa', background: 'rgba(6,14,26,0.9)',
                        border: '1px solid #7c3aed', borderRadius: 4,
                        padding: '2px 8px', fontSize: 12, fontWeight: 700,
                        whiteSpace: 'nowrap', pointerEvents: 'none',
                    }}>
                        <span ref={labelRef}>0°</span>
                    </div>
                </Html>
            </group>
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
    multiSelectedLineIds = null,
    onLineSelect,
    onLineMultiSelect,
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
    // IFC 실제 지오메트리 (옵션, 구방식 WASM) — 있으면 BimElement 박스 대신 렌더링
    ifcMeshes = null,
    // 서버 변환 GLB URL (신방식) — ifcMeshes보다 우선 적용
    glbUrl = null,
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
    // 고스트 이동/회전 모드
    ghostMode = null,
    ghostElements = [],
    onGhostConfirm = null,
    // 회전 축 필터: 'x'|'y'|'z'|'all'
    rotateAxis = 'z',
}) {
    const { camera } = useThree();
    const transformRef     = useRef();
    const orbitRef         = useRef();
    const shiftRef         = useRef(false);
    const ifcMeshGroupRef  = useRef();

    // GLB 로딩 완료 추적 — false이면 BIM 박스를 GLB 로딩 중 대체 표시
    const [glbLoaded, setGlbLoaded] = useState(false);
    useEffect(() => { if (glbUrl) setGlbLoaded(false); }, [glbUrl]);
    const handleGlbLoad = useCallback(() => setGlbLoaded(true), []);

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
    // 다중 선택 시 피벗을 선택 요소들의 무게중심으로 이동 (IFC/비IFC 공통)
    useEffect(() => {
        if (allSelectedIds.size === 0) return;
        if (!glbUrl && !ifcMeshes?.length && allSelectedIds.size < 2) return;
        let sumX = 0, sumY = 0, sumZ = 0, count = 0;
        for (const el of modelData) {
            if (!allSelectedIds.has(el.elementId)) continue;
            // Z-up: X=posX, Y=posY, Z=posZ(높이 중심)
            sumX += Number(el.positionX) || 0;
            sumY += Number(el.positionY) || 0;
            sumZ += (Number(el.positionZ) || 0) + (Number(el.sizeZ) || 0) / 2;
            count++;
        }
        if (count > 0) {
            pivotObj.position.set(sumX / count, sumY / count, sumZ / count);
            pivotObj.rotation.set(0, 0, 0);
            pivotObj.scale.set(1, 1, 1);
        }
    }, [allSelectedIds, modelData, ifcMeshes, glbUrl, pivotObj]);

    const [isDragging,            setIsDragging]            = useState(false);
    const [isResizeDragging,      setIsResizeDragging]      = useState(false);
    const [isLineVertexDragging,  setIsLineVertexDragging]  = useState(false);
    const startPositionsRef = useRef({});

    // ── 스냅 꼭짓점 수집 ─────────────────────────────────────────────
    // 스냅: 부재 배치 / 선 작도 / 측정 중에 활성화
    const snapVertices = useMemo(() => {
        if (!snapEnabled) return [];
        const inActiveMode = !!pendingElement || lineDrawMode === 'click' || measureMode;
        // 선택된 부재는 모드 무관하게 항상 스냅 포인트 제공
        const hasSelectedEl = !!selectedElement?.data;
        if (!inActiveMode && !hasSelectedEl) return [];
        const verts = [];
        // 선 꼭짓점: BIM 저장 포맷 [BIM_X, BIM_Y(floor), BIM_Z(height)]
        //            → Three.js 포맷 [X, Z(height), Y(floor)] 로 변환 필요
        // Z-up: BIM 저장 [X, Y(floor), Z(height)] → Three.js [X, Y, Z] 그대로 사용
        const lineToThree = (p) => p ? [p[0], p[1] ?? 0, p[2] ?? 0] : null;
        for (const line of lines) {
            const sv = lineToThree(line.start); if (sv) verts.push(sv);
            const ev = lineToThree(line.end);   if (ev) verts.push(ev);
            if (line.pointsJson) {
                try {
                    const pts = typeof line.pointsJson === 'string'
                        ? JSON.parse(line.pointsJson) : line.pointsJson;
                    if (Array.isArray(pts)) pts.forEach(p => { const v = lineToThree(p); if (v) verts.push(v); });
                } catch (_) {}
            }
        }
        const selectedId = selectedElement?.data?.elementId;
        for (const el of modelData) {
            // active 모드면 모든 부재, 아니면 선택된 부재만 포함
            if (!inActiveMode && el.elementId !== selectedId) continue;
            const ex = Number(el.positionX)||0, ey = Number(el.positionY)||0, ez = Number(el.positionZ)||0;
            const esx = (Number(el.sizeX)||1)/2, esy = (Number(el.sizeY)||1)/2, esz = Number(el.sizeZ)||1;
            // Z-up: [X, Y, Z(높이)]
            for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) {
                if (dx === 0 && dy === 0) continue;
                verts.push([ex+dx*esx, ey+dy*esy, ez]);
                verts.push([ex+dx*esx, ey+dy*esy, ez+esz]);
                verts.push([ex+dx*esx, ey+dy*esy, ez+esz/2]);
            }
            verts.push([ex, ey, ez]);
            verts.push([ex, ey, ez+esz]);
            verts.push([ex, ey, ez+esz/2]);
        }
        return verts;
    }, [snapEnabled, pendingElement, lineDrawMode, measureMode, selectedElement, lines, modelData]);

    // ── 표준 뷰 프리셋 ────────────────────────────────────────────────
    // viewPreset = { id: 'iso'|'top'|'front'|'right'|'left'|'back', ts: number }
    const prevPresetRef = useRef(null);
    useEffect(() => {
        if (!viewPreset || !orbitRef.current) return;
        if (prevPresetRef.current === viewPreset.ts) return;
        prevPresetRef.current = viewPreset.ts;

        // 모델 AABB → Z-up 직접 매핑: posX→X, posY→Y, posZ→Z(높이)
        let cx = 0, cy = 0, cz = 0, span = 20;
        if (modelData.length > 0) {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            for (const el of modelData) {
                const px = Number(el.positionX)||0, py = Number(el.positionY)||0, pz = Number(el.positionZ)||0;
                const hx = (Number(el.sizeX)||0.1)/2, hy = (Number(el.sizeY)||0.1)/2, sz = Number(el.sizeZ)||0.1;
                if (px-hx < minX) minX = px-hx; if (px+hx > maxX) maxX = px+hx;
                if (py-hy < minY) minY = py-hy; if (py+hy > maxY) maxY = py+hy;
                if (pz    < minZ) minZ = pz;    if (pz+sz  > maxZ) maxZ = pz+sz;
            }
            cx = (minX+maxX)/2; cy = (minY+maxY)/2; cz = (minZ+maxZ)/2;
            span = Math.max(maxX-minX, maxY-minY, maxZ-minZ, 1);
        }
        const d = span * 1.6;
        const center = new THREE.Vector3(cx, cy, cz);

        // Z-up 표준 뷰: X=동서, Y=남북, Z=높이
        const positions = {
            iso:   new THREE.Vector3(cx+d*0.65, cy-d*0.65, cz+d*0.55), // 남동 위 등각
            top:   new THREE.Vector3(cx,        cy,         cz+d),       // 평면도 (Z위 → 아래)
            bottom:new THREE.Vector3(cx,        cy,         cz-d),       // 하면도
            front: new THREE.Vector3(cx,        cy-d,       cz),         // 정면도 (남쪽 → 북)
            back:  new THREE.Vector3(cx,        cy+d,       cz),         // 배면도
            right: new THREE.Vector3(cx+d,      cy,         cz),         // 우측면도
            left:  new THREE.Vector3(cx-d,      cy,         cz),         // 좌측면도
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
        const isIfcMode = !!(glbUrl || ifcMeshes?.length);
        const isMultiSelect = allSelectedIdsRef.current.size > 1;

        // ── 피벗 모드: IFC 또는 비-IFC 다중선택 ───────────────────────
        if (isIfcMode || isMultiSelect) {
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
                if (isIfcMode) ifcMeshGroupRef.current?.applyRotate(ids, centroid, dq);
                pivotObj.rotation.set(0, 0, 0);

            } else if (transformMode === 'scale') {
                const sx = pivotObj.scale.x;
                const sy = pivotObj.scale.y;
                const sz = pivotObj.scale.z;
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
                if (isIfcMode) ifcMeshGroupRef.current?.applyScale(ids, centroid, sx, sy, sz);
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
    }, [transformMode, selectedElements, updateElementData, ifcMeshes, glbUrl, pivotObj]);

    useEffect(() => {
        const ctrl = transformRef.current;
        if (!ctrl) return;

        const onDrag = (e) => {
            setIsDragging(e.value);
            if (e.value) {
                pushUndo?.();
                const isMultiSelect = allSelectedIdsRef.current.size > 1;
                if (glbUrl || ifcMeshes?.length || isMultiSelect) {
                    // 피벗 모드: IFC 또는 비-IFC 다중선택
                    const elements = {};
                    for (const id of allSelectedIdsRef.current) {
                        const el = modelData.find(d => d.elementId === id);
                        if (el) elements[id] = { ...el };
                    }
                    const meshPositions = {};
                    if (glbUrl || ifcMeshes?.length) {
                        for (const id of allSelectedIdsRef.current) {
                            const mp = ifcMeshGroupRef.current?.getMeshPosition(id);
                            if (mp) meshPositions[id] = mp;
                        }
                    }
                    pivotInitialState.current = {
                        pos:   pivotObj.position.clone(),
                        rot:   pivotObj.rotation.clone(),
                        scale: pivotObj.scale.clone(),
                        elements,
                        meshPositions: Object.keys(meshPositions).length ? meshPositions : null,
                    };
                } else {
                    // 비-IFC 단일 요소: 메시 직접 조작
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
            if (!(glbUrl || ifcMeshes?.length) || transformMode !== 'translate') return;
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
    }, [transformMode, modelData, selectedElement, selectedElements, handleTransformComplete, pushUndo, ifcMeshes, glbUrl, pivotObj]);

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

            {/* IFC/GLB 로드 시 카메라 자동 맞춤 — GLB/ifcMeshes 없는 박스 렌더러도 포함 */}
            {(glbUrl || (ifcMeshes && ifcMeshes.length > 0) || (modelData && modelData.length > 0)) && (
                <CameraAutoFit
                    ifcMeshes={ifcMeshes}
                    glbUrl={glbUrl}
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
                - IFC 모드 또는 다중선택: 피벗에 연결
                - 비-IFC 단일선택: selectedElement mesh에 직접 연결 */}
            {!isResizeDragging && !ghostMode && (() => {
                if (allSelectedIds.size === 0) return null;
                // rotate 모드는 항상 90° 스냅 강제, 자유 회전 불허
                const snap  = transformMode === 'rotate' ? Math.PI / 2 : undefined;
                const showX = transformMode !== 'rotate' || rotateAxis === 'x' || rotateAxis === 'all';
                const showY = transformMode !== 'rotate' || rotateAxis === 'y' || rotateAxis === 'all';
                const showZ = transformMode !== 'rotate' || rotateAxis === 'z' || rotateAxis === 'all';
                if (glbUrl || ifcMeshes?.length || allSelectedIds.size > 1) {
                    return (
                        <TransformControls
                            ref={transformRef}
                            object={pivotObj}
                            mode={transformMode}
                            size={2.2}
                            rotationSnap={snap}
                            showX={showX}
                            showY={showY}
                            showZ={showZ}
                        />
                    );
                }
                if (!selectedElement?.meshRef?.current) return null;
                return (
                    <TransformControls
                        ref={transformRef}
                        object={selectedElement.meshRef.current}
                        mode={transformMode}
                        size={2.2}
                        rotationSnap={snap}
                        showX={showX}
                        showY={showY}
                        showZ={showZ}
                    />
                );
            })()}

            {/* BIM 부재 렌더링
                우선순위: GLB(서버변환) > WASM ifcMeshes(구방식) > BimElement 박스
                GLB 로딩 중(glbLoaded=false)에는 BIM 박스를 대체 표시하여 공백 방지 */}
            {glbUrl ? (
                <>
                    <GltfBimViewerSuspense
                        ref={ifcMeshGroupRef}
                        glbUrl={glbUrl}
                        modelData={modelData}
                        onElementSelect={(measureMode || lineDrawMode === 'click' || ghostMode) ? null : onElementSelect}
                        selectedElement={selectedElement}
                        selectedElements={selectedElements}
                        onMeshMount={null}
                        onLoad={handleGlbLoad}
                    />
                    {!glbLoaded && modelData.map(element => (
                        <BimElement
                            key={element.elementId}
                            element={{
                                ...element,
                                selected:      selectedElement?.data?.elementId === element.elementId,
                                multiSelected: selectedElements?.has(element.elementId) &&
                                               selectedElement?.data?.elementId !== element.elementId,
                            }}
                            onElementSelect={onElementSelect}
                            isPlacementMode={!!pendingElement || measureMode || lineDrawMode === 'click' || !!ghostMode}
                        />
                    ))}
                </>
            ) : ifcMeshes && ifcMeshes.length > 0 ? (
                <IFCMeshGroup
                    ref={ifcMeshGroupRef}
                    ifcMeshes={ifcMeshes}
                    modelData={modelData}
                    onElementSelect={(measureMode || lineDrawMode === 'click') ? null : onElementSelect}
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
                        isPlacementMode={!!pendingElement || measureMode || lineDrawMode === 'click' || !!ghostMode}
                    />
                ))
            )}

            {/* CAD 리사이즈 핸들 — IFC 모드에서는 숨김 */}
            {showHandles && !ifcMeshes?.length && !glbUrl && (
                <ElementResizeHandles
                    element={selectedElement.data}
                    updateElementData={updateElementData}
                    pushUndo={pushUndo}
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    onDragStateChange={setIsResizeDragging}
                />
            )}

            {/* 꼭짓점 스냅 인디케이터 (배치·선 작도·측정 중 활성화) */}
            {(!!pendingElement || lineDrawMode === 'click' || measureMode) && (
                <VertexSnapIndicator
                    snapVertices={snapVertices}
                    snapEnabled={snapEnabled}
                    viewMode={viewMode}
                />
            )}

            {/* 선택된 부재 꼭짓점 스냅 포인트 — 항상 표시 */}
            {selectedElement?.data && (
                <ElementSnapPoints element={selectedElement.data} />
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
                    multiSelected={!!(multiSelectedLineIds?.has(line.lineId) && line.lineId !== selectedLineId)}
                    onClick={(id, shiftKey) => {
                        if (shiftKey) onLineMultiSelect?.(id);
                        else onLineSelect?.(id);
                    }}
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

            {/* 고스트 이동/회전 미리보기 */}
            {ghostMode === 'translate' && ghostElements?.length > 0 && (
                <GhostTranslateElement elements={ghostElements} onConfirm={onGhostConfirm} />
            )}
            {ghostMode === 'rotate' && ghostElements?.length > 0 && (
                <GhostRotateElement elements={ghostElements} onConfirm={onGhostConfirm} rotateAxis={rotateAxis} />
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
                    position={[0, 0, -0.01]}
                    rotation={[Math.PI / 2, 0, 0]}
                />
            )}

            <Suspense fallback={null}>
                {envPreset && <SkyEnvironment preset={envPreset} />}
            </Suspense>

        </>
    );
}
