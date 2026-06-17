import React, { useRef, useState, useMemo } from 'react';
import { Box, Edges } from '@react-three/drei';

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

// PlacementGhost 에서 계속 사용 (색상 참조용)
export const getBaseColor = (elementType) => {
  switch (elementType) {
    case 'IfcColumn': return '#8B4513';
    case 'IfcBeam':
    case 'IfcMember': return '#A9A9A9';
    case 'IfcWall':   return '#E0E0E0';
    case 'IfcSlab':        return '#B0C4DE';
    case 'IfcFoundation':  return '#8B6400';  // 기초 — 흙/콘크리트 갈색
    case 'IfcPier':        return '#D2691E';
    case 'IfcRebar':  return '#CC2200';
    default:          return '#ff4444';
  }
};


export function BimElement({ element, onElementSelect, isPlacementMode }) {
  const meshRef = useRef();
  const [hovered, setHover] = useState(false);

  // 좌표 규칙: Z-up — posX→X, posY→Y, posZ→Z(높이)
  const { size, position } = useMemo(() => {
    const pX = Number(element.positionX) || 0;
    const pY = Number(element.positionY) || 0;
    const pZ = Number(element.positionZ) || 0;  // 높이 (Z-up)
    const sX = Number(element.sizeX) || 0.1;
    const sY = Number(element.sizeY) || 0.1;
    const sZ = Number(element.sizeZ) || 0.1;
    return {
      size:     [sX, sY, sZ],
      position: [pX, pY, pZ + sZ / 2],
    };
  }, [element.positionX, element.positionY, element.positionZ,
      element.sizeX, element.sizeY, element.sizeZ]);

  const selected = element.selected;
  const multiSel = element.multiSelected;

  // 기본색: resolvedColor(레이어/커스텀) > getBaseColor(타입별) 순 우선순위
  const baseColor = element.resolvedColor || getBaseColor(element.elementType);

  // 면 색상: 선택·호버 상태 > 기본색
  const faceColor = selected ? '#dff0ff'
    : multiSel ? '#fffbe0'
    : hovered  ? '#eaf5ff'
    : baseColor;

  // 외곽선: 선택·호버 강조, 기본은 기본색을 약간 어둡게
  const edgeColor = selected ? '#00e5ff'
    : multiSel ? '#ffd700'
    : hovered  ? '#1e90ff'
    : '#2a2a2a';

  const handleClick = (e) => {
    if (isPlacementMode) return;
    e.stopPropagation();
    if (onElementSelect) {
      onElementSelect(element, meshRef, e.shiftKey);
    }
  };

  const rotation = useMemo(() => [
    Number(element.rotationX) || 0,
    Number(element.rotationY) || 0,
    Number(element.rotationZ) || 0,
  ], [element.rotationX, element.rotationY, element.rotationZ]);

  return (
    <Box
      ref={meshRef}
      args={size}
      position={position}
      rotation={rotation}
      onClick={handleClick}
      onPointerOver={(e) => { if (!isPlacementMode) { e.stopPropagation(); setHover(true); } }}
      onPointerOut={() => setHover(false)}
      castShadow
      receiveShadow
      userData={{ elementId: element.elementId, rawSize: size }}
    >
      <meshStandardMaterial
        color={faceColor}
        roughness={0.55}
        metalness={0.0}
        opacity={
          element.resolvedOpacity != null ? element.resolvedOpacity :
          (selected || multiSel ? 0.95 : hovered ? 0.92 : 0.88)
        }
        transparent
        emissive={multiSel && !selected ? '#c8a800' : '#000000'}
        emissiveIntensity={multiSel && !selected ? 0.06 : 0}
      />
      {/* CAD 스타일 외곽선 */}
      <Edges
        threshold={15}
        color={edgeColor}
        linewidth={selected || hovered ? 2.5 : 1.5}
      />
    </Box>
  );
}
