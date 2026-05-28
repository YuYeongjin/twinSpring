/**
 * MobileGpsSender.js
 *
 * 모바일 브라우저에서 RTK-GPS + 기울기 센서를 모사하여
 * Spring 서버(/app/excavator/gps)로 실시간 전송하는 컴포넌트.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  이동 (RTK-GPS 모사) : Geolocation API watchPosition               │
 * │    → latitude / longitude / heading / speed / accuracy             │
 * │  굴착 각도 (기울기 센서) : DeviceOrientationEvent                   │
 * │    → alpha(yaw) / beta(pitch) / gamma(roll)                        │
 * │  전송 경로 : SockJS → STOMP → /app/excavator/gps → /topic/excavator│
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * iOS 13+ 에서는 DeviceOrientationEvent.requestPermission() 이 필요.
 * Start 버튼 클릭(user gesture)에서 호출하므로 정상 동작.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';

// ── WebSocket 엔드포인트 URL ────────────────────────────────────────────────
// 운영(DNS+HTTPS+nginx): window.location.origin/ws/sensor → nginx 프록시
// 개발: hostname:8080/ws/sensor (localhost·IP 접속 모두 대응)
function buildWsUrl() {
  if (process.env.REACT_APP_API_URL) {
    return `${process.env.REACT_APP_API_URL.replace(/\/$/, '')}/ws/sensor`;
  }
  if (process.env.NODE_ENV === 'development') {
    return `${window.location.protocol}//${window.location.hostname}:8080/ws/sensor`;
  }
  return `${window.location.origin}/ws/sensor`;
}

// ── 상태 라벨 / 색상 맵 ────────────────────────────────────────────────────
const STATUS_LABEL = {
  idle:       '대기 중',
  requesting: '권한 요청 중…',
  connecting: 'WebSocket 연결 중…',
  active:     '전송 중',
  error:      '오류',
};
const STATUS_COLOR = {
  idle:       '#8896a4',
  requesting: '#facc15',
  connecting: '#facc15',
  active:     '#4ade80',
  error:      '#f87171',
};

// ── 소형 데이터 행 ─────────────────────────────────────────────────────────
function DataRow({ label, value, color = '#e2e8f0' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '10px' }}>
      <span style={{ color: '#8896a4' }}>{label}</span>
      <span style={{ color, fontFamily: 'monospace', fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  );
}

// ── 정확도 → 색상 ───────────────────────────────────────────────────────────
function accuracyColor(acc) {
  if (acc == null) return '#8896a4';
  if (acc < 5)  return '#4ade80';
  if (acc < 20) return '#facc15';
  return '#f87171';
}

// ═══════════════════════════════════════════════════════════════════════════
export default function MobileGpsSender() {
  // ── 상태 ──────────────────────────────────────────────────────────────
  const [status,      setStatus]      = useState('idle');   // idle|requesting|connecting|active|error
  const [geoData,     setGeoData]     = useState(null);     // { lat, lng, heading, speed }
  const [imuData,     setImuData]     = useState(null);     // { alpha, beta, gamma }
  const [geoAccuracy, setGeoAccuracy] = useState(null);     // GPS 정확도 (m)
  const [txCount,     setTxCount]     = useState(0);        // 누적 전송 패킷 수
  const [txHz,        setTxHz]        = useState(0);        // 현재 전송 빈도 (Hz)
  const [errorMsg,    setErrorMsg]    = useState('');       // 오류 메시지

  // ── Refs ───────────────────────────────────────────────────────────────
  const stompRef    = useRef(null);   // STOMP Client
  const watchIdRef  = useRef(null);   // Geolocation watchId
  const imuHandlerR = useRef(null);   // DeviceOrientation 핸들러
  const geoRef      = useRef(null);   // 최신 GPS 데이터 (전송 루프용)
  const imuRef      = useRef(null);   // 최신 IMU 데이터 (전송 루프용)
  const txCountRef  = useRef(0);      // Hz 계산용 카운터
  const hzTimerR    = useRef(null);   // Hz 측정 인터벌
  const sendTimerR  = useRef(null);   // 100ms 전송 인터벌

  const isActive = status === 'active';

  // ── 전체 자원 해제 ────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    // Geolocation
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    // DeviceOrientation
    if (imuHandlerR.current) {
      window.removeEventListener('deviceorientation', imuHandlerR.current, true);
      imuHandlerR.current = null;
    }
    // 타이머
    clearInterval(sendTimerR.current);
    clearInterval(hzTimerR.current);
    // STOMP
    if (stompRef.current) {
      stompRef.current.deactivate();
      stompRef.current = null;
    }
    // 상태 초기화
    geoRef.current = null;
    imuRef.current = null;
    setStatus('idle');
    setTxHz(0);
  }, []);

  // ── 시작 ─────────────────────────────────────────────────────────────
  const startAll = useCallback(async () => {
    setErrorMsg('');
    setStatus('requesting');

    // ① iOS 13+ — DeviceOrientationEvent 권한 (user gesture 내에서 호출)
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          setErrorMsg('기울기 센서 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.');
          setStatus('error');
          return;
        }
      } catch (e) {
        setErrorMsg('센서 권한 요청 실패: ' + e.message);
        setStatus('error');
        return;
      }
    }

    // ② 보안 컨텍스트 확인 (HTTPS 또는 localhost 필수)
    if (!window.isSecureContext) {
      setErrorMsg(
        'GPS는 HTTPS 또는 localhost에서만 사용할 수 있습니다.\n' +
        '현재 HTTP(비보안)로 접속 중이어서 브라우저가 위치 권한을 자동 차단했습니다.\n\n' +
        '해결 방법:\n' +
        '① 서버에 HTTPS(SSL)를 적용하거나\n' +
        '② Chrome에서 chrome://flags → "Insecure origins treated as secure"에 이 주소를 추가하세요.'
      );
      setStatus('error');
      return;
    }

    // ③ Geolocation 지원 확인
    if (!('geolocation' in navigator)) {
      setErrorMsg('이 브라우저는 Geolocation을 지원하지 않습니다.');
      setStatus('error');
      return;
    }

    // ④ GPS watchPosition 시작
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed, accuracy } = pos.coords;
        const d = {
          lat:     latitude,
          lng:     longitude,
          heading: heading ?? null,
          speed:   speed   ?? null,
        };
        geoRef.current = d;
        setGeoData(d);
        setGeoAccuracy(accuracy != null ? Math.round(accuracy) : null);
      },
      (err) => {
        const msgs = {
          1: '위치 권한이 거부되었습니다.\n브라우저 설정 → 사이트 설정 → 위치에서 이 사이트를 허용해 주세요.',
          2: 'GPS 신호를 받을 수 없습니다. 실외로 이동하거나 잠시 후 다시 시도하세요.',
          3: 'GPS 응답 시간 초과. 실외에서 다시 시도해 주세요.',
        };
        setErrorMsg(msgs[err.code] || `GPS 오류 (코드 ${err.code}): ${err.message}`);
        setStatus('error');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    // ④ DeviceOrientation 이벤트 등록
    const handler = (e) => {
      const d = {
        alpha: e.alpha,  // yaw   0~360
        beta:  e.beta,   // pitch -180~180
        gamma: e.gamma,  // roll  -90~90
      };
      imuRef.current = d;
      setImuData(d);
    };
    imuHandlerR.current = handler;
    window.addEventListener('deviceorientation', handler, true);

    // ⑤ STOMP WebSocket 연결
    setStatus('connecting');

    const client = new Client({
      webSocketFactory: () => new SockJS(buildWsUrl()),
      reconnectDelay: 5000,

      onConnect: () => {
        // 100ms(10Hz)마다 현재 센서 값 publish
        sendTimerR.current = setInterval(() => {
          if (!geoRef.current && !imuRef.current) return;
          const body = JSON.stringify({
            lat:     geoRef.current?.lat     ?? null,
            lng:     geoRef.current?.lng     ?? null,
            heading: geoRef.current?.heading ?? null,
            speed:   geoRef.current?.speed   ?? null,
            alpha:   imuRef.current?.alpha   ?? null,
            beta:    imuRef.current?.beta    ?? null,
            gamma:   imuRef.current?.gamma   ?? null,
          });
          try {
            client.publish({ destination: '/app/excavator/gps', body });
            txCountRef.current++;
            setTxCount(c => c + 1);
          } catch (_) { /* STOMP 재연결 중 무시 */ }
        }, 100);

        setStatus('active');
      },

      onDisconnect: () => {
        clearInterval(sendTimerR.current);
        // 사용자가 명시적으로 Stop 누른 게 아니면 재연결 대기 표시
      },

      onStompError: (frame) => {
        const msg = frame.headers?.message || '알 수 없는 오류';
        setErrorMsg(`WebSocket STOMP 오류: ${msg}`);
        setStatus('error');
        clearInterval(sendTimerR.current);
      },
    });

    client.activate();
    stompRef.current = client;

    // Hz 측정 (1초 주기)
    hzTimerR.current = setInterval(() => {
      setTxHz(txCountRef.current);
      txCountRef.current = 0;
    }, 1000);
  }, []);

  // 언마운트 시 정리
  useEffect(() => () => stopAll(), [stopAll]);

  // ── 스타일 상수 ───────────────────────────────────────────────────────
  const sc  = '#8896a4';   // secondary color
  const ag  = '#4ade80';   // accent green
  const ar  = '#f87171';   // accent red
  const ab  = '#60a5fa';   // accent blue
  const ap  = '#a78bfa';   // accent purple

  const stColor = STATUS_COLOR[status];
  const stLabel = STATUS_LABEL[status];

  return (
    <div style={{
      background: isActive ? 'rgba(4,47,46,0.55)' : '#0d1b2a',
      border: `1.5px solid ${isActive ? '#4ade8055' : '#253347'}`,
      borderRadius: '14px',
      padding: '12px 14px',
      fontSize: '12px',
      transition: 'background 0.35s, border-color 0.35s',
    }}>

      {/* ── 헤더 행 ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: (isActive || errorMsg) ? '10px' : '0',
      }}>

        {/* 제목 + 상태 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ color: ap, fontWeight: 700, fontSize: '13px' }}>📡 모바일 GPS 제어</span>
          <span style={{ color: stColor, fontWeight: 600, fontSize: '11px' }}>
            ● {stLabel}{isActive ? ` — ${txHz} Hz` : ''}
          </span>
        </div>

        {/* Start / Stop 토글 버튼 */}
        <button
          onClick={isActive ? stopAll : startAll}
          disabled={status === 'requesting' || status === 'connecting'}
          style={{
            background: isActive ? '#1a0808' : '#1a1040',
            border: `1.5px solid ${isActive ? '#ef4444' : '#7c3aed'}`,
            borderRadius: '22px',
            padding: '7px 22px',
            color: isActive ? ar : ap,
            fontWeight: 700,
            fontSize: '13px',
            cursor: (status === 'requesting' || status === 'connecting') ? 'not-allowed' : 'pointer',
            opacity: (status === 'requesting' || status === 'connecting') ? 0.55 : 1,
            transition: 'all 0.2s',
            minWidth: '88px',
            letterSpacing: '0.02em',
            boxShadow: isActive
              ? '0 0 8px #ef444430'
              : '0 0 8px #7c3aed30',
          }}
        >
          {isActive
            ? '⏹ Stop'
            : (status === 'requesting' || status === 'connecting')
              ? '연결 중…'
              : '▶ Start'}
        </button>
      </div>

      {/* ── 오류 메시지 ── */}
      {errorMsg && (
        <div style={{
          color: ar, fontSize: '11px', lineHeight: 1.5,
          padding: '7px 10px',
          background: 'rgba(26,8,8,0.8)',
          border: '1px solid #ef444430',
          borderRadius: '8px',
          marginBottom: '6px',
        }}>
          ⚠ {errorMsg}
        </div>
      )}

      {/* ── 활성 상태 데이터 패널 ── */}
      {isActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* GPS + IMU 행 */}
          <div style={{ display: 'flex', gap: '8px' }}>

            {/* GPS 데이터 */}
            <div style={{
              flex: 1,
              background: 'rgba(10,42,40,0.85)',
              border: '1px solid #1a4a3a',
              borderRadius: '10px',
              padding: '9px 10px',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '6px',
              }}>
                <span style={{ color: ag, fontSize: '10px', fontWeight: 700 }}>🌐 GPS (RTK 모사)</span>
                {geoAccuracy != null && (
                  <span style={{
                    color: accuracyColor(geoAccuracy),
                    fontSize: '10px', fontWeight: 600,
                    background: 'rgba(0,0,0,0.3)',
                    padding: '1px 6px', borderRadius: '8px',
                  }}>
                    ±{geoAccuracy}m
                  </span>
                )}
              </div>

              {geoData ? (
                <>
                  <DataRow label="위도 (Lat)"  value={geoData.lat?.toFixed(7)}  color="#e2e8f0" />
                  <DataRow label="경도 (Lng)"  value={geoData.lng?.toFixed(7)}  color="#e2e8f0" />
                  {geoData.heading != null
                    ? <DataRow label="방위 (Hdg)"  value={`${geoData.heading.toFixed(1)}°`} color={ab} />
                    : <DataRow label="방위 (Hdg)"  value="(IMU alpha 사용)"                  color={sc} />
                  }
                  {geoData.speed != null && (
                    <DataRow label="속도"        value={`${(geoData.speed * 3.6).toFixed(1)} km/h`} color={ap} />
                  )}
                </>
              ) : (
                <div style={{ color: '#facc15', fontSize: '10px', lineHeight: 1.6 }}>
                  GPS 신호 획득 중…
                  <br/>
                  <span style={{ color: sc }}>실외로 이동하거나 잠시 기다려 주세요.</span>
                </div>
              )}
            </div>

            {/* IMU 데이터 */}
            <div style={{
              flex: 1,
              background: 'rgba(10,26,46,0.85)',
              border: '1px solid #1a3a5f',
              borderRadius: '10px',
              padding: '9px 10px',
            }}>
              <div style={{ color: ab, fontSize: '10px', fontWeight: 700, marginBottom: '6px' }}>
                🔄 IMU (기울기)
              </div>

              {imuData ? (
                <>
                  <DataRow label="α Yaw"   value={`${imuData.alpha?.toFixed(1)}°`} color="#e2e8f0" />
                  <DataRow label="β Pitch" value={`${imuData.beta?.toFixed(1)}°`}  color={ab} />
                  <DataRow label="γ Roll"  value={`${imuData.gamma?.toFixed(1)}°`} color={ap} />
                  <div style={{ marginTop: '6px', fontSize: '9px', color: sc, lineHeight: 1.5 }}>
                    α → 회전 · β → 붐 · γ → 선회
                  </div>
                </>
              ) : (
                <div style={{ color: '#facc15', fontSize: '10px', lineHeight: 1.6 }}>
                  센서 데이터 수신 중…
                  <br/>
                  <span style={{ color: sc }}>기기를 움직여 보세요.</span>
                </div>
              )}
            </div>
          </div>

          {/* 전송 통계 바 */}
          <div style={{
            background: 'rgba(13,27,42,0.9)',
            border: '1px solid #1a3a5f',
            borderRadius: '10px',
            padding: '8px 12px',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}>
            <StatChip label="전송 빈도" value={`${txHz} Hz`}    color={ag} />
            <div style={{ width: '1px', height: '28px', background: '#1a3a5f' }} />
            <StatChip label="총 패킷"   value={txCount.toLocaleString()} color="#e2e8f0" />
            <div style={{ width: '1px', height: '28px', background: '#1a3a5f' }} />
            <StatChip label="경로"      value="/app/excavator/gps" color={ab} mono />
          </div>

          {/* 안내 문구 */}
          <div style={{
            fontSize: '10px', color: sc, lineHeight: 1.6,
            padding: '6px 10px',
            background: 'rgba(26,16,64,0.6)',
            border: '1px solid #7c3aed22',
            borderRadius: '8px',
          }}>
            💡 이 기기를 기울이면 굴착기 관절이 반응합니다.
            이동하면 굴착기 위치가 실시간으로 변경됩니다.
            GPS 정확도가 낮을 경우 실내에서는 위치 변화가 없을 수 있습니다.
          </div>
        </div>
      )}

      {/* 대기 중 간략 안내 */}
      {status === 'idle' && (
        <div style={{ marginTop: '8px', fontSize: '10px', lineHeight: 1.6 }}>
          <div style={{ color: sc }}>
            Start 버튼을 누르면 GPS · 기울기 센서 권한을 요청하고
            WebSocket으로 굴착기를 실시간 제어합니다.
          </div>
          {!window.isSecureContext && (
            <div style={{
              marginTop: '8px', padding: '7px 10px', borderRadius: '8px',
              background: 'rgba(120,40,0,0.35)', border: '1px solid #f59e0b55',
              color: '#fbbf24', lineHeight: 1.7,
            }}>
              ⚠ <strong>HTTPS 필요</strong><br />
              현재 HTTP(비보안) 접속 중입니다. GPS는 HTTPS 또는 localhost에서만 동작합니다.
              Start를 눌러도 위치 권한 대화상자 없이 즉시 거부됩니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 통계 칩 ──────────────────────────────────────────────────────────────────
function StatChip({ label, value, color, mono }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#8896a4', fontSize: '9px', marginBottom: '2px' }}>{label}</div>
      <div style={{
        color,
        fontFamily: mono ? 'monospace' : 'inherit',
        fontWeight: 700,
        fontSize: mono ? '9px' : '12px',
      }}>
        {value}
      </div>
    </div>
  );
}
