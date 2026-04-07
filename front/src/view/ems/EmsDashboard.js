// import React, { useState } from "react";
// import {
//   LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
//   XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
// } from "recharts";
// import EmsAPI from "./EmsAPI";

// // ================================================================
// // 공통 UI 컴포넌트
// // ================================================================

// /**
//  * 카드 컨테이너 컴포넌트
//  * 대시보드의 모든 섹션을 감싸는 공통 카드 레이아웃
//  */
// function Card({ title, right, children, className = "" }) {
//   return (
//     <div className={`bg-space-800/80 border border-space-700 rounded-2xl p-5 shadow ${className}`}>
//       <div className="mb-4 flex items-center justify-between">
//         <h2 className="text-lg font-semibold tracking-wide text-gray-100">{title}</h2>
//         {right}
//       </div>
//       {children}
//     </div>
//   );
// }

// /**
//  * 칩 스타일 라벨 컴포넌트
//  * 상태 표시 및 클릭 가능한 버튼형 라벨로 사용
//  */
// function Chip({ color = "gray", children, onClick }) {
//   const map = {
//     green: "bg-green-900/40 text-green-300 border-green-600/40",
//     red: "bg-red-900/40 text-red-300 border-red-600/40",
//     blue: "bg-blue-900/40 text-blue-300 border-blue-600/40 cursor-pointer",
//     orange: "bg-orange-900/40 text-orange-300 border-orange-600/40",
//     yellow: "bg-yellow-900/40 text-yellow-300 border-yellow-600/40",
//     gray: "bg-gray-800 text-gray-300 border-gray-700",
//   };
//   return (
//     <span
//       className={`px-2 py-0.5 text-xs border rounded-md ${map[color]}`}
//       onClick={onClick}
//     >
//       {children}
//     </span>
//   );
// }

// /**
//  * 알람 심각도에 따른 색상 스타일 반환
//  * CRITICAL(빨강), WARNING(노랑), INFO(파랑)
//  */
// function alertColor(severity) {
//   if (severity === "CRITICAL") return "border-red-500/50 bg-red-900/20 text-red-300";
//   if (severity === "WARNING")  return "border-yellow-500/50 bg-yellow-900/20 text-yellow-300";
//   return "border-blue-500/50 bg-blue-900/20 text-blue-300";
// }

// /**
//  * 숫자를 한국 원화 포맷으로 변환 (예: 1234567 → "1,234,567 원")
//  */
// function formatKrw(value) {
//   if (!value && value !== 0) return "-";
//   return Math.round(value).toLocaleString("ko-KR") + " 원";
// }

// // 구역별 파이 차트 색상 팔레트
// const ZONE_COLORS = ["#60a5fa", "#34d399", "#fb923c", "#a78bfa", "#f87171", "#fbbf24"];

// // ================================================================
// // 임계값 설정 모달
// // ================================================================

// /**
//  * 알람 임계값 설정 모달 컴포넌트
//  * MAX_POWER_KW, MIN_POWER_FACTOR, MAX_VOLTAGE, MIN_VOLTAGE 설정 가능
//  */
// function ThresholdModal({ onClose, onSave }) {
//   const [form, setForm] = useState({
//     thresholdType: "MAX_POWER_KW",
//     location: "",
//     thresholdValue: "",
//   });

//   // 임계값 유형별 한국어 설명
//   const typeLabels = {
//     MAX_POWER_KW:     "최대 소비 전력 (kW)",
//     MIN_POWER_FACTOR: "최소 역률 (0.0~1.0)",
//     MAX_VOLTAGE:      "최대 전압 (V)",
//     MIN_VOLTAGE:      "최소 전압 (V)",
//     DAILY_ENERGY_KWH: "일일 에너지 목표 (kWh)",
//   };

//   const handleSave = () => {
//     if (!form.thresholdValue) return;
//     onSave({ ...form, thresholdValue: parseFloat(form.thresholdValue) });
//     onClose();
//   };

//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
//       <div className="bg-space-800 border border-space-600 rounded-2xl p-6 w-96 shadow-xl">
//         <h3 className="text-lg font-bold text-gray-100 mb-4">알람 임계값 설정</h3>

