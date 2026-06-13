import React, { useMemo, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

const HIT_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// ── 진척도 색상 ────────────────────────────────────────────────────
function getProgressColor(progress) {
  if (progress === 0)   return new THREE.Color('#6b7280'); // 미시공 회색
  if (progress === 100) return new THREE.Color('#4ade80'); // 완료 초록
  if (progress >= 70)   return new THREE.Color('#60a5fa'); // 시공중 파랑
  if (progress >= 30)   return new THREE.Color('#fbbf24'); // 시공중 노랑
  return new THREE.Color('#f97316');                        // 시공중 주황
}

// ================================================================
// 단일 IFC 요소 메시
// ================================================================
function IFCMesh({
  mesh, onElementSelect, modelData, selectedElement, selectedElements,
  onMeshMount, progressMap, progressMode,
}) {
  const meshRef = useRef();

  const elementId = mesh.elementId;
  const element   = useMemo(
    () => modelData?.find(e => e.elementId === elementId),
    [modelData, elementId]
  );

  const isSelected      = selectedElement?.data?.elementId === elementId;
  const isMultiSelected = selectedElements?.has(elementId) && !isSelected;
  const progress        = progressMode ? (progressMap?.get(elementId) ?? -1) : -1;
  const hasProgress     = progress >= 0;

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

  // ── 기본 재질 (진척도 없을 때) ─────────────────────────────────
  const baseMaterial = useMemo(() => {
    const [r, g, b, a] = mesh.color;
    let color;
    if (isSelected)           color = new THREE.Color('#00d4ff');
    else if (isMultiSelected) color = new THREE.Color('#a78bfa');
    else if (hasProgress)     color = getProgressColor(progress);
    else                      color = new THREE.Color(r, g, b);

    return new THREE.MeshStandardMaterial({
      color,
      transparent: isSelected || isMultiSelected ? false : a < 0.99,
      opacity:     isSelected || isMultiSelected ? 1.0  : a,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.05,
    });
  }, [mesh.color, isSelected, isMultiSelected, hasProgress, progress]);

  useEffect(() => () => baseMaterial.dispose(), [baseMaterial]);

  // ── 진척도 분할 재질 (1~99% 시공중) ───────────────────────────
  const { completedMat, remainingMat, clipHeight } = useMemo(() => {
    if (!hasProgress || progress <= 0 || progress >= 100 || !element) {
      return { completedMat: null, remainingMat: null, clipHeight: null };
    }

    // Three.js 좌표: positionZ = 높이 기저, sizeZ = 높이
    const base = (Number(element.positionZ) || 0);
    const height = (Number(element.sizeZ) || 1);
    const ch = base + (progress / 100) * height;

    // 완료 부분: y < ch 유지  →  clip where y > ch  →  Plane(0,-1,0, ch)
    const cMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4ade80'),
      side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), ch)],
    });

    // 잔여 부분: y > ch 유지  →  clip where y < ch  →  Plane(0,1,0,-ch)
    const rMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6b7280'),
      transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, roughness: 0.8, metalness: 0,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -ch)],
    });

    return { completedMat: cMat, remainingMat: rMat, clipHeight: ch };
  }, [hasProgress, progress, element]);

  useEffect(() => () => { completedMat?.dispose(); remainingMat?.dispose(); },
    [completedMat, remainingMat]);

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

  // 히트박스
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

  // 레이어 비가시 상태 = visibleModelData에서 제외됨 → element 없으면 렌더 안 함
  if (!element) return null;

  // 진척도 1~99%: 두 개의 메시로 분할 렌더링
  if (completedMat && remainingMat && clipHeight !== null) {
    return (
      <>
        {/* 완료 부분 (녹색, 아래) */}
        <mesh
          ref={meshRef}
          geometry={geometry}
          material={completedMat}
          onClick={handleClick}
          onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}
          castShadow receiveShadow
        />
        {/* 잔여 부분 (회색 반투명, 위) */}
        <mesh
          geometry={geometry}
          material={remainingMat}
          onClick={handleClick}
          onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { document.body.style.cursor = ''; }}
          castShadow receiveShadow
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

  // 단일 메시 (기본)
  return (
    <>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={baseMaterial}
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
// localClippingEnabled 활성화 (ClippingPlane 사용을 위해 필요)
// ================================================================
function ClippingEnabler() {
  const { gl } = useThree();
  useEffect(() => {
    gl.localClippingEnabled = true;
    return () => { gl.localClippingEnabled = false; };
  }, [gl]);
  return null;
}

// ================================================================
// IFC 메시 그룹
// ================================================================
export const IFCMeshGroup = forwardRef(function IFCMeshGroup(
  { ifcMeshes, modelData, onElementSelect, selectedElement, selectedElements,
    progressMap, progressMode },
  ref
) {
  const meshRefsMap = useRef(new Map());

  const handleMeshMount = useCallback((elementId, meshRef) => {
    if (meshRef) meshRefsMap.current.set(elementId, meshRef);
    else         meshRefsMap.current.delete(elementId);
  }, []);

  useImperativeHandle(ref, () => ({
    getMeshPosition(elementId) {
      const mRef = meshRefsMap.current.get(elementId);
      if (!mRef?.current) return { x: 0, y: 0, z: 0 };
      const { x, y, z } = mRef.current.position;
      return { x, y, z };
    },
    applyTranslateAbsolute(selectedIds, initialMeshPositions, dx, dy, dz) {
      for (const id of selectedIds) {
        const mRef = meshRefsMap.current.get(id);
        if (!mRef?.current) continue;
        const init = initialMeshPositions[id] ?? { x: 0, y: 0, z: 0 };
        mRef.current.position.set(init.x + dx, init.y + dy, init.z + dz);
      }
    },
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
      {/* 진척도 시각화 모드일 때 localClippingEnabled 활성화 */}
      {progressMode && <ClippingEnabler />}

      {ifcMeshes.map(mesh => (
        <IFCMesh
          key={mesh.expressId}
          mesh={mesh}
          onElementSelect={onElementSelect}
          modelData={modelData}
          selectedElement={selectedElement}
          selectedElements={selectedElements}
          onMeshMount={handleMeshMount}
          progressMap={progressMap}
          progressMode={progressMode}
        />
      ))}
    </group>
  );
});
