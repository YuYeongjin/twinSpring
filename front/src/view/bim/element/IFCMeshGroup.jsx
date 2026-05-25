import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';

// ================================================================
// 단일 IFC 요소 메시
// ================================================================
function IFCMesh({ mesh, onElementSelect, modelData, selectedElement, selectedElements }) {
  const meshRef = useRef();

  const elementId = mesh.elementId; // `IFC-${expressId}`
  const element   = useMemo(
    () => modelData?.find(e => e.elementId === elementId),
    [modelData, elementId]
  );

  const isSelected      = selectedElement?.data?.elementId === elementId;
  const isMultiSelected = selectedElements?.has(elementId) && !isSelected;

  // Three.js BufferGeometry 생성
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    if (mesh.normals && mesh.normals.length > 0) {
      geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    }
    if (mesh.indices && mesh.indices.length > 0) {
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    }
    // 법선이 없으면 자동 계산
    if (!mesh.normals || mesh.normals.length === 0) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    return geo;
  }, [mesh]);

  // 메모리 해제
  useEffect(() => () => geometry.dispose(), [geometry]);

  // 재질 (선택 상태에 따라 색상 변경)
  const material = useMemo(() => {
    const [r, g, b, a] = mesh.color;
    let color;
    if (isSelected)      color = new THREE.Color('#00d4ff');
    else if (isMultiSelected) color = new THREE.Color('#a78bfa');
    else                 color = new THREE.Color(r, g, b);

    return new THREE.MeshStandardMaterial({
      color,
      transparent: isSelected || isMultiSelected ? false : a < 0.99,
      opacity:     isSelected || isMultiSelected ? 1.0 : a,
      side: THREE.DoubleSide,         // 법선 방향과 무관하게 양면 렌더링
      roughness: 0.7,
      metalness: 0.05,
    });
  }, [mesh.color, isSelected, isMultiSelected]);

  useEffect(() => () => material.dispose(), [material]);

  const handleClick = (e) => {
    e.stopPropagation();
    if (element && onElementSelect) {
      onElementSelect({ data: element, meshRef });
    }
  };

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      onClick={handleClick}
      onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
      castShadow
      receiveShadow
    />
  );
}

// ================================================================
// IFC 메시 그룹 — 실제 IFC 지오메트리를 Three.js로 렌더링
//
// Props:
//   ifcMeshes: IfcMeshData[]  — ifcImporter.js에서 반환된 실제 지오메트리
//   modelData:  BimElementDTO[] — DB에서 로드된 AABB 요소 (선택/편집용)
//   onElementSelect: (element) => void
//   selectedElement: { data, meshRef } | null
//   selectedElements: Set<string>
// ================================================================
export function IFCMeshGroup({
  ifcMeshes,
  modelData,
  onElementSelect,
  selectedElement,
  selectedElements,
}) {
  if (!ifcMeshes || ifcMeshes.length === 0) return null;

  return (
    <group>
      {ifcMeshes.map(mesh => (
        <IFCMesh
          key={mesh.expressId}
          mesh={mesh}
          onElementSelect={onElementSelect}
          modelData={modelData}
          selectedElement={selectedElement}
          selectedElements={selectedElements}
        />
      ))}
    </group>
  );
}