//         {/* 임계값 유형 선택 */}
//         <label className="block text-xs text-gray-400 mb-1">임계값 유형</label>
//         <select
//           className="w-full mb-3 px-3 py-2 rounded-lg bg-space-700 border border-space-600 text-gray-200 text-sm"
//           value={form.thresholdType}
//           onChange={e => setForm(f => ({ ...f, thresholdType: e.target.value }))}
//         >
//           {Object.entries(typeLabels).map(([k, v]) => (
//             <option key={k} value={k}>{v}</option>
//           ))}
//         </select>

//         {/* 적용 위치 입력 (비워두면 전체 적용) */}
//         <label className="block text-xs text-gray-400 mb-1">적용 위치 (비워두면 전체 적용)</label>
//         <input
//           className="w-full mb-3 px-3 py-2 rounded-lg bg-space-700 border border-space-600 text-gray-200 text-sm"
//           placeholder="예: B동 3층"
//           value={form.location}
//           onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
//         />

//         {/* 임계값 입력 */}
//         <label className="block text-xs text-gray-400 mb-1">임계값</label>
//         <input
//           type="number"
//           className="w-full mb-5 px-3 py-2 rounded-lg bg-space-700 border border-space-600 text-gray-200 text-sm"
//           placeholder={typeLabels[form.thresholdType]}
//           value={form.thresholdValue}
//           onChange={e => setForm(f => ({ ...f, thresholdValue: e.target.value }))}
//         />

//         <div className="flex gap-3 justify-end">
//           <button onClick={onClose} className="px-4 py-2 rounded-lg bg-space-700 text-gray-300 hover:bg-space-600 text-sm">
//             취소
//           </button>
//           <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 text-sm">
//             저장
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }

// // ================================================================
// // EMS 대시보드 메인 컴포넌트
// // ================================================================

// /**
//  * EMS(에너지 관리 시스템) 대시보드
//  *
//  * 구성 섹션:
//  * 1. 상단 요약 카드 - 현재 전력, 역률, 전압, 예상 요금, 알람 수
//  * 2. 실시간 에너지 추이 차트 - 전력(kW) 시계열
//  * 3. 구역별 에너지 소비 - 파이 차트
//  * 4. 알람 패널 - 미해결 알람 목록 및 해결 처리
//  * 5. 시간별 피크 전력 차트 (최근 24시간)
//  * 6. 임계값 설정 패널
//  *
//  * @param {function} setViceComponent - 상위 App에서 뷰 전환 함수
//  */
// export default function EmsDashboard({ setViceComponent }) {
//   const {
//     latestEnergy,
//     energyHistory,
//     alerts,
//     newAlert,
//     zoneData,
//     summary,
//     hourlyTrend,
//     dailySummary,
//     thresholds,
//     connected,
//     resolveAlert,
//     setThreshold,
//     sendEnergyData,
//     refreshAll,
//   } = EmsAPI();

//   // 임계값 설정 모달 표시 여부
//   const [showThresholdModal, setShowThresholdModal] = useState(false);
//   // 차트 탭 전환 (실시간/시간별/일별)
//   const [chartTab, setChartTab] = useState("realtime");

//   /**
//    * 역률 값에 따른 색상 반환
//    * 0.95 이상: 녹색(양호), 0.85 이상: 노랑(주의), 미만: 빨강(위험)
//    */
//   const powerFactorColor = (pf) => {
//     if (!pf) return "text-gray-400";
//     if (pf >= 0.95) return "text-green-400";
//     if (pf >= 0.85) return "text-yellow-400";
//     return "text-red-400";
//   };

//   return (
//     <div className="space-y-6">
//       {/* 임계값 설정 모달 */}
//       {showThresholdModal && (
//         <ThresholdModal
//           onClose={() => setShowThresholdModal(false)}
//           onSave={setThreshold}
//         />
//       )}

