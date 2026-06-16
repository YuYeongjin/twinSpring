import React, {
  useRef, useEffect, useMemo, forwardRef, useImperativeHandle, useCallback, useState,
} from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as THREE from 'three';

// ================================================================
// GltfBimViewer
//
// /api/bim/project/{projectId}/glb 에서 내려받은 GLB 파일을 렌더링.
// 각 mesh.name = elementId  (e.g. "IFC-12345-{projectId}")
// mesh.userData = { elementType, storey, building, color }
//
// Props:
//   glbUrl          : string           — Spring /glb 엔드포인트 URL
//   modelData       : BimElementDTO[]  — DB 부재 목록 (색상·가시성 소스)
//   selectedElement : object | null
//   selectedElements: Set<string>
//   onElementSelect : (element, meshRef, isShift) => void
//   onMeshMount     : (elementId, ref) => void  — 외부 transform 연동용
// ================================================================

const HIGHLIGHT_COLOR    = new THREE.Color('#00d4ff');
const MULTI_SELECT_COLOR = new THREE.Color('#a78bfa');

export const GltfBimViewer = forwardRef(function GltfBimViewer(
  { glbUrl, modelData, selectedElement, selectedElements, onElementSelect, onMeshMount },
  ref,
) {
  const gltf     = useLoader(GLTFLoader, glbUrl);
  const groupRef = useRef();
  const meshRefs = useRef(new Map()); // elementId → THREE.Mesh ref

  // ── modelData를 Map으로 캐시 ─────────────────────────────────────
  const modelMap = useMemo(() => {
    const m = new Map();
    if (modelData) modelData.forEach(e => m.set(e.elementId, e));
    return m;
  }, [modelData]);

  // ── GLB scene 복제 후 mesh 등록 ──────────────────────────────────
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useEffect(() => {
    scene.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow    = true;
      node.receiveShadow = true;
      meshRefs.current.set(node.name, { current: node });
      onMeshMount?.(node.name, { current: node });
    });

    return () => {
      scene.traverse(node => {
        if (!node.isMesh) return;
        meshRefs.current.delete(node.name);
        onMeshMount?.(node.name, null);
        node.geometry?.dispose();
        if (Array.isArray(node.material)) {
          node.material.forEach(m => m.dispose());
        } else {
          node.material?.dispose();
        }
      });
    };
  }, [scene, onMeshMount]);

  // ── 색상 / 선택 / 가시성 동기화 ─────────────────────────────────
  useEffect(() => {
    const selectedId = selectedElement?.data?.elementId;

    scene.traverse(node => {
      if (!node.isMesh) return;

      const elementId = node.name;
      const element   = modelMap.get(elementId);

      // GLB 노드는 기본적으로 표시; element를 찾은 경우에만 레이어 가시성 적용
      node.visible = true;
      if (!element) return;

      const isSelected      = elementId === selectedId;
      const isMultiSelected = selectedElements?.has(elementId) && !isSelected;

      // 재질 색상 결정
      let color;
      if (isSelected) {
        color = HIGHLIGHT_COLOR;
      } else if (isMultiSelected) {
        color = MULTI_SELECT_COLOR;
      } else if (element.resolvedColor) {
        color = new THREE.Color(element.resolvedColor);
      } else {
        const raw = node.userData.color;
        if (raw) color = new THREE.Color(raw[0], raw[1], raw[2]);
      }

      // 재질 업데이트 (공유 재질 클론 방지)
      if (!node._customMat) {
        node._customMat = new THREE.MeshStandardMaterial({
          roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide,
        });
        node.material = node._customMat;
      }
      if (color) node._customMat.color.copy(color);

      const rawColor = node.userData.color;
      const alpha    = rawColor ? rawColor[3] : 1.0;
      node._customMat.transparent = (!isSelected && !isMultiSelected && alpha < 0.99);
      node._customMat.opacity     = (isSelected || isMultiSelected) ? 1.0 : alpha;
      node._customMat.needsUpdate = true;
    });
  }, [scene, modelMap, selectedElement, selectedElements]);

  // ── 클릭 핸들러 ─────────────────────────────────────────────────
  const { raycaster, camera, gl } = useThree();
  const pointer = useRef(new THREE.Vector2());

  const handleClick = useCallback((e) => {
    if (!onElementSelect) return;

    const rect = gl.domElement.getBoundingClientRect();
    pointer.current.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
    pointer.current.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer.current, camera);
    const meshes = [];
    scene.traverse(n => { if (n.isMesh && n.visible) meshes.push(n); });
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length === 0) return;

    const hit       = hits[0].object;
    const elementId = hit.name;
    const element   = modelMap.get(elementId);
    if (!element) return;

    e.stopPropagation();
    onElementSelect(element, { current: hit }, e.shiftKey);
  }, [onElementSelect, scene, modelMap, raycaster, camera, gl]);

  // ── 외부 imperative API (transform 호환) ─────────────────────────
  useImperativeHandle(ref, () => ({
    getMeshPosition(elementId) {
      const node = meshRefs.current.get(elementId)?.current;
      if (!node) return { x: 0, y: 0, z: 0 };
      const pos = new THREE.Vector3();
      node.getWorldPosition(pos);
      return { x: pos.x, y: pos.y, z: pos.z };
    },
    applyTranslateAbsolute(selectedIds, initialPositions, dx, dy, dz) {
      for (const id of selectedIds) {
        const node = meshRefs.current.get(id)?.current;
        if (!node) continue;
        const init = initialPositions[id] ?? { x: 0, y: 0, z: 0 };
        node.position.set(init.x + dx, init.y + dy, init.z + dz);
      }
    },
    applyTranslate(selectedIds, dx, dy, dz) {
      for (const id of selectedIds) {
        const node = meshRefs.current.get(id)?.current;
        if (!node) continue;
        node.position.x += dx;
        node.position.y += dy;
        node.position.z += dz;
      }
    },
    applyRotate(selectedIds, centroid, quaternion) {
      for (const id of selectedIds) {
        const node = meshRefs.current.get(id)?.current;
        if (!node) continue;
        const pos = node.position.clone().sub(centroid).applyQuaternion(quaternion).add(centroid);
        node.position.copy(pos);
        const q = new THREE.Quaternion().setFromEuler(node.rotation);
        q.premultiply(quaternion);
        node.rotation.setFromQuaternion(q);
      }
    },
    applyScale(selectedIds, centroid, sx, sy, sz) {
      const scaleVec = new THREE.Vector3(sx, sy, sz);
      for (const id of selectedIds) {
        const node = meshRefs.current.get(id)?.current;
        if (!node) continue;
        const pos = node.position.clone().sub(centroid).multiply(scaleVec).add(centroid);
        node.position.copy(pos);
        node.scale.multiply(scaleVec);
      }
    },
  }), []);

  return (
    <primitive
      ref={groupRef}
      object={scene}
      onClick={handleClick}
    />
  );
});

// ── 에러 바운더리 (GLB 404 / 로드 실패 시 조용히 null 렌더) ────────
class GltfErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prevProps) {
    if (prevProps.glbUrl !== this.props.glbUrl) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ── 로딩 / 에러 래퍼 ─────────────────────────────────────────────
export function GltfBimViewerSuspense(props) {
  return (
    <GltfErrorBoundary glbUrl={props.glbUrl}>
      <React.Suspense fallback={null}>
        <GltfBimViewer {...props} />
      </React.Suspense>
    </GltfErrorBoundary>
  );
}
