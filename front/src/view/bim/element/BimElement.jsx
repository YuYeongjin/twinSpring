import React, { useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Box } from '@react-three/drei';

export function BimElement({ element,onElementSelect  }) {
  const meshRef = useRef();
  const [hovered, setHover] = useState(false);
  
  // 부재의 크기 (size)와 위치 (position) 데이터를 사용
  const size = element.size || [1, 1, 1];
  const position = element.position || [0, 0, 0];

  // 부재 클릭 시 이벤트 처리
  const handleClick = (e) => {
    e.stopPropagation();
    // console.log(`Element Clicked: ID=${element.id}, Type=${element.type}`);
    // alert(`부재 정보: ${element.type} (ID: ${element.id})`);
    
    // // TODO: 여기에서 Spring API를 호출하여 상세 속성을 가져오는 로직 추가

      if (onElementSelect) {
            onElementSelect(element); 
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
    >
      <meshStandardMaterial 
        color={hovered ? 'hotpink' : (element.type === 'IfcWall' ? 'lightgray' : 'brown')} 
      />
    </Box>
  );
}