//       {/* ============================================================
//           상단 헤더: 뒤로가기, 제목, WebSocket 연결 상태, 새로고침
//           ============================================================ */}
//       <div className="flex items-center justify-between">
//         <div className="flex items-center gap-3">
//           {/* 메인 대시보드로 돌아가기 */}
//           <button
//             onClick={() => setViceComponent('')}
//             className="px-3 py-1.5 rounded-lg bg-space-700 text-gray-300 hover:bg-space-600 text-sm border border-space-600"
//           >
//             ← 뒤로
//           </button>
//           <h1 className="text-xl font-bold text-gray-100">EMS 에너지 관리 시스템</h1>
//           {/* WebSocket 실시간 연결 상태 표시 */}
//           <Chip color={connected ? "green" : "red"}>
//             {connected ? "● 실시간" : "○ 연결 끊김"}
//           </Chip>
//         </div>
//         <div className="flex gap-2">
//           {/* 임계값 설정 버튼 */}
//           <button
//             onClick={() => setShowThresholdModal(true)}
//             className="px-3 py-1.5 rounded-lg bg-space-700 text-gray-300 hover:bg-space-600 text-sm border border-space-600"
//           >
//             임계값 설정
//           </button>
//           {/* 전체 데이터 새로고침 */}
//           <button
//             onClick={refreshAll}
//             className="px-3 py-1.5 rounded-lg bg-blue-700 text-white hover:bg-blue-600 text-sm"
//           >
//             새로고침
//           </button>
//         </div>
//       </div>

//       {/* ============================================================
//           요약 카드 영역 (상단 5개 KPI 카드)
//           ============================================================ */}
//       <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">

//         {/* 현재 소비 전력 (kW) */}
//         <div className="bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow">
//           <div className="text-xs text-gray-400 uppercase mb-1">현재 전력</div>
//           <div className="text-2xl font-bold text-accent-orange">
//             {latestEnergy ? latestEnergy.powerKw?.toFixed(1) : (summary?.currentPowerKw?.toFixed(1) ?? "-")}
//             <span className="text-sm ml-1 text-gray-400">kW</span>
//           </div>
//           <div className="text-xs text-gray-500 mt-1">
//             위치: {latestEnergy?.location ?? summary?.location ?? "-"}
//           </div>
//         </div>

//         {/* 현재 전압 (V) */}
//         <div className="bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow">
//           <div className="text-xs text-gray-400 uppercase mb-1">전압</div>
//           <div className="text-2xl font-bold text-accent-blue">
//             {latestEnergy ? latestEnergy.voltage?.toFixed(1) : (summary?.currentVoltage?.toFixed(1) ?? "-")}
//             <span className="text-sm ml-1 text-gray-400">V</span>
//           </div>
//           <div className="text-xs text-gray-500 mt-1">
//             전류: {latestEnergy?.currentA?.toFixed(1) ?? "-"} A
//           </div>
//         </div>

//         {/* 역률 (Power Factor) */}
//         <div className="bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow">
//           <div className="text-xs text-gray-400 uppercase mb-1">역률</div>
//           <div className={`text-2xl font-bold ${powerFactorColor(latestEnergy?.powerFactor ?? summary?.currentPowerFactor)}`}>
//             {latestEnergy ? (latestEnergy.powerFactor * 100)?.toFixed(1) : ((summary?.currentPowerFactor ?? 0) * 100)?.toFixed(1)}
//             <span className="text-sm ml-1 text-gray-400">%</span>
//           </div>
//           {/* 역률 상태 평가 */}
//           <div className="text-xs mt-1">
//             {(latestEnergy?.powerFactor ?? summary?.currentPowerFactor ?? 0) >= 0.95
//               ? <span className="text-green-400">양호</span>
//               : (latestEnergy?.powerFactor ?? summary?.currentPowerFactor ?? 0) >= 0.85
//               ? <span className="text-yellow-400">주의</span>
//               : <span className="text-red-400">위험 - 콘덴서 점검</span>
//             }
//           </div>
//         </div>

