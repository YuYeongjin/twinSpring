import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import axios from 'axios';

const API_BASE = "http://localhost:8080/api/bim";

export default function BimDashboardAPI({ setViceComponent, modelData, setModelData, selectedProject }) {
    const [selectedElement, setSelectedElement] = useState(null);
    const [mainCameraPosition, setMainCameraPosition] = useState(new THREE.Vector3(10, 10, 10));

    // TransformControls 조작 모드: 'translate' | 'rotate' | 'scale'
    // Revit의 이동/회전/크기 핸들에 해당
    const [transformMode, setTransformMode] = useState('translate');

    const [isMiniMapReady, setIsMiniMapReady] = useState(false);
    const minimapContainerRef = useRef(null);
    const [minimapTrackElement, setMinimapTrackElement] = useState(null);

    useLayoutEffect(() => {
        if (minimapContainerRef.current) {
            setTimeout(() => {
                setMinimapTrackElement(minimapContainerRef.current);
                setIsMiniMapReady(true);
            }, 0);
        }
    }, []);

    // 부재 클릭 선택 핸들러
    const handleElementSelect = (data, ref) => {
        setSelectedElement({ data, meshRef: ref });
    };

    // 로컬 modelData 상태 업데이트 (3D 뷰어 즉시 반영용)
    const updateElementData = (id, newProps) => {
        setModelData(prevData =>
            prevData.map(element =>
                element.elementId === id ? { ...element, ...newProps } : element
            )
        );
    };

    // selectedElement가 가리키는 data도 modelData 변경에 맞게 동기화
    useEffect(() => {
        if (selectedElement) {
            const updatedData = modelData.find(e => e.elementId === selectedElement.data.elementId);
            if (updatedData) {
                setSelectedElement(prev => ({ ...prev, data: updatedData }));
            }
        }
    }, [modelData]);

    /**
     * 로딩 상태: 프로젝트가 선택되었지만 아직 modelData가 초기화되지 않은 경우에만 true
     * 선택된 프로젝트에 부재가 0개인 경우는 로딩이 아니므로 Canvas를 그려야 함
     */
    const isLoading = !selectedProject && (!modelData || modelData.length === 0);

    /**
     * 현재 선택된 부재의 변경 사항을 서버에 저장 (Revit "저장" 동작)
     * positionData / sizeData 문자열 → positionX/Y/Z, sizeX/Y/Z 숫자로 변환 후 PUT
     */
    function saveUpdateElement() {
        if (!selectedElement) return;
        const payload = { ...selectedElement.data };

        // 배열 문자열 형태가 있으면 숫자 필드로 변환
        if (payload.positionData) {
            try {
                const arr = typeof payload.positionData === 'string'
                    ? JSON.parse(payload.positionData)
                    : payload.positionData;
                if (Array.isArray(arr) && arr.length >= 3) {
                    payload.positionX = arr[0];
                    payload.positionY = arr[1];
                    payload.positionZ = arr[2];
                }
            } catch (e) { console.error("Position 파싱 오류", e); }
        }
        if (payload.sizeData) {
            try {
                const arr = typeof payload.sizeData === 'string'
                    ? JSON.parse(payload.sizeData)
                    : payload.sizeData;
                if (Array.isArray(arr) && arr.length >= 3) {
                    payload.sizeX = arr[0];
                    payload.sizeY = arr[1];
                    payload.sizeZ = arr[2];
                }
            } catch (e) { console.error("Size 파싱 오류", e); }
        }

        axios.put(`${API_BASE}/model/element`, payload)
            .then(() => console.log("저장 완료:", payload.elementId))
            .catch(err => console.error("저장 실패:", err));
    }

    /**
     * 새 부재 생성 (Revit의 "구성요소 배치" 기능)
     * ControlPanel의 타입 버튼 → 템플릿 데이터와 현재 프로젝트 ID로 POST
     * 서버에서 elementId를 부여받아 로컬 modelData에 추가
     *
     * @param {object} template - ControlPanel의 elementTemplates 중 하나
     * @param {string} projectId - 현재 열린 프로젝트 ID
     */
    async function addNewElement(template, projectId) {
        if (!projectId) {
            console.error("addNewElement: projectId가 없습니다.");
            return;
        }
        try {
            const payload = {
                ...template,
                projectId,                    // 현재 프로젝트에 귀속
                elementId: "ELEM-" + Math.random().toString(36).substr(2, 9),
                positionX: 0, positionY: 0, positionZ: 0,
                sizeX: template.sizeX ?? 1,
                sizeY: template.sizeY ?? 1,
                sizeZ: template.sizeZ ?? 1,
                material: template.material ?? 'Concrete C30',
            };

            const response = await axios.post(`${API_BASE}/element`, payload);
            const created = response.data; // C#이 반환한 elementId 포함 부재

            // 로컬 modelData에 즉시 추가 → 3D 뷰어에 바로 표시
            setModelData(prev => [...prev, created]);
            console.log("부재 생성 완료:", created.elementId);
        } catch (err) {
            console.error("부재 생성 실패:", err);
        }
    }

    /**
     * 선택된 부재 삭제 (Revit의 Delete 키 기능)
     * 서버 DELETE 호출 후 로컬 modelData에서도 즉시 제거
     */
    async function deleteSelectedElement() {
        if (!selectedElement) return;
        const elementId = selectedElement.data.elementId;
        if (!window.confirm(`부재 "${elementId}"를 삭제하시겠습니까?`)) return;

        try {
            await axios.delete(`${API_BASE}/element/${elementId}`);
            // 로컬에서 즉시 제거
            setModelData(prev => prev.filter(e => e.elementId !== elementId));
            setSelectedElement(null);
            console.log("부재 삭제 완료:", elementId);
        } catch (err) {
            console.error("부재 삭제 실패:", err);
        }
    }

    return {
        saveUpdateElement,
        selectedElement, setSelectedElement,
        mainCameraPosition, setMainCameraPosition,
        isMiniMapReady, setIsMiniMapReady,
        minimapContainerRef,
        minimapTrackElement, setMinimapTrackElement,
        isLoading,
        handleElementSelect, updateElementData,
        transformMode, setTransformMode,  // Revit 조작 모드
        addNewElement,                    // 부재 생성
        deleteSelectedElement,            // 부재 삭제
    };
}
