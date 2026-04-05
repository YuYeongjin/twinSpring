import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import AxiosCustom from '../../axios/AxiosCustom';

const API_BASE = `/api/bim`;

export default function BimDashboardAPI({ setViceComponent, modelData, setModelData, selectedProject }) {
    // ── 기존 상태 ──────────────────────────────────────────────────
    const [selectedElement,  setSelectedElement]  = useState(null);
    const [mainCameraPosition, setMainCameraPosition] = useState(new THREE.Vector3(10, 10, 10));
    const [transformMode,    setTransformMode]    = useState('translate');
    const [isMiniMapReady,   setIsMiniMapReady]   = useState(false);
    const minimapContainerRef  = useRef(null);
    const [minimapTrackElement, setMinimapTrackElement] = useState(null);

    // ── 신규 상태: 다중 선택 ────────────────────────────────────────
    /** 다중 선택된 elementId 집합 */
    const [selectedElements, setSelectedElements] = useState(new Set());

    // ── 신규 상태: 배치 모드 ────────────────────────────────────────
    /** 호버 배치 대기 중인 부재 템플릿 (null이면 배치 모드 비활성) */
    const [pendingElement, setPendingElement] = useState(null);

    // ── 신규 상태: 선택(러버밴드) 모드 ─────────────────────────────
    const [isSelectMode, setIsSelectMode] = useState(false);

    // Three.js 카메라 ref — Scene 내부에서 주입, 러버밴드 투영에 사용
    const cameraRef = useRef(null);

    // ── 신규 상태: 레이어 ────────────────────────────────────────────
    /**
     * 레이어 목록: [{ layerId, layerName, color, visible, elementIds[] }]
     * projectId별 localStorage에 영속화
     */
    const [layers, setLayers] = useState([]);

    /**
     * 부재별 커스텀 색상: { elementId: "#hexcolor" }
     * localStorage 영속화
     */
    const [elementColors, setElementColors] = useState({});

    // ── 미니맵 초기화 ───────────────────────────────────────────────
    useLayoutEffect(() => {
        if (minimapContainerRef.current) {
            setTimeout(() => {
                setMinimapTrackElement(minimapContainerRef.current);
                setIsMiniMapReady(true);
            }, 0);
        }
    }, []);

    // ── selectedElement 동기화 ─────────────────────────────────────
    useEffect(() => {
        if (selectedElement) {
            const updated = modelData.find(e => e.elementId === selectedElement.data.elementId);
            if (updated) {
                setSelectedElement(prev => ({ ...prev, data: updated }));
            }
        }
    }, [modelData]);

    // ── 레이어 / 색상 localStorage 로드 (프로젝트 전환 시) ──────────
    useEffect(() => {
        const pid = selectedProject?.projectId;
        if (!pid) return;
        try {
            const raw = localStorage.getItem(`bim_layers_${pid}`);
            setLayers(raw ? JSON.parse(raw) : []);
        } catch { setLayers([]); }
        try {
            const raw = localStorage.getItem(`bim_colors_${pid}`);
            setElementColors(raw ? JSON.parse(raw) : {});
        } catch { setElementColors({}); }
    }, [selectedProject?.projectId]);

    // ── 레이어 변경 → localStorage 저장 ──────────────────────────
    useEffect(() => {
        const pid = selectedProject?.projectId;
        if (!pid) return;
        try { localStorage.setItem(`bim_layers_${pid}`, JSON.stringify(layers)); } catch {}
    }, [layers, selectedProject?.projectId]);

    // ── 색상 변경 → localStorage 저장 ────────────────────────────
    useEffect(() => {
        const pid = selectedProject?.projectId;
        if (!pid) return;
        try { localStorage.setItem(`bim_colors_${pid}`, JSON.stringify(elementColors)); } catch {}
    }, [elementColors, selectedProject?.projectId]);

    // ── 로딩 상태 ──────────────────────────────────────────────────
    const isLoading = !selectedProject && (!modelData || modelData.length === 0);

    // ================================================================
    // 부재 선택 (단일 / Shift+클릭 다중)
    // ================================================================
    const handleElementSelect = (data, ref, shiftKey = false) => {
        if (pendingElement) return; // 배치 모드 중 선택 무시

        if (shiftKey) {
            // Shift+클릭: 집합에 추가 또는 제거
            setSelectedElements(prev => {
                const next = new Set(prev);
                if (next.has(data.elementId)) {
                    next.delete(data.elementId);
                } else {
                    next.add(data.elementId);
                }
                return next;
            });
            setSelectedElement({ data, meshRef: ref });
        } else {
            // 일반 클릭: 해당 부재만 선택
            setSelectedElements(new Set([data.elementId]));
            setSelectedElement({ data, meshRef: ref });
        }
    };

    // ================================================================
    // 러버밴드 다중 선택 적용 (BimDashboard 에서 호출)
    // ================================================================
    function applyRubberBandSelection(ids) {
        setSelectedElements(new Set(ids));
        if (ids.length > 0) {
            const el = modelData.find(e => e.elementId === ids[0]);
            if (el) setSelectedElement({ data: el, meshRef: null });
        } else {
            setSelectedElement(null);
        }
    }

    // ================================================================
    // 선택 모드 토글
    // ================================================================
    function toggleSelectMode() {
        setIsSelectMode(prev => {
            if (prev) {
                // 선택 모드 종료 시 다중 선택 초기화
                setSelectedElements(new Set());
            }
            return !prev;
        });
    }

    // ================================================================
    // 3D 뷰어 실시간 반영
    // ================================================================
    const updateElementData = (id, newProps) => {
        setModelData(prevData =>
            prevData.map(element =>
                element.elementId === id ? { ...element, ...newProps } : element
            )
        );
    };

    // ================================================================
    // 저장 (서버 PUT)
    // ================================================================
    function saveUpdateElement() {
        if (!selectedElement) return;
        const payload = { ...selectedElement.data };

        if (payload.positionData) {
            try {
                const arr = typeof payload.positionData === 'string'
                    ? JSON.parse(payload.positionData)
                    : payload.positionData;
                if (Array.isArray(arr) && arr.length >= 3) {
                    payload.positionX = arr[0]; payload.positionY = arr[1]; payload.positionZ = arr[2];
                }
            } catch (e) { console.error("Position 파싱 오류", e); }
        }
        if (payload.sizeData) {
            try {
                const arr = typeof payload.sizeData === 'string'
                    ? JSON.parse(payload.sizeData)
                    : payload.sizeData;
                if (Array.isArray(arr) && arr.length >= 3) {
                    payload.sizeX = arr[0]; payload.sizeY = arr[1]; payload.sizeZ = arr[2];
                }
            } catch (e) { console.error("Size 파싱 오류", e); }
        }

        AxiosCustom.put(`${API_BASE}/model/element`, payload)
            .then(() => console.log("저장 완료:", payload.elementId))
            .catch(err => console.error("저장 실패:", err));
    }

    // ================================================================
    // 배치 모드 — 부재 생성 (호버 후 클릭 위치 지정)
    // ================================================================

    /** 배치 모드 시작: 템플릿을 들고 마우스로 위치를 지정하게 됨 */
    function startPlacement(template) {
        setPendingElement(template);
        setSelectedElement(null);
        setIsSelectMode(false); // 선택 모드와 동시 사용 불가
    }

    /** 배치 모드 취소 */
    function cancelPlacement() {
        setPendingElement(null);
    }

    /**
     * 배치 확정 — Scene의 바닥 평면 클릭 시 호출
     * @param {{ x: number, z: number }} position  클릭된 3D 좌표 (Y=0 바닥 기준)
     * @param {string} projectId
     */
    async function confirmPlacement(position, projectId) {
        if (!projectId || !pendingElement) return;
        try {
            const payload = {
                ...pendingElement,
                projectId,
                elementId: "ELEM-" + Math.random().toString(36).substr(2, 9),
                positionX: parseFloat(position.x.toFixed(3)),
                positionY: 0,
                positionZ: parseFloat(position.z.toFixed(3)),
                sizeX: pendingElement.sizeX ?? 1,
                sizeY: pendingElement.sizeY ?? 1,
                sizeZ: pendingElement.sizeZ ?? 1,
                material: pendingElement.material ?? 'Concrete C30',
            };
            const response = await AxiosCustom.post(`${API_BASE}/element`, payload);
            setModelData(prev => [...prev, response.data]);
            // 배치 모드 유지 — 연속 배치 가능 (Escape로 종료)
        } catch (err) {
            console.error("부재 배치 실패:", err);
        }
    }

    // ================================================================
    // 삭제 (단일 + 다중 통합)
    // ================================================================
    async function deleteSelectedElements() {
        // 다중 선택 집합 + 현재 selectedElement 를 합산
        const toDeleteSet = new Set([
            ...selectedElements,
            ...(selectedElement ? [selectedElement.data.elementId] : []),
        ]);
        const toDelete = [...toDeleteSet];
        if (toDelete.length === 0) return;

        const label = toDelete.length === 1
            ? `부재 "${toDelete[0]}"를`
            : `선택된 ${toDelete.length}개 부재를`;
        if (!window.confirm(`${label} 삭제하시겠습니까?`)) return;

        for (const id of toDelete) {
            try {
                await AxiosCustom.delete(`${API_BASE}/element/${id}`);
            } catch (err) {
                console.error('삭제 실패:', id, err);
            }
        }
        setModelData(prev => prev.filter(e => !toDeleteSet.has(e.elementId)));
        // 삭제된 부재를 레이어에서도 제거
        setLayers(prev => prev.map(l => ({
            ...l,
            elementIds: l.elementIds.filter(id => !toDeleteSet.has(id)),
        })));
        setSelectedElements(new Set());
        setSelectedElement(null);
    }

    // ================================================================
    // 레이어 CRUD
    // ================================================================

    /** 랜덤 선명한 색상 생성 */
    function randomLayerColor() {
        const palette = [
            '#ef4444','#f97316','#eab308','#22c55e',
            '#06b6d4','#3b82f6','#8b5cf6','#ec4899',
            '#14b8a6','#f43f5e','#84cc16','#a855f7',
        ];
        return palette[Math.floor(Math.random() * palette.length)];
    }

    function addLayer() {
        const newLayer = {
            layerId:   'layer-' + Math.random().toString(36).substr(2, 9),
            layerName: `레이어 ${layers.length + 1}`,
            color:     randomLayerColor(),
            visible:   true,
            elementIds: [],
        };
        setLayers(prev => [...prev, newLayer]);
    }

    function deleteLayer(layerId) {
        setLayers(prev => prev.filter(l => l.layerId !== layerId));
    }

    function updateLayer(layerId, updates) {
        setLayers(prev => prev.map(l =>
            l.layerId === layerId ? { ...l, ...updates } : l
        ));
    }

    /**
     * 부재를 레이어에 추가
     * 같은 부재가 이미 다른 레이어에 있더라도 중복 허용 (멀티-레이어)
     */
    function assignToLayer(layerId, elementId) {
        setLayers(prev => prev.map(l =>
            l.layerId === layerId
                ? { ...l, elementIds: [...new Set([...l.elementIds, elementId])] }
                : l
        ));
    }

    /** 레이어에서 부재 제거 */
    function removeFromLayer(layerId, elementId) {
        setLayers(prev => prev.map(l =>
            l.layerId === layerId
                ? { ...l, elementIds: l.elementIds.filter(id => id !== elementId) }
                : l
        ));
    }

    // ================================================================
    // 부재 커스텀 색상
    // ================================================================

    function setElementColor(elementId, color) {
        setElementColors(prev => ({ ...prev, [elementId]: color }));
    }

    function clearElementColor(elementId) {
        setElementColors(prev => {
            const next = { ...prev };
            delete next[elementId];
            return next;
        });
    }

    return {
        // 기존
        saveUpdateElement,
        selectedElement, setSelectedElement,
        mainCameraPosition, setMainCameraPosition,
        isMiniMapReady, setIsMiniMapReady,
        minimapContainerRef,
        minimapTrackElement, setMinimapTrackElement,
        isLoading,
        handleElementSelect, updateElementData,
        transformMode, setTransformMode,

        // 신규: 다중 선택
        selectedElements, setSelectedElements,
        applyRubberBandSelection,
        toggleSelectMode,
        isSelectMode,

        // 신규: 배치 모드
        pendingElement,
        startPlacement,
        cancelPlacement,
        confirmPlacement,

        // 신규: 통합 삭제
        deleteSelectedElements,

        // 카메라 ref (러버밴드 투영용)
        cameraRef,

        // 신규: 레이어
        layers,
        addLayer,
        deleteLayer,
        updateLayer,
        assignToLayer,
        removeFromLayer,

        // 신규: 부재 커스텀 색상
        elementColors,
        setElementColor,
        clearElementColor,
    };
}