//         {/* 누적 전력량 및 예상 요금 */}
//         <div className="bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow">
//           <div className="text-xs text-gray-400 uppercase mb-1">누적 전력량</div>
//           <div className="text-2xl font-bold text-green-400">
//             {latestEnergy ? latestEnergy.energyKwh?.toFixed(1) : (summary?.currentEnergyKwh?.toFixed(1) ?? "-")}
//             <span className="text-sm ml-1 text-gray-400">kWh</span>
//           </div>
//           {/* 예상 전기요금 (한전 산업용(갑) 115원/kWh 기준) */}
//           <div className="text-xs text-gray-500 mt-1">
//             예상: {formatKrw(summary?.estimatedCost)}
//           </div>
//         </div>

//         {/* 미해결 알람 수 */}
//         <div className="bg-space-800/80 border border-space-700 rounded-2xl p-4 shadow">
//           <div className="text-xs text-gray-400 uppercase mb-1">미해결 알람</div>
//           <div className={`text-2xl font-bold ${alerts.length > 0 ? "text-red-400" : "text-green-400"}`}>
//             {summary?.activeAlertCount ?? alerts.length}
//             <span className="text-sm ml-1 text-gray-400">건</span>
//           </div>
//           <div className="text-xs mt-1">
//             {alerts.filter(a => a.severity === "CRITICAL").length > 0
//               ? <span className="text-red-400">CRITICAL {alerts.filter(a => a.severity === "CRITICAL").length}건</span>
//               : <span className="text-green-400">위험 없음</span>
//             }
//           </div>
//         </div>
//       </div>

//       {/* ============================================================
//           차트 영역 (탭으로 전환)
//           ============================================================ */}
//       <Card
//         title="에너지 추이"
//         right={
//           <div className="flex gap-1">
//             {/* 차트 탭 전환 버튼 */}
//             {[
//               { key: "realtime", label: "실시간" },
//               { key: "hourly",   label: "시간별" },
//               { key: "daily",    label: "일별"   },
//             ].map(tab => (
//               <button
//                 key={tab.key}
//                 onClick={() => setChartTab(tab.key)}
//                 className={`px-2 py-0.5 text-xs border rounded-md transition ${
//                   chartTab === tab.key
//                     ? "bg-blue-900/60 text-blue-300 border-blue-600/60"
//                     : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700"
//                 }`}
//               >
//                 {tab.label}
//               </button>
//             ))}
//           </div>
//         }
//         className="h-80"
//       >
//         <div className="h-56">
//           <ResponsiveContainer width="100%" height="100%">

//             {/* 실시간 전력 추이 (WebSocket 수신 데이터) */}
//             {chartTab === "realtime" ? (
//               <LineChart data={energyHistory.slice(-50)}>
//                 <CartesianGrid strokeDasharray="3 3" stroke="#263246" />
//                 <XAxis dataKey="timestamp" hide />
//                 <YAxis stroke="#9ca3af" />
//                 <Tooltip
//                   contentStyle={{ background: "#0f1422", border: "1px solid #232c45", borderRadius: "10px", color: "#e5e7eb" }}
//                 />
//                 <Legend />
//                 {/* 소비 전력 (kW) 라인 */}
//                 <Line type="monotone" dataKey="powerKw" name="전력 (kW)" stroke="#fb923c" dot={false} strokeWidth={2} isAnimationActive={false} />
//                 {/* 역률 라인 (우측 Y축 별도 스케일이 필요하나 단순화) */}
//                 <Line type="monotone" dataKey="powerFactor" name="역률" stroke="#60a5fa" dot={false} strokeWidth={2} isAnimationActive={false} />
//               </LineChart>

//             ) : chartTab === "hourly" ? (
//               /* 시간별 평균/피크 전력 막대 차트 */
//               <BarChart data={hourlyTrend}>
//                 <CartesianGrid strokeDasharray="3 3" stroke="#263246" />
//                 <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#9ca3af" }} />
//                 <YAxis stroke="#9ca3af" />
//                 <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid #232c45", borderRadius: "10px", color: "#e5e7eb" }} />
//                 <Legend />
//                 <Bar dataKey="avgPowerKw" name="평균 전력 (kW)" fill="#60a5fa" />
//                 <Bar dataKey="peakPowerKw" name="최대 전력 (kW)" fill="#fb923c" />
//               </BarChart>

