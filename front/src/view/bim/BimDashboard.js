import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Box, View, PerspectiveCamera, TransformControls, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { parseVectorData, getBaseColor } from './element/BimElement';
import Scene from './component/Scene';
import BimDashboardAPI from './BimDashboardAPI';


// =========== [ 미니맵 객체 컴포넌트 ] ===========

function MiniMapElement({ element }) {
  const { size, position } = useMemo(() => {
    const rawSize = parseVectorData(element.sizeData || element.size);
    const rawPosition = parseVectorData(element.positionData || element.position);

    let adjustedPosition = [...rawPosition];
    adjustedPosition[1] = 0.1;

    return {
      size: rawSize,
      position: adjustedPosition
    };
  }, [element.sizeData, element.positionData, element.elementType]);

  return (
    <mesh
      position={[position[0], position[1], position[2]]}
    >
      {/* 미니맵용 박스 (높이는 얇게) */}
      <boxGeometry args={[size[0], 0.1, size[2]]} />
      <meshBasicMaterial color={getBaseColor(element.elementType)} />
    </mesh>
  );
}

// =========== [ 카메라 마커 컴포넌트 ] ===========

function CameraMarker({ position }) {
  if (!position || isNaN(position.x)) return null;

  return (
    <mesh position={[position.x, 0.2, position.z]}>
      <circleGeometry args={[1.5, 32]} rotation-x={-Math.PI / 2} />
      <meshBasicMaterial color="blue" />
    </mesh>
  );
}


// =========== [ 미니맵 컴포넌트 ] ===========

