import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
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
    const [selectedElements, setSelectedElements] = useState(new Set());

    // ── 신규 상태: 배치 모드 ────────────────────────────────────────
    const [pendingElement, setPendingElement] = useState(null);

    // ── 신규 상태: 선택(러버밴드) 모드 ─────────────────────────────
    const [isSelectMode, setIsSelectMode] = useState(false);

    // Three.js 카메라 ref — Scene 내부에서 주입, 러버밴드 투영에 사용
    const cameraRef = useRef(null);

    // ── 레이어 & 색상 상태 ──────────────────────────────────────────
    const [layers, setLayers] = useState([]);
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

    // ── 레이어 / 색상 DB 로드 (프로젝트 전환 시) ──────────────────
    useEffect(() => {
        const pid = selectedProject?.projectId;
        if (!pid) return;

        // 레이어 로드
        AxiosCustom.get(`${API_BASE}/layers?projectId=${pid}`)
            .then(res => setLayers(res.data || []))
            .catch(() => setLayers([]));

        // 부재 커스텀 색상 로드
        AxiosCustom.get(`${API_BASE}/colors?projectId=${pid}`)
            .then(res => {
                const colorMap = {};
                (res.data || []).forEach(c => { colorMap[c.elementId] = c.color; });
                setElementColors(colorMap);
            })
            .catch(() => setElementColors({}));
    }, [selectedProject?.projectId]);

    // ── 로딩 상태 ──────────────────────────────────────────────────
    const isLoading = !selectedProject && (!modelData || modelData.length === 0);

    // ================================================================
    // 부재 선택 (단일 / Shift+클릭 다중)
    // ================================================================
    const handleElementSelect = (data, ref, shiftKey = false) => {
        if (pendingElement) return;

        if (shiftKey) {
            setSelectedElements(prev => {
                const next = new Set(prev);
                if (next.has(data.elementId)) next.delete(data.elementId);
                else next.add(data.elementId);
                return next;
            });
            setSelectedElement({ data, meshRef: ref });
        } else {
            setSelectedElements(new Set([data.elementId]));
            setSelectedElement({ data, meshRef: ref });
        }
    };

    // ================================================================
    // 러버밴드 다중 선택 적용
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
            if (prev) setSelectedElements(new Set());
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
    // 저장 (서버 PUT) — rotation 포함
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
    // 배치 모드
    // ================================================================
    function startPlacement(template) {
        setPendingElement(template);
        setSelectedElement(null);
        setIsSelectMode(false);
    }

    function cancelPlacement() {
        setPendingElement(null);
    }

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
                rotationX: 0, rotationY: 0, rotationZ: 0,
            };
            const response = await AxiosCustom.post(`${API_BASE}/element`, payload);
            setModelData(prev => [...prev, response.data]);
        } catch (err) {
            console.error("부재 배치 실패:", err);
        }
    }

    // ================================================================
    // 샘플 구조물 일괄 배치
    // ================================================================
    async function placeSampleStructure(elements, projectId) {
        if (!projectId || !elements?.length) return;
        try {
            const payload = elements.map(el => ({
                ...el,
                elementId: "ELEM-" + Math.random().toString(36).substr(2, 9),
                projectId,
                rotationX: 0, rotationY: 0, rotationZ: 0,
            }));
            const response = await AxiosCustom.post(`${API_BASE}/elements/batch`, payload);
            setModelData(prev => [...prev, ...(response.data || [])]);
        } catch (err) {
            console.error("샘플 구조물 배치 실패:", err);
        }
    }

    // ================================================================
    // 삭제 (단일 + 다중 통합)
    // ================================================================
    async function deleteSelectedElements() {
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
                // 색상도 함께 삭제
                AxiosCustom.delete(`${API_BASE}/color/${id}`).catch(() => {});
            } catch (err) {
                console.error('삭제 실패:', id, err);
            }
        }
        setModelData(prev => prev.filter(e => !toDeleteSet.has(e.elementId)));

        // 레이어에서도 제거 + DB 동기화
        setLayers(prev => {
            const updated = prev.map(l => ({
                ...l,
                elementIds: l.elementIds.filter(id => !toDeleteSet.has(id)),
            }));
            updated.forEach(l => {
                AxiosCustom.put(`${API_BASE}/layer`, l).catch(() => {});
            });
            return updated;
        });

        // 색상 상태에서도 제거
        setElementColors(prev => {
            const next = { ...prev };
            toDelete.forEach(id => delete next[id]);
            return next;
        });

        setSelectedElements(new Set());
        setSelectedElement(null);
    }

    // ================================================================
    // 레이어 CRUD — API 연동
    // ================================================================

    function randomLayerColor() {
        const palette = [
            '#ef4444','#f97316','#eab308','#22c55e',
            '#06b6d4','#3b82f6','#8b5cf6','#ec4899',
            '#14b8a6','#f43f5e','#84cc16','#a855f7',
        ];
        return palette[Math.floor(Math.random() * palette.length)];
    }

    function addLayer() {
        const pid = selectedProject?.projectId;
        if (!pid) return;
        const newLayer = {
            layerId:    'layer-' + Math.random().toString(36).substr(2, 9),
            projectId:  pid,
            layerName:  `레이어 ${layers.length + 1}`,
            color:      randomLayerColor(),
            visible:    true,
            elementIds: [],
            sortOrder:  layers.length,
        };
        AxiosCustom.post(`${API_BASE}/layer`, newLayer)
            .then(() => setLayers(prev => [...prev, newLayer]))
            .catch(err => console.error('레이어 생성 실패:', err));
    }

    function deleteLayer(layerId) {
        AxiosCustom.delete(`${API_BASE}/layer/${layerId}`)
            .then(() => setLayers(prev => prev.filter(l => l.layerId !== layerId)))
            .catch(err => console.error('레이어 삭제 실패:', err));
    }

    function updateLayer(layerId, updates) {
        const currentLayer = layers.find(l => l.layerId === layerId);
        if (!currentLayer) return;
        const updatedLayer = { ...currentLayer, ...updates };
        setLayers(prev => prev.map(l => l.layerId === layerId ? updatedLayer : l));
        AxiosCustom.put(`${API_BASE}/layer`, updatedLayer)
            .catch(err => console.error('레이어 업데이트 실패:', err));
    }

    function assignToLayer(layerId, elementId) {
        const currentLayer = layers.find(l => l.layerId === layerId);
        if (!currentLayer) return;
        const updatedLayer = {
            ...currentLayer,
            elementIds: [...new Set([...currentLayer.elementIds, elementId])],
        };
        setLayers(prev => prev.map(l => l.layerId === layerId ? updatedLayer : l));
        AxiosCustom.put(`${API_BASE}/layer`, updatedLayer)
            .catch(err => console.error('레이어 부재 할당 실패:', err));
    }

    function removeFromLayer(layerId, elementId) {
        const currentLayer = layers.find(l => l.layerId === layerId);
        if (!currentLayer) return;
        const updatedLayer = {
            ...currentLayer,
            elementIds: currentLayer.elementIds.filter(id => id !== elementId),
        };
        setLayers(prev => prev.map(l => l.layerId === layerId ? updatedLayer : l));
        AxiosCustom.put(`${API_BASE}/layer`, updatedLayer)
            .catch(err => console.error('레이어 부재 제거 실패:', err));
    }

    // ================================================================
    // 부재 커스텀 색상 — API 연동
    // ================================================================

    function setElementColor(elementId, color) {
        const pid = selectedProject?.projectId;
        setElementColors(prev => ({ ...prev, [elementId]: color }));
        if (pid) {
            AxiosCustom.post(`${API_BASE}/color`, { elementId, projectId: pid, color })
                .catch(err => console.error('색상 저장 실패:', err));
        }
    }

    function clearElementColor(elementId) {
        setElementColors(prev => {
            const next = { ...prev };
            delete next[elementId];
            return next;
        });
        AxiosCustom.delete(`${API_BASE}/color/${elementId}`)
            .catch(err => console.error('색상 삭제 실패:', err));
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

        // 다중 선택
        selectedElements, setSelectedElements,
        applyRubberBandSelection,
        toggleSelectMode,
        isSelectMode,

        // 배치 모드
        pendingElement,
        startPlacement,
        cancelPlacement,
        confirmPlacement,

        // 샘플 구조물
        placeSampleStructure,

        // 통합 삭제
        deleteSelectedElements,

        // 카메라 ref
        cameraRef,

        // 레이어
        layers,
        addLayer,
        deleteLayer,
        updateLayer,
        assignToLayer,
        removeFromLayer,

        // 부재 커스텀 색상
        elementColors,
        setElementColor,
        clearElementColor,
    };
}
