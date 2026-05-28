/**
 * CrackMonitorContext.js
 *
 * 균열 감지(카메라 스트림 + 주기적 촬영 + 감지 API 호출)를 앱 전역 레벨에서 관리.
 * SafeDashboard 탭을 벗어나도 설정한 인터벌이 계속 동작한다.
 *
 *  ┌─────────────────────────────────────────────────────────┐
 *  │  CrackMonitorProvider (App.js 루트에 마운트, 항상 유지) │
 *  │    <video ref={hiddenVideoRef} style={{display:'none'}} │  ← 프레임 캡처용 숨김 비디오
 *  │    {children}                                           │
 *  └─────────────────────────────────────────────────────────┘
 *       ↑ useCrackMonitor() 으로 어디서든 접근 가능
 *
 * CrackMonitorPanel (SafeDashboard 안)은 이 Context를 소비하여
 * 표시용 <video>에 동일 스트림을 연결하고 상태를 렌더링한다.
 */

import React, {
  createContext, useCallback, useContext,
  useEffect, useRef, useState,
} from 'react';
import { pushAlert, pushWbsSuggest } from '../utils/alertStore';

const DETECT_SERVER_URL = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'development'
      ? `http://${window.location.hostname}:8080`
      : '');

const CrackMonitorCtx = createContext(null);

export function CrackMonitorProvider({ children }) {
  // ── 카메라 상태 ────────────────────────────────────────────
  const [streaming,   setStreaming]   = useState(false);
  const [camError,    setCamError]    = useState('');

  // ── 감지 상태 ──────────────────────────────────────────────
  const [capturing,   setCapturing]   = useState(false);
  const [crackLog,    setCrackLog]    = useState([]);   // 감지 이력

  // ── 자동 촬영 설정 ─────────────────────────────────────────
  const [autoRunning, setAutoRunning] = useState(false);
  const [intervalSec, setIntervalSec] = useState(0);   // 0 = 수동

  // ── 연결된 BIM 프로젝트 (알림 전송 시 사용) ─────────────────
  // SafeDashboard가 unmount 되어도 ref를 통해 항상 최신값 참조
  const selectedProjectRef = useRef(null);

  // ── DOM refs ───────────────────────────────────────────────
  const streamRef      = useRef(null);   // MediaStream (탭 이탈 후에도 유지)
  const hiddenVideoRef = useRef(null);   // 프레임 캡처용 숨김 <video>
  const autoTimerRef   = useRef(null);

  // ── 카메라 시작 ─────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamError('');
    if (streamRef.current) return;   // 이미 스트리밍 중
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('카메라를 사용하려면 HTTPS 또는 localhost가 필요합니다.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (hiddenVideoRef.current) {
        hiddenVideoRef.current.srcObject = stream;
        await hiddenVideoRef.current.play().catch(() => {});
      }
      setStreaming(true);
    } catch (e) {
      setCamError('카메라 오류: ' + e.message);
    }
  }, []);

  // ── 카메라 중지 ─────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    setAutoRunning(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (hiddenVideoRef.current) hiddenVideoRef.current.srcObject = null;
    setStreaming(false);
  }, []);

  // ── Blob → 감지 API 호출 ──────────────────────────────────
  const detectFromBlob = useCallback(async (blob, source) => {
    setCapturing(true);

    // 비교뷰 표시용으로 이미지를 data URL로 변환 (감지 전에 수행)
    let imageUrl = null;
    try {
      imageUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {}

    const form = new FormData();
    form.append('file', blob, 'capture.jpg');
    try {
      const res = await fetch(`${DETECT_SERVER_URL}/api/detection/crack`, {
        method: 'POST', body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const entry = {
        time:       new Date(),
        hasCrack:   !!data.hasCrack,
        confidence: data.confidence ?? 0,
        method:     data.method     ?? 'unknown',
        detail:     data.detail     ?? '',
        source,
        imageUrl,
        regions:    Array.isArray(data.regions) ? data.regions : [],
      };
      setCrackLog(prev => [entry, ...prev.slice(0, 49)]);

      if (data.hasCrack) {
        const conf = Math.round((data.confidence ?? 0) * 100);
        const proj = selectedProjectRef.current;
        pushAlert({
          source:      'CRACK',
          severity:    conf >= 70 ? 'HIGH' : 'MEDIUM',
          title:       `균열 감지 — ${proj?.projectName ?? ''}`,
          detail:      `신뢰도 ${conf}% (${data.method ?? 'unknown'}) · ${data.detail ?? ''}`.trim().replace(/·\s*$/, ''),
          projectId:   proj?.projectId   ?? '',
          projectName: proj?.projectName ?? '',
        });
        pushWbsSuggest({
          eventType:   'CRACK',
          source:      'BIM_CRACK',
          title:       `균열 감지 — 신뢰도 ${conf}%`,
          detail:      `${proj?.projectName ?? '현장'}에서 구조 균열이 감지되었습니다. 보수 공사 일정 추가가 필요합니다.`,
          projectId:   proj?.projectId   ?? '',
          projectName: proj?.projectName ?? '',
        });
      }
    } catch (e) {
      setCrackLog(prev => [{
        time:       new Date(),
        hasCrack:   false,
        confidence: 0,
        method:     'error',
        detail:     e.message,
        source,
        error:      true,
        imageUrl,
        regions:    [],
      }, ...prev.slice(0, 49)]);
    } finally {
      setCapturing(false);
    }
  }, []);

  // ── 숨김 비디오 프레임 캡처 → 감지 ──────────────────────────
  const captureFromCamera = useCallback(async () => {
    const video = hiddenVideoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    await detectFromBlob(blob, 'camera');
  }, [detectFromBlob]);

  // ── 자동 인터벌 관리 (탭 이탈 후에도 Context가 살아있어 지속됨) ──
  useEffect(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    if (autoRunning && intervalSec > 0) {
      autoTimerRef.current = setInterval(captureFromCamera, intervalSec * 1000);
    }
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [autoRunning, intervalSec, captureFromCamera]);

  // ── 앱 종료 시 스트림 정리 ─────────────────────────────────
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const value = {
    streaming, camError,
    capturing,
    autoRunning, setAutoRunning,
    intervalSec, setIntervalSec,
    crackLog, setCrackLog,
    streamRef,          // 표시용 <video>가 동일 스트림을 참조할 때 사용
    selectedProjectRef, // CrackMonitorPanel이 최신 프로젝트를 주입
    startCamera, stopCamera,
    captureFromCamera, detectFromBlob,
  };

  return (
    <CrackMonitorCtx.Provider value={value}>
      {/* 프레임 캡처 전용 숨김 비디오 — 항상 DOM에 유지 */}
      <video
        ref={hiddenVideoRef}
        autoPlay
        playsInline
        muted
        style={{ display: 'none', position: 'absolute', pointerEvents: 'none' }}
      />
      {children}
    </CrackMonitorCtx.Provider>
  );
}

/** CrackMonitorContext 소비 훅 */
export function useCrackMonitor() {
  return useContext(CrackMonitorCtx);
}
