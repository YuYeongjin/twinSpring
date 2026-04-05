import React, { useRef, useState, useMemo } from 'react';
import { Box } from '@react-three/drei';

export const parseVectorData = (dataString, defaultValue = [0, 0, 0]) => {
  if (!dataString) return defaultValue;
  try {
    const cleanedString = dataString.replace(/'/g, '"');
    const parsed = JSON.parse(cleanedString);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return parsed.slice(0, 3).map(Number);
    }
  } catch (error) {
    console.error("Failed to parse vector data:", dataString, error);
  }
  return defaultValue;
};

export const getBaseColor = (elementType) => {
  switch (elementType) {
    case 'IfcColumn': return '#8B4513';
    case 'IfcBeam':
    case 'IfcMember': return '#A9A9A9';
    case 'IfcWall':   return '#E0E0E0';
    case 'IfcSlab':   return '#B0C4DE';
    case 'IfcPier':   return '#D2691E';
    default:          return '#ff4444';
  }
};

export function BimElement({ element, onElementSelect, isPlacementMode }) {
  const meshRef = useRef();
  const [hovered, setHover] = useState(false);

  const { size, position } = useMemo(() => {
    const rawPosition = [
      Number(element.positionX) || 0,
      Number(element.positionY) || 0,
      Number(element.positionZ) || 0,
    ];
    const rawSize = [
      Number(element.sizeX) || 0.1,
      Number(element.sizeY) || 0.1,
      Number(element.sizeZ) || 0.1,
    ];
    const adjustedPosition = [...rawPosition];
    adjustedPosition[1] = rawPosition[1] + rawSize[1] / 2;
    return { size: rawSize, position: adjustedPosition };
  }, [element.positionX, element.positionY, element.positionZ,
      element.sizeX, element.sizeY, element.sizeZ]);

  // 색상 우선순위 (선택/호버 상태는 resolvedColor 위에 덮어씀)
  // element.resolvedColor: 커스텀색 > 레이어색 > null(기본색)
  const baseColor  = element.resolvedColor || getBaseColor(element.elementType);
  const selected   = element.selected;       // 단일 선택 (cyan)
  const multiSel   = element.multiSelected;  // 다중 선택 (gold)

  const handleClick = (e) => {
    // 배치 모드 중에는 클릭이 바닥 평면으로 통과하도록 stopPropagation 생략
    if (isPlacementMode) return;
    e.stopPropagation();
    if (onElementSelect) {
      onElementSelect(element, meshRef, e.shiftKey);
    }
  };

  // 색상 우선순위: 단일선택(cyan) > 다중선택(gold) > 호버(hotpink) > 레이어/커스텀/기본색
  const color = selected ? '#00e5ff'
    : multiSel ? '#ffd700'
    : hovered  ? '#ff69b4'
    : baseColor;

  return (
    <Box
      ref={meshRef}
      args={size}
      position={position}
      onClick={handleClick}
      onPointerOver={(e) => { if (!isPlacementMode) { e.stopPropagation(); setHover(true); } }}
      onPointerOut={() => setHover(false)}
      castShadow
      receiveShadow
      userData={{ elementId: element.elementId, rawSize: size }}
    >
      <meshStandardMaterial
        color={color}
        opacity={(selected || multiSel || hovered) ? 0.85 : 1}
        transparent
        // 다중 선택 시 외곽선 효과를 위해 emissive 추가
        emissive={multiSel && !selected ? '#b8860b' : '#000000'}
        emissiveIntensity={multiSel && !selected ? 0.3 : 0}
      />
    </Box>
  );
}
