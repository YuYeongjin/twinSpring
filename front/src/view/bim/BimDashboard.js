import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { BimElement } from './element/BimElement';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

/** 카드 공통 컴포넌트 */
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

/** 칩 스타일 라벨 */
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

export default function BimDashboard({ setViceComponent, elements, modelData  }) {




  return (
    <>
      <h2 className='mb-5' onClick={() => { setViceComponent('') }}>
        back
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* lg:col-span-8 (화면 너비의 2/3 차지) */}
        <div className="lg:col-span-10 space-y-6">
          <Card
            title="Viewer" // 제목 변경 권장
            right={<Chip color="blue">3D</Chip>}
            className="h-full"
          >
            <div className="w-full h-[50vh]">
              {
                modelData && modelData.length > 0 ?
                  <>
                    <h2>{modelData.modelName} (Elements: {modelData.length})</h2>
                    <Canvas camera={{ position: [5, 5, 5], fov: 75 }}>
                      {/* 카메라 시점 제어 */}
                      <OrbitControls enableZoom={true} />
                      {/* 환경광 및 그림자 설정 */}
                      <ambientLight intensity={0.5} />
                      <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} castShadow />
                      {/* 씬에 BIM 부재들을 렌더링 */}
                      {modelData.map((element) => (
                        <BimElement key={element.id} element={element} />
                      ))}
                      {/* 배경 환경 설정 */}
                      <Environment preset="city" />
                    </Canvas>
                  </>
                  :
                  null
              }
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
