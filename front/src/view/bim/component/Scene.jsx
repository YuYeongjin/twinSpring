import React, { useRef, useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { BimElement, getBaseColor } from '../element/BimElement';
import { BimLine } from '../element/BimLine';
import { IFCMeshGroup } from '../element/IFCMeshGroup';
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
function VertexSnapIndicator({ snapVertices, snapEnabled }) {
    const { camera, raycaster, mouse } = useThree();
    const groupRef = useRef();

    useFrame(() => {
        if (!groupRef.current) return;
        if (!snapEnabled || !snapVertices.length) {
            groupRef.current.visible = false;
            return;
        }

        raycaster.setFromCamera(mouse, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit   = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, hit)) return;

        const nearest = findSnapVertex(hit.x, hit.z, snapVertices);
        groupRef.current.visible = !!nearest;
        if (nearest) {
            groupRef.current.position.set(
                nearest[0],
                (nearest[1] ?? 0) + 0.03,
                nearest[2],
            );
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
function HoverTracker({ drawHeight, snapVertices, snapEnabled, onHoverPosition, lockedAxes, shiftRef, lineStart }) {
    const { camera, raycaster, mouse } = useThree();
    const floorPlane = useMemo(
        () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -drawHeight),
        [drawHeight]
    );
    const hitPoint = useMemo(() => new THREE.Vector3(), []);

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return;
        // Three.js: ex=X=dataX, ey=Y(up)=drawHeight=dataZ, ez=Z(depth)=dataY
        let ex = hitPoint.x, ey = drawHeight, ez = hitPoint.z;
        if (snapEnabled && snapVertices.length > 0) {
            const sv = findSnapVertex(hitPoint.x, hitPoint.z, snapVertices);
            if (sv) { ex = sv[0]; ey = sv[1] ?? drawHeight; ez = sv[2]; }
        }
        // lockedAxes는 data 좌표: x=dataX, y=dataY, z=dataZ
        if (lockedAxes?.x != null) ex = lockedAxes.x;          // dataX = Three.jsX
        if (lockedAxes?.y != null) ez = lockedAxes.y;          // dataY = Three.jsZ
        if (lockedAxes?.z != null) ey = lockedAxes.z;          // dataZ = Three.jsY
        // Shift 직교: lineStart = [dataX, dataY, dataZ] 기준
        if (shiftRef?.current && lineStart) {
            const dx = ex - lineStart[0], dz = ez - (lineStart[1] ?? 0);  // floor XY
            if (lockedAxes?.x == null && lockedAxes?.y == null) {
                if (Math.abs(dx) >= Math.abs(dz)) ez = lineStart[1] ?? 0;
                else ex = lineStart[0];
            }
        }
        // data 좌표로 emit: x=dataX, y=dataY, z=dataZ
        onHoverPosition?.({ x: ex, y: ez, z: ey });
    });

    return null;
}

// ================================================================
// 배치 고스트 (스마트 스냅 — 센터 + 코너)
// ================================================================
function PlacementGhost({ template, onConfirm, snapVertices, snapEnabled, onHoverPosition, lockedAxes, shiftRef }) {
    const meshRef   = useRef();
    const snapRef   = useRef();
    const { camera, raycaster, mouse } = useThree();

    const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const hitPoint   = useMemo(() => new THREE.Vector3(), []);
    const snappedPos = useRef([0, 0]); // [x, z]

    // 좌표 규칙: sizeX/Y=평면 크기, sizeZ=높이 / Three.js: X=dataX, Y=dataZ+half, Z=dataY
    const sizeX = template.sizeX ?? 1;
    const sizeY = template.sizeY ?? 1;   // floor Y size → Three.js Z
    const sizeZ = template.sizeZ ?? 1;   // height       → Three.js Y

    useFrame(() => {
        raycaster.setFromCamera(mouse, camera);
        if (!raycaster.ray.intersectPlane(floorPlane, hitPoint)) return;

        // px=Three.jsX=dataX, pz=Three.jsZ=dataY
        let px = hitPoint.x, pz = hitPoint.z;
        let snapped = false;

        if (snapEnabled && snapVertices.length > 0) {
            const r = findSmartSnap(hitPoint.x, hitPoint.z, sizeX, sizeY, snapVertices);  // floor XY
            if (r) { [px, pz] = r; snapped = true; }
        }

        // lockedAxes: x=dataX, y=dataY(floorY), z=dataZ(height)
        if (lockedAxes?.x != null) px = lockedAxes.x;           // dataX = Three.jsX
        if (lockedAxes?.y != null) pz = lockedAxes.y;           // dataY = Three.jsZ
        if (shiftRef?.current) {
            if (lockedAxes?.x == null) px = Math.round(px * 2) / 2;
            if (lockedAxes?.y == null) pz = Math.round(pz * 2) / 2;
        }

        const ghostZbase = lockedAxes?.z ?? 0;  // data Z (height base) = Three.js Y base
        snappedPos.current = [px, pz];
        // data 좌표로 emit: x=dataX, y=dataY(=Three.jsZ), z=dataZ(height)
        onHoverPosition?.({ x: px, y: pz, z: ghostZbase });
        const ghostY = ghostZbase + sizeZ / 2;  // Three.js Y center
        if (meshRef.current) meshRef.current.position.set(px, ghostY, pz);

        if (snapRef.current) {
            snapRef.current.visible = snapped;
            if (snapped) snapRef.current.position.set(px, ghostZbase + 0.1, pz);
        }
    });

    return (
        <>
            <mesh ref={meshRef} position={[0, sizeZ / 2, 0]}>
                <boxGeometry args={[sizeX, sizeZ, sizeY]} />  {/* Three.js [X, height, depth] */}
                <meshStandardMaterial
                    color={getBaseColor(template.elementType)}
                    opacity={0.45} transparent depthWrite={false}
                />
            </mesh>
            {/* 와이어프레임 */}
            <mesh position={[0, sizeZ / 2, 0]}>
                <boxGeometry args={[sizeX + 0.02, sizeZ + 0.02, sizeY + 0.02]} />
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
                    // data 좌표로 전달: x=dataX, y=dataY(floor), z=dataZ(height)
                    onConfirm({
                        x: lockedAxes?.x ?? snappedPos.current[0],    // dataX
                        y: lockedAxes?.y ?? snappedPos.current[1],    // dataY (Three.jsZ)
                        z: lockedAxes?.z ?? 0,                         // dataZ (height=0)
                    });
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
function LinePreview({ lineStart, lineColor, lineWidth, drawHeight, snapVertices, snapEnabled, lockedAxes }) {
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

        let ex = hitPoint.x, ey = drawHeight, ez = hitPoint.z;
        let snapped = false;

        if (snapEnabled && snapVertices.length > 0) {
            const sv = findSnapVertex(hitPoint.x, hitPoint.z, snapVertices);
            if (sv) { ex = sv[0]; ey = sv[1] ?? drawHeight; ez = sv[2]; snapped = true; }
        }
        if (!snapped && snapSphRef.current) snapSphRef.current.visible = false;

        // lockedAxes: data 좌표 (x=dataX, y=dataY, z=dataZ)
        if (lockedAxes?.x != null) ex = lockedAxes.x;          // dataX = Three.jsX
        if (lockedAxes?.y != null) ez = lockedAxes.y;          // dataY = Three.jsZ
        if (lockedAxes?.z != null) ey = lockedAxes.z;          // dataZ = Three.jsY

        // 스냅 구는 locked 축 적용 후의 최종 위치에 표시
        if (snapped && snapSphRef.current) {
            snapSphRef.current.position.set(ex, ey, ez);
            snapSphRef.current.visible = true;
        }

        // lineStart = [dataX, dataY, dataZ] → Three.js = [X, dataZ, dataY]
        const pos = lineObj.geometry.attributes.position;
        pos.setXYZ(0, lineStart[0], lineStart[2] ?? 0, lineStart[1] ?? 0);
        pos.setXYZ(1, ex, ey, ez);  // ex=Three.jsX, ey=Three.jsY, ez=Three.jsZ
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
}) {
    const { camera } = useThree();
    const transformRef     = useRef();
    const orbitRef         = useRef();
    const shiftRef         = useRef(false);

    useEffect(() => {
        const handler = (e) => { shiftRef.current = e.shiftKey; };
        window.addEventListener('keydown', handler);
        window.addEventListener('keyup', handler);
        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keyup', handler);
        };
    }, []);
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
    const handleTransformComplete = useCallback((mesh) => {
        if (!mesh?.userData?.elementId) return;
        const id = mesh.userData.elementId;
        if (transformMode === 'translate') {
            // rawSize = [sizeX, sizeZ, sizeY] (Three.js [X, height, depth])
            const rawSize = mesh.userData.rawSize ?? [1,1,1];
            const baseZ = mesh.position.y - rawSize[1] / 2;   // Three.js Y - sizeZ/2 = data Z base
            const nx = parseFloat(mesh.position.x.toFixed(3));        // data X
            const ny = parseFloat(mesh.position.z.toFixed(3));        // data Y = Three.js Z
            const nz = parseFloat(baseZ.toFixed(3));                   // data Z = Three.js Y - half
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
            // rawSize = [sizeX, sizeZ(height), sizeY(floorY)] → Three.js scale X/Y/Z
            const rawSize = mesh.userData.rawSize ?? [1,1,1];
            updateElementData(id, {
                sizeX: parseFloat((rawSize[0]*mesh.scale.x).toFixed(3)),
                sizeZ: parseFloat((rawSize[1]*mesh.scale.y).toFixed(3)),  // Three.js Y scale = data sizeZ
                sizeY: parseFloat((rawSize[2]*mesh.scale.z).toFixed(3)),  // Three.js Z scale = data sizeY
            });
            mesh.scale.set(1,1,1);
        } else if (transformMode === 'rotate') {
            updateElementData(id, {
                rotationX: parseFloat(mesh.rotation.x.toFixed(5)),
                rotationY: parseFloat(mesh.rotation.y.toFixed(5)),
                rotationZ: parseFloat(mesh.rotation.z.toFixed(5)),
            });
        }
    }, [transformMode, selectedElements, updateElementData]);

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
    }, [transformMode, modelData, updateElementData, selectedElements, handleTransformComplete, pushUndo]);

    // ── 선 클릭 (스냅 + locked + shift 직교 적용) ───────────────────────
    const handleLinePlaneClick = (e) => {
        e.stopPropagation();
        // Three.js hit: X=dataX, Y=height(≈0), Z=dataY
        let threeX = e.point.x, threeY = e.point.y, threeZ = e.point.z;
        if (snapEnabled && snapVertices.length > 0) {
            const sv = findSnapVertex(threeX, threeZ, snapVertices);
            if (sv) { threeX = sv[0]; threeY = sv[1] ?? lineDrawHeight; threeZ = sv[2]; }
        }
        // lockedAxes: data 좌표 적용 (x=dataX→Three.jsX, y=dataY→Three.jsZ, z=dataZ→Three.jsY)
        if (lineLockedAxes?.x != null) threeX = lineLockedAxes.x;
        if (lineLockedAxes?.y != null) threeZ = lineLockedAxes.y;
        if (lineLockedAxes?.z != null) threeY = lineLockedAxes.z;
        // Shift 직교: lineStart=[dataX,dataY,dataZ]
        if (shiftRef.current && lineStart) {
            const dx = threeX - lineStart[0], dz = threeZ - (lineStart[1] ?? 0);
            if (!lineLockedAxes?.x && !lineLockedAxes?.y) {
                if (Math.abs(dx) >= Math.abs(dz)) threeZ = lineStart[1] ?? 0;
                else threeX = lineStart[0];
            }
        }
        // data 좌표로 emit: x=dataX, y=dataY(Three.jsZ), z=dataZ(Three.jsY=height)
        onLineClick?.({ x: threeX, y: threeZ, z: threeY });
    };

    // OrbitControls: 드래그 중 / 리사이즈 핸들 드래그 중 / 선 꼭짓점 드래그 중 / 선택모드 / 선 작도 중 비활성화
    const orbitEnabled = !isDragging && !isResizeDragging && !isLineVertexDragging && !isSelectMode && lineDrawMode !== 'click';

    // 리사이즈 핸들 표시 조건
    const showHandles = selectedElement && !pendingElement && !isSelectMode;

    return (
        <>
            <CameraSync cameraRef={cameraRef} />

            {/* IFC 로드 시 카메라 자동 맞춤 */}
            {ifcMeshes && ifcMeshes.length > 0 && (
                <CameraAutoFit
                    ifcMeshes={ifcMeshes}
                    modelData={modelData}
                    orbitRef={orbitRef}
                    fitTrigger={fitCameraTrigger}
                />
            )}

            <OrbitControls ref={orbitRef} enabled={orbitEnabled} enableZoom makeDefault />

            {/* CAD 흑백 도면을 위해 전반적 조도를 높이고 그림자 광원을 부드럽게 */}
            <ambientLight intensity={envPreset?.light?.ambientIntensity ?? 1.1} />
            <directionalLight
                position={envPreset?.light?.dirPos ?? [10,10,10]}
                color={envPreset?.light?.dirColor ?? '#ffffff'}
                intensity={envPreset?.light?.dirIntensity ?? 0.7}
                castShadow shadow-mapSize={[2048,2048]}
            />
            <directionalLight position={[-10,5,-10]} intensity={(envPreset?.light?.dirIntensity??0.7)*0.35} />

            {/* TransformControls */}
            {selectedElement?.meshRef?.current && !isResizeDragging && (
                <TransformControls
                    ref={transformRef}
                    object={selectedElement.meshRef.current}
                    mode={transformMode}
                />
            )}

            {/* BIM 부재 — IFC 실제 지오메트리가 있으면 대체 렌더링 */}
            {ifcMeshes && ifcMeshes.length > 0 ? (
                <IFCMeshGroup
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
                />
            )}

            {/* 선 작도 클릭 평면 + hover tracker */}
            {lineDrawMode === 'click' && (
                <>
                    <HoverTracker
                        drawHeight={lineDrawHeight}
                        snapVertices={snapVertices}
                        snapEnabled={snapEnabled}
                        onHoverPosition={onHoverPosition}
                        lockedAxes={lineLockedAxes}
                        shiftRef={shiftRef}
                        lineStart={lineStart}
                    />
                    <mesh
                        rotation={[-Math.PI/2, 0, 0]}
                        position={[0, lineDrawHeight, 0]}
                        onClick={handleLinePlaneClick}
                    >
                        <planeGeometry args={[500,500]} />
                        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
                    </mesh>
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