//             ) : (
//               /* 일별 에너지 합계 막대 차트 */
//               <BarChart data={dailySummary}>
//                 <CartesianGrid strokeDasharray="3 3" stroke="#263246" />
//                 <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9ca3af" }} />
//                 <YAxis stroke="#9ca3af" />
//                 <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid #232c45", borderRadius: "10px", color: "#e5e7eb" }} />
//                 <Legend />
//                 <Bar dataKey="dailyEnergyKwh" name="일 전력량 (kWh)" fill="#34d399" />
//               </BarChart>
//             )}
//           </ResponsiveContainer>
//         </div>
//       </Card>

//       {/* ============================================================
//           하단 3단 레이아웃: 구역별 현황 | 알람 패널 | 임계값 목록
//           ============================================================ */}
//       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

//         {/* ---- 구역별 에너지 소비 (파이 차트) ---- */}
//         <Card title="구역별 에너지 소비">
//           {zoneData && zoneData.length > 0 ? (
//             <>
//               {/* 파이 차트로 구역 비중 시각화 */}
//               <ResponsiveContainer width="100%" height={160}>
//                 <PieChart>
//                   <Pie
//                     data={zoneData}
//                     dataKey="avgPowerKw"
//                     nameKey="zone"
//                     cx="50%"
//                     cy="50%"
//                     outerRadius={60}
//                     label={({ zone, percent }) => `${zone || "기타"} ${(percent * 100).toFixed(0)}%`}
//                     labelLine={false}
//                   >
//                     {zoneData.map((_, idx) => (
//                       <Cell key={idx} fill={ZONE_COLORS[idx % ZONE_COLORS.length]} />
//                     ))}
//                   </Pie>
//                   <Tooltip contentStyle={{ background: "#0f1422", border: "1px solid #232c45", borderRadius: "8px", color: "#e5e7eb" }} />
//                 </PieChart>
//               </ResponsiveContainer>
//               {/* 구역별 상세 수치 목록 */}
//               <div className="space-y-1 mt-2">
//                 {zoneData.map((z, i) => (
//                   <div key={i} className="flex justify-between text-xs text-gray-300">
//                     <span style={{ color: ZONE_COLORS[i % ZONE_COLORS.length] }}>
//                       ■ {z.zone || "기타"} ({z.location})
//                     </span>
//                     <span>{z.avgPowerKw} kW</span>
//                   </div>
//                 ))}
//               </div>
//             </>
//           ) : (
//             <div className="text-gray-500 text-sm text-center py-8">
//               구역 데이터 없음<br />
//               <span className="text-xs">에너지 데이터 수신 후 표시됩니다</span>
//             </div>
//           )}
//         </Card>

//         {/* ---- 알람 패널 ---- */}
//         <Card
//           title="알람 현황"
//           right={<Chip color={alerts.length > 0 ? "red" : "green"}>{alerts.length}건</Chip>}
//         >
//           <div className="space-y-2 max-h-64 overflow-auto">
//             {alerts.length > 0 ? (
//               alerts.map((alert, i) => (
//                 <div
//                   key={alert.id ?? i}
//                   className={`border rounded-lg px-3 py-2 ${alertColor(alert.severity)}`}
//                 >
//                   <div className="flex justify-between items-start gap-2">
//                     <div className="flex-1">
//                       {/* 심각도 배지 */}
//                       <span className="text-xs font-bold mr-1">[{alert.severity}]</span>
//                       {/* 알람 메시지 */}
//                       <span className="text-xs">{alert.message}</span>
//                     </div>
//                     {/* 알람 해결 처리 버튼 */}
//                     {alert.id && (
//                       <button
//                         onClick={() => resolveAlert(alert.id)}
//                         className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 shrink-0"
//                       >
//                         해결
//                       </button>
//                     )}
//                   </div>
//                   {/* 알람 발생 시각 */}
//                   <div className="text-xs opacity-60 mt-0.5">{alert.timestamp}</div>
//                 </div>
//               ))
//             ) : (
//               <div className="text-gray-500 text-sm text-center py-8">
//                 미해결 알람 없음 ✓
//               </div>
//             )}
//           </div>
//         </Card>

