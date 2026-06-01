/**
 * MobileGpsSender.js
 *
 * 모바일 브라우저에서 RTK-GPS + 기울기 센서를 모사하여
 * Spring 서버(/app/excavator/gps)로 실시간 전송하는 컴포넌트.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { useT } from '../../i18n/LanguageContext';

// ── WebSocket URL ───────────────────────────────────────────────────────────
function buildWsUrl() {
  if (process.env.REACT_APP_API_URL) {
    return `${process.env.REACT_APP_API_URL.replace(/\/$/, '')}/ws/sensor`;
  }
  if (process.env.NODE_ENV === 'development') {
    return `${window.location.protocol}//${window.location.hostname}:8080/ws/sensor`;
  }
  return `${window.location.origin}/ws/sensor`;
}

const STATUS_KEYS = {
  idle:       'statusIdle',
  checking:   'statusChecking',
  requesting: 'statusRequesting',
  connecting: 'statusConnecting',
  active:     'statusActive',
  error:      'statusError',
};
const STATUS_COLOR = {
  idle:       '#8896a4',
  checking:   '#a78bfa',
  requesting: '#facc15',
  connecting: '#facc15',
  active:     '#4ade80',
  error:      '#f87171',
};

function DataRow({ label, value, color = '#e2e8f0' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '10px' }}>
      <span style={{ color: '#8896a4' }}>{label}</span>
      <span style={{ color, fontFamily: 'monospace', fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  );
}

function accuracyColor(acc) {
  if (acc == null) return '#8896a4';
  if (acc < 5)  return '#4ade80';
  if (acc < 20) return '#facc15';
  return '#f87171';
}

// ═══════════════════════════════════════════════════════════════════════════
export default function MobileGpsSender() {
  const t = useT('gpsControl');
  const [status,      setStatus]      = useState('idle');
  const [geoData,     setGeoData]     = useState(null);
  const [imuData,     setImuData]     = useState(null);
  const [geoAccuracy, setGeoAccuracy] = useState(null);
  const [txCount,     setTxCount]     = useState(0);
  const [txHz,        setTxHz]        = useState(0);
  const [errorMsg,    setErrorMsg]    = useState('');
  const [permState,   setPermState]   = useState(null); // 'granted'|'prompt'|'denied'|null

  const stompRef     = useRef(null);
  const watchIdRef   = useRef(null);
  const imuHandlerR  = useRef(null);
  const geoRef       = useRef(null);
  const imuRef       = useRef(null);
  const txCountRef   = useRef(0);
  const hzTimerR     = useRef(null);
  const sendTimerR   = useRef(null);
  const wsTimeoutR   = useRef(null);   // WebSocket 연결 타임아웃
  const permWatchR   = useRef(null);   // Permissions API 변경 감지

  const isActive  = status === 'active';
  const isRunning = stompRef.current != null || watchIdRef.current != null;

  // ── 권한 상태 조회 (앱 마운트 시 + 권한 변경 시) ─────────────────────────
  useEffect(() => {
    if (!navigator.permissions) return;
    navigator.permissions.query({ name: 'geolocation' })
      .then(result => {
        setPermState(result.state);
        // 권한 변경 실시간 감지 (설정 창에서 허용하면 자동 반영)
        const onChange = () => setPermState(result.state);
        result.addEventListener('change', onChange);
        permWatchR.current = () => result.removeEventListener('change', onChange);
      })
      .catch(() => {});
    return () => { if (permWatchR.current) permWatchR.current(); };
  }, []);

  // ── 전체 자원 해제 ────────────────────────────────────────────────────
  const stopAll = useCallback((nextStatus = 'idle') => {
    clearTimeout(wsTimeoutR.current);
    clearInterval(sendTimerR.current);
    clearInterval(hzTimerR.current);

    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (imuHandlerR.current) {
      window.removeEventListener('deviceorientation', imuHandlerR.current, true);
      imuHandlerR.current = null;
    }
    if (stompRef.current) {
      stompRef.current.deactivate();
      stompRef.current = null;
    }

    geoRef.current = null;
    imuRef.current = null;
    setStatus(nextStatus);
    setTxHz(0);
  }, []);

  // ── 오류로 중단 ───────────────────────────────────────────────────────
  const failWith = useCallback((msg) => {
    stopAll('error');
    setErrorMsg(msg);
  }, [stopAll]);

  // ── 시작 ─────────────────────────────────────────────────────────────
  const startAll = useCallback(async () => {
    setErrorMsg('');
    setStatus('checking');

    // ① 보안 컨텍스트 확인 (HTTPS or localhost)
    if (!window.isSecureContext) {
      failWith(t('errInsecureContext'));
      return;
    }

    // ② Geolocation 지원 확인
    if (!('geolocation' in navigator)) {
      failWith(t('errNoGeolocation'));
      return;
    }

    // ③ 권한 사전 확인 (Permissions API)
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        setPermState(result.state);
        if (result.state === 'denied') {
          failWith(t('errPermDenied'));
          return;
        }
      } catch (_) { /* Permissions API 미지원 시 무시 */ }
    }

    // ④ iOS 13+ — DeviceOrientationEvent 권한 (user gesture 내에서 호출)
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        setStatus('requesting');
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          failWith(t('errImuDenied'));
          return;
        }
      } catch (e) {
        failWith(t('errImuFail', { msg: e.message }));
        return;
      }
    }

    setStatus('requesting');

    // ⑤ GPS watchPosition 시작 (이 시점에 권한 다이얼로그가 뜸)
    let gpsGranted = false;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed, accuracy } = pos.coords;
        const d = { lat: latitude, lng: longitude, heading: heading ?? null, speed: speed ?? null };
        geoRef.current = d;
        setGeoData(d);
        setGeoAccuracy(accuracy != null ? Math.round(accuracy) : null);
        setPermState('granted');

        // 첫 GPS 성공 → WebSocket 연결 시작
        if (!gpsGranted) {
          gpsGranted = true;
          connectWebSocket();
        }
      },
      (err) => {
        const msgs = {
          1: t('errGps1'),
          2: t('errGps2'),
          3: t('errGps3'),
        };
        failWith(msgs[err.code] || t('errGpsUnknown', { code: err.code, msg: err.message }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );

    // ⑥ DeviceOrientation 이벤트 등록
    const handler = (e) => {
      const d = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
      imuRef.current = d;
      setImuData(d);
    };
    imuHandlerR.current = handler;
    window.addEventListener('deviceorientation', handler, true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failWith]);

  // ── WebSocket 연결 (GPS 권한 승인 후 호출) ────────────────────────────
  const connectWebSocket = useCallback(() => {
    setStatus('connecting');

    // 15초 내에 연결 안 되면 오류 처리
    wsTimeoutR.current = setTimeout(() => {
      if (stompRef.current && !stompRef.current.connected) {
        failWith(t('errWsTimeout', { url: buildWsUrl() }));
      }
    }, 15000);

    const client = new Client({
      webSocketFactory: () => new SockJS(buildWsUrl()),
      reconnectDelay: 0,   // 자동 재연결 비활성화 (오류 시 명확히 표시)

      onConnect: () => {
        clearTimeout(wsTimeoutR.current);

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
          } catch (_) {}
        }, 100);

        setStatus('active');
      },

      onDisconnect: () => {
        clearInterval(sendTimerR.current);
        if (status === 'active') {
          failWith(t('errWsDisconnect'));
        }
      },

      onWebSocketError: () => {
        clearTimeout(wsTimeoutR.current);
        failWith(t('errWsFail', { url: buildWsUrl() }));
      },

      onStompError: (frame) => {
        clearTimeout(wsTimeoutR.current);
        failWith(t('errStomp', { msg: frame.headers?.message || t('errStompUnknown') }));
      },
    });

    client.activate();
    stompRef.current = client;

    hzTimerR.current = setInterval(() => {
      setTxHz(txCountRef.current);
      txCountRef.current = 0;
    }, 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failWith]);

  // 언마운트 정리
  useEffect(() => () => stopAll(), [stopAll]);

  const sc = '#8896a4', ag = '#4ade80', ar = '#f87171', ab = '#60a5fa', ap = '#a78bfa';
  const stColor = STATUS_COLOR[status];
  const stLabel = t(STATUS_KEYS[status]);

  // 버튼: 실행 중이면(연결 중 포함) Stop 표시 및 활성화, 권한 요청 중만 비활성화
  const showStop  = isRunning || status === 'connecting';
  const btnDisabled = status === 'checking' || status === 'requesting';

  return (
    <div style={{
      background: isActive ? 'rgba(4,47,46,0.55)' : '#0d1b2a',
      border: `1.5px solid ${isActive ? '#4ade8055' : '#253347'}`,
      borderRadius: '14px',
      padding: '12px 14px',
      fontSize: '12px',
      transition: 'background 0.35s, border-color 0.35s',
    }}>

      {/* ── 헤더 ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: (isActive || errorMsg) ? '10px' : '0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ color: ap, fontWeight: 700, fontSize: '13px' }}>{t('title')}</span>
          <span style={{ color: stColor, fontWeight: 600, fontSize: '11px' }}>
            ● {stLabel}{isActive ? ` — ${txHz} Hz` : ''}
          </span>
        </div>

        <button
          onClick={showStop ? () => stopAll('idle') : startAll}
          disabled={btnDisabled}
          style={{
            background: showStop ? '#1a0808' : '#1a1040',
            border: `1.5px solid ${showStop ? '#ef4444' : '#7c3aed'}`,
            borderRadius: '22px',
            padding: '7px 22px',
            color: showStop ? ar : ap,
            fontWeight: 700,
            fontSize: '13px',
            cursor: btnDisabled ? 'not-allowed' : 'pointer',
            opacity: btnDisabled ? 0.55 : 1,
            transition: 'all 0.2s',
            minWidth: '88px',
            letterSpacing: '0.02em',
            boxShadow: showStop ? '0 0 8px #ef444430' : '0 0 8px #7c3aed30',
          }}
        >
          {showStop
            ? (isActive ? t('btnStop') : t('btnCancel'))
            : btnDisabled
              ? t('btnChecking')
              : t('btnStart')}
        </button>
      </div>

      {/* ── 권한 상태 배지 ── */}
      {permState && !isActive && status === 'idle' && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          fontSize: '10px', padding: '2px 8px', borderRadius: '8px', marginBottom: '6px',
          background: permState === 'granted' ? 'rgba(4,47,30,0.5)'
                    : permState === 'denied'  ? 'rgba(69,10,10,0.5)'
                    : 'rgba(69,56,0,0.5)',
          color: permState === 'granted' ? '#4ade80'
               : permState === 'denied'  ? '#f87171'
               : '#facc15',
          border: `1px solid ${permState === 'granted' ? '#4ade8030' : permState === 'denied' ? '#ef444430' : '#facc1530'}`,
        }}>
          {permState === 'granted' ? t('permGranted')
          : permState === 'denied'  ? t('permDenied')
          : t('permPrompt')}
        </div>
      )}

      {/* ── 오류 메시지 ── */}
      {errorMsg && (
        <div style={{
          color: ar, fontSize: '11px', lineHeight: 1.6,
          padding: '8px 11px', whiteSpace: 'pre-line',
          background: 'rgba(26,8,8,0.85)',
          border: '1px solid #ef444430',
          borderRadius: '9px',
          marginBottom: '8px',
        }}>
          <div style={{ fontWeight: 700, marginBottom: '3px' }}>{t('errorTitle')}</div>
          {errorMsg}
          {permState === 'denied' && (
            <div style={{
              marginTop: '8px', padding: '6px 8px', borderRadius: '6px',
              background: 'rgba(255,255,255,0.04)', color: '#facc15', fontSize: '10px',
            }}>
              {t('permHintTitle')}<br/>
              <strong>Android Chrome</strong>: {t('permHintAndroid').replace('Android Chrome: ', '')}<br/>
              <strong>iOS Safari</strong>: {t('permHintIos').replace('iOS Safari: ', '')}
            </div>
          )}
        </div>
      )}

      {/* ── 연결 중 안내 ── */}
      {status === 'connecting' && (
        <div style={{
          fontSize: '11px', color: '#facc15', lineHeight: 1.6,
          padding: '8px 11px',
          background: 'rgba(69,56,0,0.35)',
          border: '1px solid #facc1530',
          borderRadius: '9px',
          marginBottom: '8px',
        }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: '6px' }}>⏳</span>
          {t('connectingMsg')}<br/>
          <span style={{ fontSize: '10px', color: '#8896a4' }}>{t('connectingUrl')}{buildWsUrl()}</span>
        </div>
      )}

      {/* ── 활성 데이터 패널 ── */}
      {isActive && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>

            <div style={{
              flex: 1, background: 'rgba(10,42,40,0.85)',
              border: '1px solid #1a4a3a', borderRadius: '10px', padding: '9px 10px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ color: ag, fontSize: '10px', fontWeight: 700 }}>🌐 GPS</span>
                {geoAccuracy != null && (
                  <span style={{ color: accuracyColor(geoAccuracy), fontSize: '10px', fontWeight: 600,
                    background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: '8px' }}>
                    ±{geoAccuracy}m
                  </span>
                )}
              </div>
              {geoData ? (
                <>
                  <DataRow label={t('latitude')}  value={geoData.lat?.toFixed(7)} color="#e2e8f0" />
                  <DataRow label={t('longitude')} value={geoData.lng?.toFixed(7)} color="#e2e8f0" />
                  {geoData.heading != null
                    ? <DataRow label={t('heading')} value={`${geoData.heading.toFixed(1)}°`} color={ab} />
                    : <DataRow label={t('heading')} value={t('headingImu')} color={sc} />
                  }
                  {geoData.speed != null && (
                    <DataRow label={t('speed')} value={`${(geoData.speed * 3.6).toFixed(1)} km/h`} color={ap} />
                  )}
                </>
              ) : (
                <div style={{ color: '#facc15', fontSize: '10px', lineHeight: 1.6 }}>
                  {t('acquiringGps')}<br/>
                  <span style={{ color: sc }}>{t('moveOutdoors')}</span>
                </div>
              )}
            </div>

            <div style={{
              flex: 1, background: 'rgba(10,26,46,0.85)',
              border: '1px solid #1a3a5f', borderRadius: '10px', padding: '9px 10px',
            }}>
              <div style={{ color: ab, fontSize: '10px', fontWeight: 700, marginBottom: '6px' }}>{t('imuTitle')}</div>
              {imuData ? (
                <>
                  <DataRow label="α Yaw"   value={`${imuData.alpha?.toFixed(1)}°`} color="#e2e8f0" />
                  <DataRow label="β Pitch" value={`${imuData.beta?.toFixed(1)}°`}  color={ab} />
                  <DataRow label="γ Roll"  value={`${imuData.gamma?.toFixed(1)}°`} color={ap} />
                  <div style={{ marginTop: '6px', fontSize: '9px', color: sc }}>
                    {t('imuHint')}
                  </div>
                </>
              ) : (
                <div style={{ color: '#facc15', fontSize: '10px' }}>{t('imuReceiving')}</div>
              )}
            </div>
          </div>

          <div style={{
            background: 'rgba(13,27,42,0.9)', border: '1px solid #1a3a5f',
            borderRadius: '10px', padding: '8px 12px',
            display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          }}>
            <StatChip label={t('txRate')}       value={`${txHz} Hz`}           color={ag} />
            <div style={{ width: '1px', height: '28px', background: '#1a3a5f' }} />
            <StatChip label={t('totalPackets')} value={txCount.toLocaleString()} color="#e2e8f0" />
            <div style={{ width: '1px', height: '28px', background: '#1a3a5f' }} />
            <StatChip label={t('route')}        value="/app/excavator/gps"       color={ab} mono />
          </div>

          <div style={{
            fontSize: '10px', color: sc, lineHeight: 1.6,
            padding: '6px 10px', background: 'rgba(26,16,64,0.6)',
            border: '1px solid #7c3aed22', borderRadius: '8px',
          }}>
            {t('activeHint')}
          </div>
        </div>
      )}

      {/* ── 대기 중 안내 ── */}
      {status === 'idle' && (
        <div style={{ marginTop: '6px', fontSize: '10px', lineHeight: 1.6, color: sc }}>
          {t('idleHint')}
          {!window.isSecureContext && (
            <div style={{
              marginTop: '8px', padding: '7px 10px', borderRadius: '8px',
              background: 'rgba(120,40,0,0.35)', border: '1px solid #f59e0b55',
              color: '#fbbf24', lineHeight: 1.7,
            }}>
              {t('httpsRequired')}<br/>
              {t('httpsRequiredDesc')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color, mono }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#8896a4', fontSize: '9px', marginBottom: '2px' }}>{label}</div>
      <div style={{ color, fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 700, fontSize: mono ? '9px' : '12px' }}>
        {value}
      </div>
    </div>
  );
}
