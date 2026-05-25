import React, { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';

// 선택용 투명 AABB 재질 — 렌더링은 완전 투명, 레이캐스팅은 정상 작동
const HIT_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

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
    if (!mesh.normals || mesh.normals.length === 0) {
      geo.computeVertexNormals();
    }
    geo.computeBoundingBox();
    return geo;
  }, [mesh]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // 재질 (선택 상태에 따라 색상 변경)
  const material = useMemo(() => {
    const [r, g, b, a] = mesh.color;
    let color;
    if (isSelected)           color = new THREE.Color('#00d4ff');
    else if (isMultiSelected) color = new THREE.Color('#a78bfa');
    else                      color = new THREE.Color(r, g, b);

    return new THREE.MeshStandardMaterial({
      color,
      transparent: isSelected || isMultiSelected ? false : a < 0.99,
      opacity:     isSelected || isMultiSelected ? 1.0 : a,
      side: THREE.DoubleSide,
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

  // ── 투명 AABB 히트박스 (작은 모델도 안정적으로 선택 가능) ──────────
  // element AABB: positionX/Z = 중심, positionY = 밑면, sizeY = 높이
  const hitPos = useMemo(() => {
    if (!element) return null;
    return [
      Number(element.positionX) || 0,
      (Number(element.positionY) || 0) + (Number(element.sizeY) || 0.1) / 2,
      Number(element.positionZ) || 0,
    ];
  }, [element]);

  const hitArgs = useMemo(() => {
    if (!element) return null;
    // 최소 0.02m 보장 — 극소 모델도 클릭 가능
    return [
      Math.max(Number(element.sizeX) || 0.02, 0.02),
      Math.max(Number(element.sizeY) || 0.02, 0.02),
      Math.max(Number(element.sizeZ) || 0.02, 0.02),
    ];
  }, [element]);

  return (
    <>
      {/* 실제 IFC 지오메트리 메시 */}
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

      {/* 투명 AABB 히트박스 — 작은 모델이나 복잡한 지오메트리에서 클릭 보조 */}
      {hitPos && hitArgs && (
        <mesh
          position={hitPos}
          material={HIT_MATERIAL}
          onClick={handleClick}
          onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}
        >
          <boxGeometry args={hitArgs} />
        </mesh>
      )}
    </>
  );
}

// ================================================================
// IFC 메시 그룹 — 실제 IFC 지오메트리를 Three.js로 렌더링
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