function MiniMap({ modelData, mainCameraPosition, minimapContainerElement }) {
  if (!minimapContainerElement) return null;

  // zoom, near, far 값을 모델 크기에 맞게 조정
  return (
    <View index={1} track={minimapContainerElement}>
      <OrthographicCamera
        makeDefault
        position={[0, 50, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        zoom={3} // 줌 레벨 조정 필요
        near={0.1}
        far={200} // 모델 전체를 포함하도록 far 값 증가
      />

      <color attach="background" args={['#2c3e50']} />

      {modelData.map((element) => (
        <MiniMapElement key={element.elementId} element={element} />
      ))}

      <CameraMarker position={mainCameraPosition} />
    </View>
  );
}
// =========== [ HTML UI 컴포넌트 ] ===========

function PropertyPanel({ selectedElement, updateElementData, saveUpdateElement }) {
  const [formData, setFormData] = useState({
    material: '',
    posX: 0, posY: 0, posZ: 0,
    sizeX: 0, sizeY: 0, sizeZ: 0,
  });
  useEffect(() => {
    if (selectedElement && selectedElement.data) {
      const data = selectedElement.data;

      // 안전한 값 파싱 헬퍼
      const getVal = (val, arrStr, idx) => {
        if (val !== undefined && val !== null) return Number(val);
        try {
          const parsed = typeof arrStr === 'string' ? JSON.parse(arrStr) : arrStr;
          return Array.isArray(parsed) ? Number(parsed[idx]) : 0;
        } catch { return 0; }
      };

      setFormData({
        material: data.material || '',
        posX: getVal(data.positionX, data.positionData, 0),
        posY: getVal(data.positionY, data.positionData, 1),
        posZ: getVal(data.positionZ, data.positionData, 2),
        sizeX: getVal(data.sizeX, data.sizeData, 0),
        sizeY: getVal(data.sizeY, data.sizeData, 1),
        sizeZ: getVal(data.sizeZ, data.sizeData, 2),
      });
    }
  }, [selectedElement]);


  if (!selectedElement) {
    return (
      <div className="p-4 text-center text-gray-400">
        3D 뷰어에서 요소를 선택하여 속성을 수정하세요.
      </div>
    );
  }

  const element = selectedElement.data;

    // const handleChange = (e) => {
    //     const { name, value } = e.target;
    //     setFormData(prev => ({ ...prev, [name]: value }));
    // };
  const handleChange = (e) => {
    const { name, value } = e.target;
    const numericValue = name === 'material' ? value : (parseFloat(value) || 0);

    // 1. 현재 폼 상태 미리 계산 (비동기 state 문제 해결용)
    const nextFormData = {
      ...formData,
      [name]: numericValue
    };

    // 2. 폼 UI 즉시 갱신
    setFormData(nextFormData);

    // 3. 3D 뷰어용 데이터 실시간 생성
    // (positionData 등의 배열 문자열은 굳이 실시간 생성 안 해도 뷰어는 돌아가지만, 데이터 일관성을 위해 생성)
    const realtimePayload = {
      ...element, // 기존 속성 유지
      
      // 변경된 값 덮어쓰기
      material: nextFormData.material,
      positionX: nextFormData.posX,
      positionY: nextFormData.posY,
      positionZ: nextFormData.posZ,
      sizeX: nextFormData.sizeX,
      sizeY: nextFormData.sizeY,
      sizeZ: nextFormData.sizeZ,
      
      // 배열 형태도 필요하다면 갱신 (선택 사항이지만 안전하게 포함)
      positionData: JSON.stringify([nextFormData.posX, nextFormData.posY, nextFormData.posZ]),
      sizeData: JSON.stringify([nextFormData.sizeX, nextFormData.sizeY, nextFormData.sizeZ])
    };

    // 4. 상위 컴포넌트(Dashboard)의 상태를 업데이트 -> 3D Scene 리렌더링 유발
    updateElementData(element.elementId, realtimePayload);
  };

  const handleSave = () => {
    updateElementData(element.elementId, formData);
  };

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-xl font-bold text-gray-100">{element.elementType} 속성</h3>
      <p className="text-sm text-gray-400">ID: {element.elementId}</p>

      {Object.keys(formData).map(key => (
        <div key={key}>
          <label className="block text-sm font-medium text-gray-300 capitalize">
            {key.replace(/Data|([A-Z])/g, (match, p1) => p1 ? ' ' + p1 : match).trim()}
          </label>
          <input
            type="text"
            name={key}
            value={formData[key]}
            onChange={handleChange}
            onBlur={handleSave}
            className="mt-1 w-full rounded-md border border-space-600 bg-space-700 p-2 text-sm text-white focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      ))}

      <button
        onClick={() => saveUpdateElement()}
        className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors mt-4"
      >
        속성 저장 (Save)
      </button>
    </div >
  );
}

// =========== [ 카드 및 칩 컴포넌트 ] ===========

function Card({ title, right, children, className = "" }) {
  return (
    <div className={`bg-space-800/80 border border-space-700 rounded-2xl p-5 shadow ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-wide text-gray-100">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Chip({ color = "gray", children }) {
  const map = {
    green: "bg-green-900/40 text-green-300 border-green-600/40",
    red: "bg-red-900/40 text-red-300 border-red-600/40",
    blue: "bg-blue-900/40 text-blue-300 border-blue-600/40",
    orange: "bg-orange-900/40 text-orange-300 border-orange-600/40",
    gray: "bg-gray-800 text-gray-300 border-gray-700",
  };
  return (
    <span className={`px-2 py-0.5 text-xs border rounded-md ${map[color]}`}>{children}</span>
  );
}

// =========== [ 메인 대시보드 컴포넌트 ] ===========

export default function BimDashboard({ setViceComponent, modelData, setModelData }) {


  const {
    saveUpdateElement,
    selectedElement, setSelectedElement,
    mainCameraPosition, setMainCameraPosition,
    isMiniMapReady, setIsMiniMapReady,
    minimapContainerRef,
    minimapTrackElement, setMinimapTrackElement,
    isLoading,
    handleElementSelect, updateElementData
  } = BimDashboardAPI({ setViceComponent, modelData, setModelData });







  return (
    <div className="min-h-screen bg-space-900 p-6">
      <h2 className='mb-5 text-2xl font-light text-white cursor-pointer' onClick={() => {
        setViceComponent('')
        setModelData([])
      }}>
        ← Back to Projects
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-6rem)]">

        <div className="lg:col-span-10 space-y-6 flex flex-col h-full">
          <Card
            title="3D BIM Viewer"
            right={<Chip color="blue">Edit Mode</Chip>}
            className="flex-1 relative flex flex-col"
          >
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center text-gray-400 text-xl">
                <svg className="animate-spin ml-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            ) : (
              <>
                <h3 className="text-gray-300 mb-2">Model: Bridge Structure (Elements: {modelData.length})</h3>

                <div className="w-full flex-1 relative">
                  <Canvas
                    camera={{ position: [10, 10, 10], fov: 60 }}
                    shadows
                    className="rounded-xl"
                    onPointerMissed={() => setSelectedElement(null)}
                  >
                    <Scene
                      modelData={modelData}
                      onElementSelect={handleElementSelect}
                      selectedElement={selectedElement}
                      updateElementData={updateElementData}
                      setMainCameraPosition={setMainCameraPosition}
                      saveUpdateElement={saveUpdateElement}
                    />

                    {/* MiniMap 렌더링 */}
                    {isMiniMapReady && minimapTrackElement && (
                      <MiniMap
                        modelData={modelData}
                        mainCameraPosition={mainCameraPosition}
                        minimapContainerElement={minimapTrackElement}
                      />
                    )}

                  </Canvas>

                  {/* 미니맵 HTML 영역 */}
                  <div
                    id="mini-map-container-id"
                    ref={minimapContainerRef}
                    className="mini-map-container absolute top-4 right-4 w-32 h-32 bg-space-900/90 border border-space-600 rounded-lg overflow-hidden shadow-2xl"
                  />
                </div>
              </>
            )}
          </Card>

          {/* 데이터 시각화 차트 영역을 뷰어 하단에 고정 높이로 추가 */}
          <Card title="Structural Data Analysis" right={<Chip color="green">Live</Chip>} className="h-40">
            <div className="h-full flex items-center justify-center">
              <p className="text-gray-500">차트 영역 (부재별 물량, 재료 강도 분포)</p>
            </div>
          </Card>

        </div>

        {/* 2. 속성 편집 및 메뉴 영역 (lg:col-span-2) */}
        <div className="lg:col-span-2 space-y-6 flex flex-col h-full">
          <Card
            title="Element Properties & Modification"
            right={<Chip color={selectedElement ? "orange" : "gray"}>{selectedElement ? 'SELECTED' : 'UNSELECTED'}</Chip>}
            className="h-full flex flex-col"
          >
            <PropertyPanel
              selectedElement={selectedElement}
              updateElementData={updateElementData}
              saveUpdateElement={saveUpdateElement}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
