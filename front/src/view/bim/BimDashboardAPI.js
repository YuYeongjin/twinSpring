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
        axios.put("http://localhost:8080/api/bim/model/element", {
            element: selectedElement
        })
            .then((response) => {
                console.log(response.data);
            })
            .catch((error) => {
                console.log(error)
            })
    }
    useLayoutEffect(() => {
        if (minimapContainerRef.current) {
            setTimeout(() => {
                setMinimapTrackElement(minimapContainerRef.current);
                setIsMiniMapReady(true);
            }, 0);
        }
    }, []);

    useEffect(() => {
        // modelData가 변경되면 selectedElement의 data도 업데이트
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
