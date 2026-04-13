import React, { useMemo, useEffect } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

/**
 * BIM 3D 선 / 폴리라인 / 도형 요소
 *
 * line 데이터 구조:
 *   { lineId, start, end, color, lineWidth,
 *     pointsJson?,   // JSON 문자열 or 배열: [[x,y,z], ...]
 *     closed?,       // boolean — 마지막 점을 첫 점과 연결
 *     shapeHeight?,  // number > 0 이면 closed 도형을 Y축으로 돌출 (3D 솔리드)
 *   }
 */

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

export function BimLine({ line, selected, onClick }) {
    const color   = selected ? '#00e5ff' : (line.color ?? '#60a5fa');
    const width   = (line.lineWidth ?? 2) + (selected ? 1.5 : 0);
    const closed  = !!line.closed;
    const height  = Number(line.shapeHeight ?? 0);
    const points  = useMemo(() => getPoints(line), [line]);
    const isShape = closed && points.length >= 3;
    const isSolid = isShape && height > 0;

    // ── 돌출 지오메트리 (closed + shapeHeight > 0) ──────────────────
    const extrudeGeom = useMemo(() => {
        if (!isSolid) return null;
        try {
            const baseY   = points[0]?.[1] ?? 0;
            const v2pts   = points.map(([x, , z]) => new THREE.Vector2(x, z));
            // 최소 면적 확인 (겹치는 점 제거)
            if (v2pts.length < 3) return null;
            const shape   = new THREE.Shape(v2pts);
            const geom    = new THREE.ExtrudeGeometry(shape, {
                depth: height,
                bevelEnabled: false,
            });
            // ExtrudeGeometry: shape=XY, extrude=+Z → -90° 회전 → extrude=+Y
            geom.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
            geom.applyMatrix4(new THREE.Matrix4().makeTranslation(0, baseY, 0));
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
    // drei Line은 Vector3 또는 [x,y,z] 배열을 받음
    const linePoints = useMemo(() => {
        const pts = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
        if (closed && pts.length >= 2) pts.push(pts[0].clone()); // 닫기
        return pts;
    }, [points, closed]);

    const handleClick = (e) => {
        e.stopPropagation();
        onClick?.(line.lineId);
    };

    return (
        <group onClick={handleClick}>
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

            {/* ── 꼭짓점 마커 ── */}
            {points.map((pos, i) => (
                <mesh key={i} position={[pos[0], pos[1], pos[2]]}>
                    <sphereGeometry args={[selected ? 0.12 : 0.07, 8, 8]} />
                    <meshBasicMaterial color={i === 0 ? '#4ade80' : color} />
                </mesh>
            ))}
        </group>
    );
}
