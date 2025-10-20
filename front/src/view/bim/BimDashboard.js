import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Box, View, PerspectiveCamera, TransformControls } from '@react-three/drei';
import * as THREE from 'three';

// =========== [ 컴포넌트 헬퍼 함수 ] ===========

// JSON 문자열 "[x, y, z]"를 숫자 배열로 안전하게 변환
const parseVectorData = (dataString, defaultValue = [0, 0, 0]) => {
  if (!dataString) return defaultValue;
  try {
    const cleanedString = dataString.replace(/'/g, '"');
    const parsed = JSON.parse(cleanedString);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      return parsed.slice(0, 3).map(Number);
    }
  } catch (error) {
    console.error("Failed to parse vector data:", dataString, error);
  }
  return defaultValue;
};

// 부재 타입에 따른 기본 색상 설정
const getBaseColor = (elementType) => {
  switch (elementType) {
    case 'IfcColumn':
      return '#8B4513'; // 기둥 (Brown)
    case 'IfcBeam':
    case 'IfcMember':
      return '#A9A9A9'; // 보 (Dark Gray)
    case 'IfcWall':
      return '#E0E0E0'; // 벽 (Light Gray)
    case 'IfcSlab':
      return '#B0C4DE'; // 슬래브 (Light Steel Blue)
    default:
      return 'red'; // 디버그 색상
  }
};

// =========== [ 3D 요소 컴포넌트 ] ===========

export function BimElement({ element, onElementSelect }) {
  const meshRef = useRef();
  const [hovered, setHover] = useState(false);

  const { size, position } = useMemo(() => {
    const rawSize = parseVectorData(element.sizeData || element.size);
    const rawPosition = parseVectorData(element.positionData || element.position);

    const [width, height, depth] = rawSize;
    let adjustedPosition = [...rawPosition];

    if (element.elementType === 'IfcColumn' || element.elementType === 'IfcWall' || element.elementType === 'IfcSlab') {
      adjustedPosition[1] = rawPosition[1] + height / 2;
    }

    return {
      size: rawSize,
      position: adjustedPosition
    };
  }, [element.sizeData, element.positionData, element.elementType]);

  const handleClick = (e) => {
    e.stopPropagation();
    if (onElementSelect) {
      onElementSelect(element, meshRef);
    }
  };

  const baseColor = getBaseColor(element.elementType);
  const selected = element.selected;

  return (
    <Box
      ref={meshRef}
      args={size}
      position={position}
      onClick={handleClick}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      castShadow
      receiveShadow
      userData={{ elementId: element.elementId, rawSize: size }}
    >
      <meshStandardMaterial
        color={selected ? 'cyan' : (hovered ? 'hotpink' : baseColor)}
        opacity={selected || hovered ? 0.8 : 1}
        transparent={true}
      />
    </Box>
  );
}

// =========== [ 메인 뷰어 컴포넌트 ] ===========

function Scene({ modelData, onElementSelect, selectedElement, updateElementData, setMainCameraPosition }) {
  const { camera } = useThree();
  const controlsRef = useRef();

  // 카메라 위치를 지속적으로 업데이트
  useFrame(() => {
    setMainCameraPosition(camera.position.clone());
  });

  const handleTransformEnd = (e) => {
    const mesh = e.target.object;
    // TransformControls이 반환하는 객체가 유효한지 체크
    if (!mesh || !mesh.userData || !mesh.userData.elementId) return;

    const newPos = mesh.position;
    const elementId = mesh.userData.elementId;

    const elementToUpdate = modelData.find(e => e.elementId === elementId);
    if (elementToUpdate) {
      const rawSize = mesh.userData.rawSize;
      const height = rawSize ? rawSize[1] : 0;

      // Y축 위치는 밑면 기준으로 다시 변환 (Center Y -> Bottom Y)
      const bottomY = newPos.y - height / 2;

      updateElementData(elementId, {
        positionData: `[${newPos.x.toFixed(2)}, ${bottomY.toFixed(2)}, ${newPos.z.toFixed(2)}]`
      });
    }
  };

  return (
    <>
      <OrbitControls enableZoom={true} makeDefault />
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} castShadow />

      {/* TransformControls 렌더링 안정성 강화 */}
      {selectedElement && selectedElement.meshRef.current && (
        <TransformControls
          ref={controlsRef}
          object={selectedElement.meshRef.current}
          mode="translate"
          onObjectChange={handleTransformEnd}
        />
      )}

      {modelData.map((element) => (
        <BimElement
          key={element.elementId}
          element={{ ...element, selected: selectedElement?.data.elementId === element.elementId }}
          onElementSelect={onElementSelect}
        />
      ))}
      <Environment preset="city" />
    </>
  );
}

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
  // 💡 track props로 직접 DOM 요소를 받도록 변경
  if (!minimapContainerElement) return null;

  return (
    <View index={1} track={minimapContainerElement}>
      <PerspectiveCamera makeDefault position={[0, 50, 0]} rotation={[-Math.PI / 2, 0, 0]} fov={100} near={0.1} far={100} />

      <color attach="background" args={['#2c3e50']} />

      {modelData.map((element) => (
        <MiniMapElement key={element.elementId} element={element} />
      ))}

      <CameraMarker position={mainCameraPosition} />
    </View>
  );
}

