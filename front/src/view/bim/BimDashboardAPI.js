import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Box, View, PerspectiveCamera, TransformControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { parseVectorData, getBaseColor } from './element/BimElement';
import Scene from './component/Scene';
import axios from 'axios';



export default function BimDashboardAPI({ setViceComponent, modelData, setModelData }) {
    const [selectedElement, setSelectedElement] = useState(null);
    const [mainCameraPosition, setMainCameraPosition] = useState(new THREE.Vector3(10, 10, 10));

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

    const handleElementSelect = (data, ref) => {
        setSelectedElement({ data, meshRef: ref });
    };

    const updateElementData = (id, newProps) => {
        setModelData(prevData =>
            prevData.map(element =>
                element.elementId === id ? { ...element, ...newProps } : element
            )
        );
    };

    useEffect(() => {
        // modelData가 변경되면 selectedElement의 data도 업데이트
        if (selectedElement) {
            const updatedData = modelData.find(e => e.elementId === selectedElement.data.elementId);
            if (updatedData) {
                setSelectedElement(prev => ({ ...prev, data: updatedData }));
            }
        }
    }, [modelData]);


    const isLoading = !modelData || modelData.length === 0;

    function saveUpdateElement() {
        const payload = { ...selectedElement.data };

        if (payload.positionData) {
            let posArray;

            if (typeof payload.positionData === 'string') {
                try {
                    posArray = JSON.parse(payload.positionData);
                } catch (e) {
                    console.error("Position parsing error", e);
                }
            }
            else if (Array.isArray(payload.positionData)) {
                posArray = payload.positionData;
            }
            if (posArray && posArray.length >= 3) {
                payload.positionX = posArray[0];
                payload.positionY = posArray[1];
                payload.positionZ = posArray[2];
            }
        }
        if (payload.sizeData) {
            let sizeArray;

            if (typeof payload.sizeData === 'string') {
                try { sizeArray = JSON.parse(payload.sizeData); } catch (e) { }
            } else if (Array.isArray(payload.sizeData)) {
                sizeArray = payload.sizeData;
            }

            if (sizeArray && sizeArray.length >= 3) {
                payload.sizeX = sizeArray[0];
                payload.sizeY = sizeArray[1];
                payload.sizeZ = sizeArray[2];
            }
        }

        axios.put("http://localhost:8080/api/bim/model/element", payload)
            .then((response) => {
                console.log("저장 성공:", response.data);
                // 필요하다면 여기서 로컬 상태(modelData)도 최신화하거나 재조회
            })
            .catch((error) => {
                console.log("저장 실패:", error);
            });
    }

    useEffect(() => {
        if (selectedElement) {
            const updatedData = modelData.find(e => e.elementId === selectedElement.data.elementId);
            if (updatedData) {
                setSelectedElement(prev => ({ ...prev, data: updatedData }));
            }
        }
    }, [modelData]);
    return ({
        saveUpdateElement,
        selectedElement, setSelectedElement,
        mainCameraPosition, setMainCameraPosition,
        isMiniMapReady, setIsMiniMapReady,
        minimapContainerRef,
        minimapTrackElement, setMinimapTrackElement,
        isLoading,
        handleElementSelect, updateElementData
    });
}
