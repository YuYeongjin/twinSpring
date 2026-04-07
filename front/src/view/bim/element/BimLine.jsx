import React from 'react';
import { Line } from '@react-three/drei';

/**
 * BIM 3D 선 요소
 * - Line from @react-three/drei 사용
 * - 양 끝점에 구형 마커 표시
 * - 선택 시 색상 + 두께 강조
 */
export function BimLine({ line, selected, onClick }) {
    const color = selected ? '#00e5ff' : (line.color ?? '#60a5fa');
    const width = (line.lineWidth ?? 2) + (selected ? 1.5 : 0);

    return (
        <group onClick={(e) => { e.stopPropagation(); onClick?.(line.lineId); }}>
            <Line
                points={[line.start, line.end]}
                color={color}
                lineWidth={width}
            />
            {[line.start, line.end].map((pos, i) => (
                <mesh key={i} position={pos}>
                    <sphereGeometry args={[0.1, 8, 8]} />
                    <meshBasicMaterial color={color} />
                </mesh>
            ))}
        </group>
    );
}
