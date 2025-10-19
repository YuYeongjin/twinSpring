import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import SatelliteAPI from "./SatelliteAPI";
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { BimElement } from './bim/element/BimElement';
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
function Chip({ color = "gray", children, onClick }) { // 👈 1. onClick prop을 받도록 추가
  const map = {
    green: "bg-green-900/40 text-green-300 border-green-600/40",
    red: "bg-red-900/40 text-red-300 border-red-600/40",
    blue: "bg-blue-900/40 text-blue-300 border-blue-600/40 cursor-pointer", // 👈 선택적: 클릭 가능함을 시각적으로 보여줌
    orange: "bg-orange-900/40 text-orange-300 border-orange-600/40",
    gray: "bg-gray-800 text-gray-300 border-gray-700",
  };
  return (
    // 👈 2. 받은 onClick prop을 <span> 태그에 연결
    <span 
      className={`px-2 py-0.5 text-xs border rounded-md ${map[color]}`} 
      onClick={onClick}
    >
      {children}
    </span>
  );
}

export default function SatelliteDashboard({ setViceComponent, elements, onProjectSelect, projectList }) {
  const {
    data,
    mode, setMode,
    batt,
    rssi,
    latest, addNewProject,
    bimMenu, setBimMenu
  } = SatelliteAPI();


  const toggleMenu = () => setBimMenu(prev => (prev === "default" ? "create" : "default"));
  const toggleMode = () => setMode(prev => (prev === "NORMAL" ? "SAFE" : "NORMAL"));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 좌측: 상태 요약 */}
      <div className="lg:col-span-4 space-y-6">
        <Card
          title="Satellite Status"
          right={<Chip color={mode === "SAFE" ? "red" : "green"}>{mode}</Chip>}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-space-700/70 rounded-xl px-4 py-3 shadow-inner">
              <div className="text-xs text-gray-400 uppercase">Temperature</div>
              <div className="text-2xl font-bold text-accent-orange">
                {latest && latest.temperature ? latest.temperature : "-"}
                <span className="text-sm ml-1">°C</span>
              </div>
            </div>
            <div className="bg-space-700/70 rounded-xl px-4 py-3 shadow-inner">
              <div className="text-xs text-gray-400 uppercase">Humidity</div>
              <div className="text-2xl font-bold text-accent-blue">
                {latest && latest.humidity ? latest.humidity : "-"}
                <span className="text-sm ml-1">%</span>
              </div>
            </div>
            <div className="bg-space-700/70 rounded-xl px-4 py-3 shadow-inner">
              <div className="text-xs text-gray-400 uppercase">Battery</div>
              <div className="text-xl font-bold text-green-400">
                {batt && batt.v ? batt.v : ''}V <span className="mx-1 text-gray-500">/</span> {batt && batt.i ? batt.i : ''}A
              </div>
            </div>
            <div className="bg-space-700/70 rounded-xl px-4 py-3 shadow-inner">
              <div className="text-xs text-gray-400 uppercase">Link RSSI</div>
              <div className={`text-2xl font-bold ${rssi > -92 ? "text-green-400" : "text-yellow-400"}`}>
                {rssi} <span className="text-sm">dBm</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Operations">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={toggleMode}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-500 hover:to-blue-500 transition shadow-glow"
            >
              Switch to {mode === "NORMAL" ? "SAFE MODE" : "NORMAL MODE"}
            </button>

            <button
              className="px-4 py-2 rounded-lg bg-space-700 text-gray-200 border border-space-600 hover:bg-space-600 transition"
              onClick={() => alert("Ping sent (mock)!")}
            >
              Ping Satellite
            </button>

            <button
              className="px-4 py-2 rounded-lg bg-space-700 text-gray-200 border border-space-600 hover:bg-space-600 transition"
              onClick={() => alert("Request Snapshot (mock)!")}
            >
              Request Snapshot
            </button>
          </div>
          <div className="mt-4 text-xs text-gray-400">
            * 실제 연동 시 이 버튼들은 MQ/REST/WebSocket으로 TC(telecommand)를 전송하도록 연결하세요.
          </div>
        </Card>

        <Card title="Event Log">
          <div className="space-y-2 text-sm max-h-48 overflow-auto">
            {data && data.map((d, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-space-700/50 border border-space-600 rounded-lg px-3 py-2"
              >
                <span className="text-gray-300">{(d.timestamp).replace('T', ' ')}</span>
                <span className="text-gray-400">
                  T:{d.temperature}°C / H:{d.humidity}% / V:{d.vbat}V
                </span>
              </div>
            ))}
            {data && !data.length && <div className="text-gray-500">No events yet…</div>}
          </div>
        </Card>
      </div>

      {/* 우측: 그래프/맵 등 */}
      <div className="lg:col-span-8 space-y-6">
        <Card
          title="Telemetry Trend"
          right={<Chip color="blue">Live</Chip>}
          className="h-[420px]"
        >
          <div className="h-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#263246" />
                <XAxis dataKey="timestamp" hide />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    background: "#0f1422",
                    border: "1px solid #232c45",
                    borderRadius: "10px",
                    color: "#e5e7eb",
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="temperature"
                  name="Temp (°C)"
                  stroke="#fb923c"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="humidity"
                  name="Humidity (%)"
                  stroke="#60a5fa"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                {/* <Line
                  type="monotone"
                  dataKey="vbat"
                  name="Vbat (V)"
                  stroke="#22c55e"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                /> */}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Map / Attitude"
          right={<Chip color="blue"
            onClick={() => toggleMenu()}
          >
            {
              bimMenu === 'default' ?
                "Add New"

                :
                "View"
            }
          </Chip>}
        >
          <div
            className="h-64 w-full bg-space-700/60 rounded-xl border border-space-600 flex items-center justify-center text-gray-400 cursor-pointer"
          >
            {
              projectList && projectList.length > 0 && bimMenu === 'default' ?
                projectList.map((item, index) => (
                  <div key={index}>
                    <button
                      onClick={() => {
                        onProjectSelect(item)
                        setViceComponent('bim')

                      }}
                    >
                      {item.projectName}
                    </button>
                  </div>

                ))
                :

                <div
                  className="w-full"
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-around',
                    width: '100%'
                  }}>
                    <p onClick={() => { addNewProject('Bridge') }}>
                      Bridge
                    </p>
                    <p onClick={() => { addNewProject('Building') }}>
                      Building
                    </p>
                  </div>
                </div>
            }
          </div>
        </Card>
      </div >
    </div >
  );
}
