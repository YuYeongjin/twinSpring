import React, { useRef, useState, useMemo } from 'react';
import { Box } from '@react-three/drei';

// JSON 문자열 "[x, y, z]"를 숫자 배열 [x, y, z]로 안전하게 변환하는 헬퍼 함수
export const parseVectorData = (dataString, defaultValue = [0, 0, 0]) => {
  if (!dataString) return defaultValue;
  try {
    // 문자열 내의 홑따옴표를 겹따옴표로 교체 
    const cleanedString = dataString.replace(/'/g, '"');
    const parsed = JSON.parse(cleanedString);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return parsed.slice(0, 3).map(Number); // 앞에서 3개 요소만 숫자형으로 반환
    }
  } catch (error) {
    console.error("Failed to parse vector data:", dataString, error);
  }
  return defaultValue;
};

// 부재 타입에 따른 기본 색상 설정
export const getBaseColor = (elementType) => {
  switch (elementType) {
    case 'IfcColumn':
      return '#8B4513'; // SaddleBrown (기둥)
    case 'IfcBeam':
    case 'IfcMember':
      return '#A9A9A9'; // DarkGray (보)
    case 'IfcWall':
      return '#E0E0E0'; // LightGray (벽)
    case 'IfcSlab':
      return '#B0C4DE'; // LightSteelBlue (슬래브/바닥)
    default:
      return 'red'; // 파싱 오류 또는 타입 미정 시 디버그 색상 (빨간색)
  }
};


export function BimElement({ element, onElementSelect }) {
  const meshRef = useRef();
  const [hovered, setHover] = useState(false);

  // 1. sizeData 파싱 및 뷰어에 맞는 position 계산
  const { size, position } = useMemo(() => {
    // BIM 데이터에서 size와 position을 문자열로 가져와 파싱
    const rawSize = parseVectorData(element.sizeData || element.size);
    const rawPosition = parseVectorData(element.positionData || element.position);

    // Three.js는 보통 Y축이 높이. rawSize = [Width, Height, Depth]
    const [width, height, depth] = rawSize;

    let adjustedPosition = [...rawPosition]; // [x, y, z]

    // 기둥/벽/슬래브의 경우, 밑면(rawPosition의 Y)에서 시작하도록 중심(Center) Y 위치를 보정.
    if (element.elementType === 'IfcColumn' || element.elementType === 'IfcWall' || element.elementType === 'IfcSlab') {
      // Center Y = Bottom Y + Height / 2
      adjustedPosition[1] = rawPosition[1] + height / 2;
    }

    return {
      size: rawSize,
      position: adjustedPosition
    };
  }, [element.sizeData, element.positionData, element.elementType]);


  // 2. 재질 및 클릭 이벤트 처리
  const baseColor = getBaseColor(element.elementType);
  const selected = element.selected;

  const handleClick = (e) => {
    e.stopPropagation();
    if (onElementSelect) {
      // onElementSelect에 element 데이터와 meshRef를 모두 전달
      onElementSelect(element, meshRef);
    }
  };

  return (
    <Box
      ref={meshRef}
      args={size}
      position={position}
      onClick={handleClick}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      // 그림자를 받도록 설정 (주변 환경광/스포트라이트와 연동)
      castShadow
      receiveShadow
      userData={{ elementId: element.elementId, rawSize: size }}
    >
      <meshStandardMaterial
        color={selected ? 'cyan' : (hovered ? 'hotpink' : baseColor)}
        opacity={selected || hovered ? 0.8 : 1}
        transparent={true}
      />
    </Box>
  );
}
