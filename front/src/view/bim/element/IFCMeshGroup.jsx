import React, { useMemo, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import * as THREE from 'three';

const HIT_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// ================================================================
// 단일 IFC 요소 메시
// ================================================================
function IFCMesh({ mesh, onElementSelect, modelData, selectedElement, selectedElements, onMeshMount }) {
  const meshRef = useRef();

  const elementId = mesh.elementId;
  const element   = useMemo(
    () => modelData?.find(e => e.elementId === elementId),
    [modelData, elementId]
  );

  const isSelected      = selectedElement?.data?.elementId === elementId;
  const isMultiSelected = selectedElements?.has(elementId) && !isSelected;

  // meshRef 등록 / 해제
  useEffect(() => {
    onMeshMount?.(elementId, meshRef);
    return () => onMeshMount?.(elementId, null);
  }, [elementId, onMeshMount]);

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
    if (!onElementSelect) return;
    const target = element ?? {
      elementId: mesh.elementId,
      elementType: mesh.elementType,
      positionX: 0, positionY: 0, positionZ: 0,
      sizeX: 1, sizeY: 1, sizeZ: 1,
      material: '',
    };
    onElementSelect(target, meshRef, e.shiftKey);
  };

  // 좌표 규칙: positionX/Y = 평면(2D), positionZ = 높이(3D)
  // Three.js: X=posX, Y(up)=posZ+sizeZ/2, Z(depth)=posY
  const hitPos = useMemo(() => {
    if (!element) return null;
    return [
      Number(element.positionX) || 0,
      (Number(element.positionZ) || 0) + (Number(element.sizeZ) || 0.1) / 2,
      Number(element.positionY) || 0,
    ];
  }, [element]);

  const hitArgs = useMemo(() => {
    if (!element) return null;
    return [
      Math.max(Number(element.sizeX) || 0.02, 0.02),
      Math.max(Number(element.sizeZ) || 0.02, 0.02),
      Math.max(Number(element.sizeY) || 0.02, 0.02),
    ];
  }, [element]);

  return (
    <>
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
// IFC 메시 그룹
// ref를 통해 선택된 메시의 Three.js transform을 직접 조작한다.
// ================================================================
export const IFCMeshGroup = forwardRef(function IFCMeshGroup(
  { ifcMeshes, modelData, onElementSelect, selectedElement, selectedElements },
  ref
) {
  // elementId → React ref(meshRef) 맵
  const meshRefsMap = useRef(new Map());

  const handleMeshMount = useCallback((elementId, meshRef) => {
    if (meshRef) meshRefsMap.current.set(elementId, meshRef);
    else         meshRefsMap.current.delete(elementId);
  }, []);

  // Scene이 호출할 imperative API
  useImperativeHandle(ref, () => ({
    // translate: 선택된 메시들의 position에 델타를 더한다
    applyTranslate(selectedIds, dx, dy, dz) {
      for (const id of selectedIds) {
        const mRef = meshRefsMap.current.get(id);
        if (mRef?.current) {
          mRef.current.position.x += dx;
          mRef.current.position.y += dy;
          mRef.current.position.z += dz;
        }
      }
    },
    // rotate: 각 메시를 centroid(THREE.Vector3) 주위로 quaternion 회전
    applyRotate(selectedIds, centroid, quaternion) {
      for (const id of selectedIds) {
        const mRef = meshRefsMap.current.get(id);
        if (!mRef?.current) continue;
        const pos = mRef.current.position.clone().sub(centroid).applyQuaternion(quaternion).add(centroid);
        mRef.current.position.copy(pos);
        const q = new THREE.Quaternion().setFromEuler(mRef.current.rotation);
        q.premultiply(quaternion);
        mRef.current.rotation.setFromQuaternion(q);
      }
    },
    // scale: 각 메시를 centroid 기준으로 (sx,sy,sz) 배율 적용
    applyScale(selectedIds, centroid, sx, sy, sz) {
      const scaleVec = new THREE.Vector3(sx, sy, sz);
      for (const id of selectedIds) {
        const mRef = meshRefsMap.current.get(id);
        if (!mRef?.current) continue;
        const pos = mRef.current.position.clone().sub(centroid).multiply(scaleVec).add(centroid);
        mRef.current.position.copy(pos);
        mRef.current.scale.multiply(scaleVec);
      }
    },
  }), []);

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
          onMeshMount={handleMeshMount}
        />
      ))}
    </group>
  );
});
