import { useEffect, useRef, useState, useCallback } from "react";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";
import AxiosCustom, { WS_BASE } from "../../axios/AxiosCustom";

const API_BASE = `/api/ems`;
const SOCKET_URL = `${WS_BASE}/ws/sensor`;

/**
 * EMS(에너지 관리 시스템) 데이터 훅
 *
 * 제공하는 상태:
 *  - latestEnergy   : 최신 에너지 계측 데이터 (powerKw, voltage, powerFactor 등)
 *  - energyHistory  : 에너지 계측 이력 배열 (시계열 차트용)
 *  - alerts         : 미해결 알람 목록
 *  - newAlert       : 실시간으로 들어온 신규 알람 (WebSocket)
 *  - zoneData       : 구역별 에너지 소비 현황
 *  - summary        : EMS 전체 요약 데이터 (현재 전력, 요금, 알람 수 등)
 *  - hourlyTrend    : 시간별 에너지 추이 (24시간)
 *  - dailySummary   : 일별 에너지 요약 (30일)
 *  - thresholds     : 현재 설정된 임계값 목록
 *  - connected      : WebSocket 연결 상태
 *
 * 제공하는 함수:
 *  - resolveAlert(id)         : 알람 해결 처리
 *  - setThreshold(data)       : 임계값 설정/변경
 *  - sendEnergyData(data)     : REST로 에너지 데이터 직접 전송 (테스트용)
 *  - refreshAll()             : 모든 데이터 새로고침
 */