// =========== [ HTML UI 컴포넌트 ] ===========

function PropertyPanel({ selectedElement, updateElementData }) {
  const [formData, setFormData] = useState({
    material: '',
    positionData: '',
    sizeData: '',
  });

  useEffect(() => {
    if (selectedElement) {
      const element = selectedElement.data;
      setFormData({
        material: element.material,
        positionData: element.positionData,
        sizeData: element.sizeData,
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

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
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
        onClick={handleSave}
        className="w-full rounded-md bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors mt-4"
      >
        속성 저장 (Save)
      </button>
    </div>
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
  const [selectedElement, setSelectedElement] = useState(null);
  const [mainCameraPosition, setMainCameraPosition] = useState(new THREE.Vector3(10, 10, 10));

  // isMiniMapReady 상태는 DOM 참조가 준비되었는지 확인하는 용도로만 사용
  const [isMiniMapReady, setIsMiniMapReady] = useState(false);
  const minimapContainerRef = useRef(null);
  const [minimapTrackElement, setMinimapTrackElement] = useState(null); // 실제 DOM 요소 저장

  // 💡 useLayoutEffect: DOM이 계산된 직후 실행하여 참조 준비를 확인 (오류 방지 핵심)
  useLayoutEffect(() => {
    if (minimapContainerRef.current) {
      // DOM 참조가 준비되면, 실제 DOM 요소를 상태에 저장하고 준비 완료 플래그 설정
      setMinimapTrackElement(minimapContainerRef.current);
      setIsMiniMapReady(true);
    }
  }, []);

  // ... (이하 핸들러 함수들)
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

  // modelData 로딩 상태는 외부에서 관리된다고 가정하고, 여기서는 modelData의 존재 여부로 UI를 결정
  const isLoading = !modelData || modelData.length === 0;

  return (
    <div className="min-h-screen bg-space-900 p-6" style={{
      width: '100%',
      ml: '0'
    }}>
      <h2 className='mb-5 text-2xl font-light text-white cursor-pointer' onClick={() => {
        setViceComponent('')
        setModelData([])
      }}>
        ← Back to Projects
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" >

        {/* 1. 뷰어 및 미니맵 영역 (lg:col-span-8) */}
        <div className="lg:col-span-10 space-y-6 flex flex-col">
          <Card
            title="3D BIM Viewer"
            right={<Chip color="blue">Edit Mode</Chip>}
            className="h-full relative"
          >
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-gray-400 text-xl">
                <svg className="animate-spin ml-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            ) : (
              <>
                <h3 className="text-gray-300 mb-2">Model: Bridge Structure (Elements: {modelData.length})</h3>

                {/* 뷰어 영역 */}
                <div className="w-full h-[calc(60vh-90px)] relative">
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
                    />

                    {/* MiniMap 렌더링: isMiniMapReady 상태와 실제 DOM 요소가 준비되었을 때만 렌더링 */}
                    {isMiniMapReady && minimapTrackElement && (
                      <MiniMap
                        modelData={modelData}
                        mainCameraPosition={mainCameraPosition}
                        minimapContainerElement={minimapTrackElement} // DOM 요소 자체를 전달
                      />
                    )}

                  </Canvas>

                  {/* 미니맵 HTML 영역 (View가 3D 씬을 투사할 대상) */}
                  <div
                    id="mini-map-container-id"
                    ref={minimapContainerRef}
                    className="mini-map-container absolute top-4 right-4 w-32 h-32 bg-space-900/90 border border-space-600 rounded-lg overflow-hidden shadow-2xl"
                  />
                </div>
              </>
            )}
          </Card>

          {/* 데이터 시각화 차트 영역 (선택 사항) */}
          <Card title="Structural Data Analysis" right={<Chip color="green">Live</Chip>}>
            <div className="h-40">
              <p className="text-gray-500">차트 영역 (예: 부재별 물량, 재료 강도 분포)</p>
            </div>
          </Card>
        </div>

        {/* 2. 속성 편집 및 메뉴 영역 (lg:col-span-4) */}
        <div className="lg:col-span-2 space-y-6">
          <Card
            title="Element Properties & Modification"
            right={<Chip color={selectedElement ? "orange" : "gray"}>{selectedElement ? 'SELECTED' : 'UNSELECTED'}</Chip>}
            className="h-full"
          >
            <PropertyPanel
              selectedElement={selectedElement}
              updateElementData={updateElementData}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
