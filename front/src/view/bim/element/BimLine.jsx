import React, { useMemo, useEffect, useState } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

/** lineType별 기본 색상 */
export const LINE_TYPE_COLORS = {
    rebar:  '#ef4444',
    wall:   '#94a3b8',
    slab:   '#60a5fa',
    beam:   '#a78bfa',
    column: '#fbbf24',
    floor:  '#34d399',
    pipe:   '#22d3ee',
};

export const LINE_TYPE_LABELS = {
    line:   '선 (Line)',
    rebar:  '철근 (Rebar)',
    wall:   '벽체 (Wall)',
    slab:   '슬래브 (Slab)',
    beam:   '보 (Beam)',
    column: '기둥 (Column)',
    floor:  '바닥 (Floor)',
    pipe:   '배관 (Pipe)',
};

/** line 데이터에서 vertex 배열 추출 */
function getPoints(line) {
    if (line.pointsJson) {
        try {
            const parsed = typeof line.pointsJson === 'string'
                ? JSON.parse(line.pointsJson)
                : line.pointsJson;
            if (Array.isArray(parsed) && parsed.length >= 2) return parsed;
        } catch (_) { /* fallthrough */ }
    }
    return [line.start, line.end];
}

export function BimLine({ line, selected, multiSelected, onClick }) {
    const [hovered, setHovered] = useState(false);

    const typeColor = line.lineType ? LINE_TYPE_COLORS[line.lineType] : null;
    const baseColor = typeColor || (line.color ?? '#60a5fa');
    const color = selected ? '#00e5ff'
        : multiSelected ? '#f97316'
        : hovered ? '#bfdbfe'
        : baseColor;
    const width = (line.lineWidth ?? 2) + (selected || multiSelected ? 2 : hovered ? 1 : 0);
    const closed  = !!line.closed;
    const height  = Number(line.shapeHeight ?? 0);
    const points  = useMemo(() => getPoints(line), [line]);
    const isShape = closed && points.length >= 3;
    const isSolid = isShape && height > 0;

    // ── 돌출 지오메트리 (closed + shapeHeight > 0) ──────────────────
    // 좌표 규칙: 점 = [dataX, dataY(floor), dataZ(height)]
    // Three.js: X=dataX, Y(up)=dataZ, Z(depth)=dataY
    const extrudeGeom = useMemo(() => {
        if (!isSolid) return null;
        try {
            const baseZ   = points[0]?.[2] ?? 0;   // data Z (height base) → Three.js Y
            const v2pts   = points.map(([x, y]) => new THREE.Vector2(x, y)); // data XY floor plane
            if (v2pts.length < 3) return null;
            const shape   = new THREE.Shape(v2pts);
            const geom    = new THREE.ExtrudeGeometry(shape, {
                depth: height,
                bevelEnabled: false,
            });
            // ExtrudeGeometry: shape=XY(dataXY), extrude=+Z → -90° 회전 → extrude=+Y(Three.js)
            geom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
            geom.applyMatrix4(new THREE.Matrix4().makeTranslation(0, baseZ, 0));
            return geom;
        } catch (e) {
            console.warn('[BimLine] ExtrudeGeometry 생성 실패:', e);
            return null;
        }
    }, [isSolid, points, height]);

    // 언마운트 시 geometry 정리
    useEffect(() => {
        return () => { extrudeGeom?.dispose(); };
    }, [extrudeGeom]);

    // ── 폴리라인 점 목록 ─────────────────────────────────────────────
    // 데이터: [dataX, dataY(floor), dataZ(height)] → Three.js: [X, Y=dataZ, Z=dataY]
    const linePoints = useMemo(() => {
        const pts = points.map(p => new THREE.Vector3(p[0], p[2] ?? 0, p[1] ?? 0));
        if (closed && pts.length >= 2) pts.push(pts[0].clone());
        return pts;
    }, [points, closed]);

    const handleClick = (e) => {
        e.stopPropagation();
        onClick?.(line.lineId, e.shiftKey);
    };

    const handlePointerOver = (e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
    };

    const handlePointerOut = () => {
        setHovered(false);
        document.body.style.cursor = '';
    };

    return (
        <group
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
        >
            {/* ── 솔리드 도형 (돌출) ── */}
            {isSolid && extrudeGeom && (
                <mesh geometry={extrudeGeom}>
                    <meshStandardMaterial
                        color={color}
                        transparent
                        opacity={selected ? 0.75 : 0.5}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}

            {/* ── 폴리라인 / 선 ── */}
            {linePoints.length >= 2 && (
                <Line
                    points={linePoints}
                    color={color}
                    lineWidth={width}
                />
            )}

            {/* ── 꼭짓점 마커 (비선택 상태만) — 선택됐을 때는 LineVertexHandles가 드래그 핸들 표시 ── */}
            {!selected && points.map((pos, i) => (
                <mesh key={i} position={[pos[0], pos[2] ?? 0, pos[1] ?? 0]}>
                    <sphereGeometry args={[hovered ? 0.10 : 0.07, 8, 8]} />
                    <meshBasicMaterial color={i === 0 ? '#4ade80' : color} />
                </mesh>
            ))}
        </group>
    );
}