export default function EmsAPI() {
  const clientRef = useRef(null);

  // 실시간 에너지 계측 데이터 (WebSocket으로 갱신)
  const [latestEnergy, setLatestEnergy] = useState(null);
  // 에너지 계측 이력 (시계열 차트용, 최대 100건)
  const [energyHistory, setEnergyHistory] = useState([]);
  // 미해결 알람 목록
  const [alerts, setAlerts] = useState([]);
  // 실시간으로 도착한 신규 알람 (WebSocket 수신)
  const [newAlert, setNewAlert] = useState(null);
  // 구역별 에너지 소비 현황
  const [zoneData, setZoneData] = useState([]);
  // EMS 대시보드 전체 요약
  const [summary, setSummary] = useState(null);
  // 시간별 에너지 추이
  const [hourlyTrend, setHourlyTrend] = useState([]);
  // 일별 에너지 요약
  const [dailySummary, setDailySummary] = useState([]);
  // 임계값 목록
  const [thresholds, setThresholds] = useState([]);
  // WebSocket 연결 상태
  const [connected, setConnected] = useState(false);

  /**
   * REST API로 EMS 요약 데이터 조회
   * 현재 전력, 누적 kWh, 예상 요금, 알람 수, 구역별 현황 포함
   */
  const fetchSummary = useCallback(async () => {
    try {
      const res = await AxiosCustom.get(`${API_BASE}/summary`);
      setSummary(res.data);
      if (res.data.activeAlerts) setAlerts(res.data.activeAlerts);
      if (res.data.zoneData) setZoneData(res.data.zoneData);
    } catch (e) {
      console.error("EMS 요약 데이터 조회 실패:", e);
    }
  }, []);

  /**
   * REST API로 에너지 이력 데이터 조회
   * 초기 로드 시 차트에 표시할 과거 데이터 확보
   */
  const fetchHistory = useCallback(async () => {
    try {
      const res = await AxiosCustom.get(`${API_BASE}/logs`);
      // 시계열 차트를 위해 오래된 순서로 정렬
      setEnergyHistory(res.data.reverse());
    } catch (e) {
      console.error("EMS 이력 데이터 조회 실패:", e);
    }
  }, []);

  /**
   * REST API로 시간별 에너지 추이 조회 (최근 24시간)
   */
  const fetchHourlyTrend = useCallback(async () => {
    try {
      const res = await AxiosCustom.get(`${API_BASE}/trend/hourly`);
      setHourlyTrend(res.data);
    } catch (e) {
      console.error("시간별 추이 조회 실패:", e);
    }
  }, []);

  /**
   * REST API로 일별 에너지 요약 조회 (최근 30일)
   */
  const fetchDailySummary = useCallback(async () => {
    try {
      const res = await AxiosCustom.get(`${API_BASE}/trend/daily`);
      setDailySummary(res.data);
    } catch (e) {
      console.error("일별 요약 조회 실패:", e);
    }
  }, []);

  /**
   * REST API로 임계값 목록 조회
   */
  const fetchThresholds = useCallback(async () => {
    try {
      const res = await AxiosCustom.get(`${API_BASE}/threshold`);
      setThresholds(res.data);
    } catch (e) {
      console.error("임계값 조회 실패:", e);
    }
  }, []);

  /**
   * 모든 데이터 일괄 새로고침
   * 대시보드 수동 갱신 버튼 클릭 시 사용
   */
  const refreshAll = useCallback(() => {
    fetchSummary();
    fetchHistory();
    fetchHourlyTrend();
    fetchDailySummary();
    fetchThresholds();
  }, [fetchSummary, fetchHistory, fetchHourlyTrend, fetchDailySummary, fetchThresholds]);

  /**
   * 알람 해결 처리
   * @param {number} id 해결할 알람 ID
   */
  const resolveAlert = useCallback(async (id) => {
    try {
      await AxiosCustom.put(`${API_BASE}/alerts/${id}/resolve`);
      // UI에서 즉시 제거 (낙관적 업데이트)
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      console.error("알람 해결 처리 실패:", e);
    }
  }, []);

  /**
   * 임계값 설정/변경
   * @param {object} data { thresholdType, location, thresholdValue }
   */
  const setThreshold = useCallback(async (data) => {
    try {
      await AxiosCustom.post(`${API_BASE}/threshold`, data);
      fetchThresholds(); // 설정 후 목록 새로고침
    } catch (e) {
      console.error("임계값 설정 실패:", e);
    }
  }, [fetchThresholds]);

  /**
   * REST API로 에너지 데이터 직접 전송 (테스트용)
   * MQTT 없이 에너지 데이터를 수동으로 입력할 때 사용
   * @param {object} data EmsDTO 구조 객체
   */
  const sendEnergyData = useCallback(async (data) => {
    try {
      await AxiosCustom.post(`${API_BASE}/data`, data);
    } catch (e) {
      console.error("에너지 데이터 전송 실패:", e);
    }
  }, []);

  /**
   * WebSocket 연결 설정
   * - /topic/ems       : 실시간 에너지 계측 데이터 수신
   * - /topic/ems-alert : 실시간 알람 수신
   */
  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(SOCKET_URL),
      reconnectDelay: 5000, // 5초마다 자동 재연결
      onConnect: () => {
        setConnected(true);
        console.log("EMS WebSocket 연결됨");

        // 실시간 에너지 계측 데이터 구독
        client.subscribe("/topic/ems", (msg) => {
          try {
            const data = JSON.parse(msg.body);
            setLatestEnergy(data);
            // 이력 배열에 추가 (최대 100건 유지)
            setEnergyHistory(prev => {
              const updated = [...prev, data];
              return updated.length > 100 ? updated.slice(-100) : updated;
            });
          } catch (e) {
            console.error("EMS 데이터 파싱 실패:", e);
          }
        });

        // 실시간 알람 수신 구독
        client.subscribe("/topic/ems-alert", (msg) => {
          try {
            const alert = JSON.parse(msg.body);
            setNewAlert(alert); // 팝업/토스트 알림용
            // 미해결 알람 목록에 추가
            setAlerts(prev => [alert, ...prev]);
          } catch (e) {
            console.error("EMS 알람 파싱 실패:", e);
          }
        });
      },
      onDisconnect: () => {
        setConnected(false);
        console.log("EMS WebSocket 연결 해제됨");
      },
    });

    client.activate();
    clientRef.current = client;

    // 컴포넌트 언마운트 시 WebSocket 연결 정리
    return () => {
      client.deactivate();
      clientRef.current = null;
    };
  }, []);

  // 컴포넌트 마운트 시 초기 데이터 로드
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return {
    latestEnergy,
    energyHistory,
    alerts,
    newAlert,
    zoneData,
    summary,
    hourlyTrend,
    dailySummary,
    thresholds,
    connected,
    resolveAlert,
    setThreshold,
    sendEnergyData,
    refreshAll,
  };
}