//         {/* ---- 임계값 목록 및 관리 ---- */}
//         <Card
//           title="임계값 설정"
//           right={
//             <button
//               onClick={() => setShowThresholdModal(true)}
//               className="text-xs px-2 py-0.5 rounded-md bg-blue-900/40 text-blue-300 border border-blue-600/40 hover:bg-blue-900/60"
//             >
//               + 추가
//             </button>
//           }
//         >
//           <div className="space-y-2 max-h-64 overflow-auto">
//             {thresholds.length > 0 ? (
//               thresholds.map((t, i) => (
//                 <div key={i} className="flex justify-between items-center bg-space-700/50 border border-space-600 rounded-lg px-3 py-2">
//                   <div>
//                     {/* 임계값 유형과 적용 위치 */}
//                     <div className="text-xs text-gray-300 font-medium">{t.thresholdType}</div>
//                     <div className="text-xs text-gray-500">{t.location || "전체 적용"}</div>
//                   </div>
//                   {/* 임계값 수치 */}
//                   <div className="text-sm font-bold text-accent-orange">{t.thresholdValue}</div>
//                 </div>
//               ))
//             ) : (
//               <div className="text-gray-500 text-sm text-center py-6">
//                 설정된 임계값 없음<br />
//                 <span className="text-xs">+ 추가 버튼으로 설정하세요</span>
//               </div>
//             )}
//           </div>
//         </Card>
//       </div>

//       {/* ============================================================
//           테스트 데이터 전송 패널 (개발/테스트 환경용)
//           MQTT 없이 REST로 에너지 데이터를 직접 입력할 때 사용
//           ============================================================ */}
//       <Card title="테스트 데이터 전송 (개발용)">
//         <div className="text-xs text-gray-400 mb-3">
//           MQTT 연결 없이 REST API로 에너지 데이터를 직접 입력할 수 있습니다.
//           실제 운영 환경에서는 MQTT 브로커를 통해 자동으로 수신됩니다.
//         </div>
//         <button
//           onClick={() => {
//             // 랜덤 테스트 데이터 생성 및 전송
//             sendEnergyData({
//               location: "B동 3층",
//               zone: "HVAC",
//               powerKw: (Math.random() * 40 + 10).toFixed(1),     // 10~50 kW 랜덤
//               voltage: (Math.random() * 10 + 215).toFixed(1),    // 215~225 V 랜덤
//               currentA: (Math.random() * 50 + 50).toFixed(1),    // 50~100 A 랜덤
//               powerFactor: (Math.random() * 0.15 + 0.82).toFixed(2), // 0.82~0.97 랜덤
//               energyKwh: (Math.random() * 100 + 50).toFixed(1),  // 50~150 kWh 랜덤
//             });
//           }}
//           className="px-4 py-2 rounded-lg bg-space-700 text-gray-200 border border-space-600 hover:bg-space-600 transition text-sm"
//         >
//           랜덤 데이터 전송
//         </button>
//         <button
//           onClick={() => {
//             // 임계값 초과 데이터 전송 (알람 테스트용)
//             sendEnergyData({
//               location: "B동 3층",
//               zone: "콘센트",
//               powerKw: 65.0,      // 기본 임계값(50kW) 초과 → OVER_POWER CRITICAL 알람
//               voltage: 250.0,     // 기본 임계값(240V) 초과 → HIGH_VOLTAGE CRITICAL 알람
//               currentA: 130.0,
//               powerFactor: 0.72,  // 기본 임계값(0.85) 미만 → LOW_POWER_FACTOR WARNING 알람
//               energyKwh: 200.0,
//             });
//           }}
//           className="ml-2 px-4 py-2 rounded-lg bg-red-900/40 text-red-300 border border-red-600/40 hover:bg-red-900/60 transition text-sm"
//         >
//           알람 테스트 (임계값 초과 데이터)
//         </button>
//       </Card>
//     </div>
//   );
// }
