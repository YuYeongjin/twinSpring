import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Html } from '@react-three/drei';
import * as THREE from 'three';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { WS_BASE } from '../../axios/AxiosCustom';
import { useT } from '../../i18n/LanguageContext';

const DETECT_SERVER_URL = process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : '';

const NO_HELMET_CLASSES = new Set(['no-hard-hat', 'no-helmet', 'no_hard_hat', 'no_helmet', 'person']);
const RESTRICTED_CLASSES = new Set(['restricted', 'prohibited', 'danger-zone', 'danger_zone', 'restricted-area']);
const PERSON_CLASSES = new Set(['person', 'people', 'man', 'woman', 'child', 'worker']);
const CAM_MIN_H = 200;
const CAM_MAX_H = 720;

function analyzeDetections(detections = []) {
  const noHelmet = detections.some(d => NO_HELMET_CLASSES.has((d.class ?? '').toLowerCase()));
  const restricted = detections.some(d => RESTRICTED_CLASSES.has((d.class ?? '').toLowerCase()));
  return { noHelmet, restricted, dangerous: noHelmet || restricted };
}

function buildSceneObjects(detections, imgW = 640, imgH = 480) {
  const SCENE_W = 14, SCENE_H = 9;
  return detections.map((det, i) => {
    const [x1 = 0, y1 = 0, x2 = 100, y2 = 200] = det.bbox || [];
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const sw = Math.max(((x2 - x1) / imgW) * SCENE_W, 0.4);
    const sh = Math.max(((y2 - y1) / imgH) * SCENE_H, 0.7);
    const px = (cx / imgW - 0.5) * SCENE_W;
    const pz = -(cy / imgH - 0.75) * 7;
    const cls = (det.class || '').toLowerCase();
    return {
      id: `obj-${i}-${Date.now()}`,
      cls: det.class || 'unknown',
      confidence: Math.round((det.confidence ?? 1) * 100),
      isPerson: PERSON_CLASSES.has(cls),
      isDanger: NO_HELMET_CLASSES.has(cls),
      position: [px, sh / 2, pz],
      size: [sw, sh, Math.max(sw * 0.55, 0.25)],
    };
  });
}

// ── 웹캠 패널 (컨테이너 없음 — 부모가 관리) ─────────────────────────

function WebcamPanel({ detectAvailable, checkDetectServer, onDetectResult, onError,
  makeCaptureRef, onStreamingChange, stopDetectRef }) {
  const t = useT('safe');
  const videoRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const [liveDetecting, setLiveDetecting] = useState(false);
  const [camError, setCamError] = useState('');
  const liveDetectingRef = useRef(false);

  const startCamera = useCallback(async () => {
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoRef.current) { videoRef.current.srcObject = stream; setStreaming(true); }
    } catch (e) { setCamError(t('cameraError') + e.message); }
  }, []);

  const stopCamera = useCallback(() => {
    liveDetectingRef.current = false;
    setLiveDetecting(false);
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  }, []);

  useEffect(() => { startCamera(); return () => stopCamera(); }, [startCamera, stopCamera]);
  useEffect(() => { onStreamingChange?.(streaming); }, [streaming, onStreamingChange]);
  useEffect(() => {
    if (!streaming) { liveDetectingRef.current = false; setLiveDetecting(false); }
  }, [streaming]);

  const captureOnce = useCallback(async () => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) return null;
    const imgW = videoRef.current.videoWidth;
    const imgH = videoRef.current.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = imgW; canvas.height = imgH;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
    const form = new FormData();
    form.append('file', blob, 'capture.jpg');
    const res = await fetch(`${DETECT_SERVER_URL}/api/detection/detect`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return { ...data, _imgW: imgW, _imgH: imgH };
  }, []);

  const stopLiveDetect = useCallback(() => {
    liveDetectingRef.current = false;
    setLiveDetecting(false);
  }, []);

  useEffect(() => { if (makeCaptureRef) makeCaptureRef.current = captureOnce; }, [makeCaptureRef, captureOnce]);
  useEffect(() => { if (stopDetectRef) stopDetectRef.current = stopLiveDetect; }, [stopDetectRef, stopLiveDetect]);

  const toggleLiveDetect = useCallback(async () => {
    if (liveDetectingRef.current) { liveDetectingRef.current = false; setLiveDetecting(false); return; }
    liveDetectingRef.current = true;
    setLiveDetecting(true);
    while (liveDetectingRef.current) {
      try {
        const data = await captureOnce();
        if (!data) await new Promise(r => setTimeout(r, 500));
        else { onDetectResult?.(data); await new Promise(r => setTimeout(r, 5000)); }
      } catch (e) {
        onError?.(t('detectionError') + e.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    setLiveDetecting(false);
  }, [captureOnce, onDetectResult, onError]);

  const canDetect = streaming;
  const serverColor = detectAvailable === true ? '#22c55e' : detectAvailable === false ? '#f87171' : '#6b7280';
  const serverLabel = detectAvailable === true ? t('online') : detectAvailable === false ? t('offline') : t('checking');

  return (
    <>
      {/* 헤더 */}
      <div className="px-4 py-2 border-b flex items-center gap-3 shrink-0 flex-wrap"
        style={{ borderColor: '#253347' }}>
        <span className="text-sm font-semibold text-gray-300">{t('webcamTitle')}</span>
        <span className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: streaming ? '#22c55e' : '#6b7280' }} />
        <span className="text-xs" style={{ color: streaming ? '#22c55e' : '#6b7280' }}>
          {streaming ? t('on') : t('off')}
        </span>
        {liveDetecting && (
          <span className="text-xs px-2 py-0.5 rounded-full animate-pulse"
            style={{ background: '#3a1a0a', border: '1px solid #f97316', color: '#f97316' }}>
            ● REC
          </span>
        )}
        <span className="text-xs px-2 py-0.5 rounded-full"
          style={{ background: '#0d1b2a', border: `1px solid ${serverColor}40`, color: serverColor }}>
          detect: {serverLabel}
        </span>
        {detectAvailable === false && (
          <button onClick={checkDetectServer} className="text-xs text-blue-400 hover:text-blue-300">{t('retry')}</button>
        )}
        <div className="ml-auto flex gap-2">
          {!streaming
            ? <button onClick={startCamera} className="text-xs px-3 py-1 rounded-lg"
              style={{ background: '#0d2a1a', border: '1px solid #22c55e', color: '#22c55e' }}>{t('startCamera')}</button>
            : <button onClick={stopCamera} className="text-xs px-3 py-1 rounded-lg"
              style={{ background: '#2a1010', border: '1px solid #ef4444', color: '#ef4444' }}>{t('stopCamera')}</button>
          }
          <button onClick={toggleLiveDetect} disabled={!canDetect}
            className="text-xs px-3 py-1 rounded-lg transition"
            style={{
              background: liveDetecting ? '#3a1a0a' : canDetect ? '#0d2040' : '#1c2a3a',
              border: `1px solid ${liveDetecting ? '#f97316' : canDetect ? '#3b82f6' : '#253347'}`,
              color: liveDetecting ? '#fb923c' : canDetect ? '#93c5fd' : '#4b5563',
              cursor: canDetect ? 'pointer' : 'not-allowed',
            }}>
            {liveDetecting ? t('stopDetectBtn') : t('liveDetectBtn')}
          </button>
        </div>
      </div>

      {/* 비디오 영역 */}
      <div className="flex-1 relative bg-black flex items-center justify-center">
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {!streaming && !camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="text-4xl opacity-30">📷</span>
            <p className="text-sm text-gray-600">{t('cameraOff')}</p>
          </div>
        )}
        {camError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="text-4xl opacity-40">🚫</span>
            <p className="text-xs text-red-400">{camError}</p>
            <button onClick={startCamera} className="text-xs px-3 py-1 rounded-lg mt-1"
              style={{ background: '#0d2a1a', border: '1px solid #22c55e', color: '#22c55e' }}>
              {t('tryAgain')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── 기본 3D 씬 ────────────────────────────────────────────────────

function Building({ position, size, color = '#2a5080' }) {
  return (
    <Box args={size} position={position} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.7} metalness={0.1} />
    </Box>
  );
}

function Worker({ position, dangerous }) {
  const meshRef = useRef();
  const targetColor = useRef(new THREE.Color(dangerous ? '#ef4444' : '#22c55e'));
  const currentColor = useRef(new THREE.Color(dangerous ? '#ef4444' : '#22c55e'));

  useEffect(() => { targetColor.current.set(dangerous ? '#ef4444' : '#22c55e'); }, [dangerous]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    currentColor.current.lerp(targetColor.current, Math.min(delta * 4, 1));
    meshRef.current.material.color.copy(currentColor.current);
    if (dangerous) {
      meshRef.current.material.emissive.set('#7f0000');
      meshRef.current.material.emissiveIntensity = 0.4 + 0.3 * Math.sin(Date.now() * 0.005);
    } else {
      meshRef.current.material.emissiveIntensity = 0;
    }
  });

  return (
    <mesh ref={meshRef} position={position} castShadow>
      <boxGeometry args={[0.4, 0.8, 0.4]} />
      <meshStandardMaterial color={dangerous ? '#ef4444' : '#22c55e'} />
    </mesh>
  );
}

function DefaultScene({ dangerous }) {
  const WORKERS = [[-2, 0.4, 0], [0, 0.4, 2], [3, 0.4, -1], [-1, 0.4, -3], [2, 0.4, 3]];
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={1.2} castShadow />
      <Plane args={[20, 20]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#1a2e1a" roughness={1} />
      </Plane>
      <Building position={[-4, 1.5, -4]} size={[3, 3, 3]} />
      <Building position={[0, 2.5, -5]} size={[4, 5, 3]} />
      <Building position={[5, 1, -3]} size={[2.5, 2, 2.5]} />
      {WORKERS.map((pos, i) => <Worker key={i} position={pos} dangerous={dangerous} />)}
      <OrbitControls enablePan enableZoom enableRotate />
    </>
  );
}

// ── Make 씬 ───────────────────────────────────────────────────────

function PersonFigure({ position, size, isDanger, cls, confidence }) {
  const [sx, sy, sz] = size;
  const bodyH = sy * 0.65;
  const headR = Math.min(sx * 0.45, sy * 0.22);
  const armW = Math.min(sx * 1.4, 3.0);
  const color = isDanger ? '#ef4444' : '#4ade80';
  const emit = isDanger ? '#5c0000' : '#003300';
  return (
    <group position={position}>
      <Box args={[sx, bodyH, sz]} castShadow>
        <meshStandardMaterial color={color} emissive={emit} emissiveIntensity={0.25} roughness={0.6} />
      </Box>
      <mesh position={[0, bodyH / 2 + headR * 0.9, 0]} castShadow>
        <sphereGeometry args={[headR, 10, 8]} />
        <meshStandardMaterial color={color} emissive={emit} emissiveIntensity={0.3} />
      </mesh>
      <Box args={[armW, sy * 0.07, sz * 0.4]} position={[0, bodyH * 0.12, 0]}>
        <meshStandardMaterial color={color} emissive={emit} emissiveIntensity={0.1} roughness={0.8} />
      </Box>
      <Html position={[0, bodyH / 2 + headR * 2.2 + 0.1, 0]} center>
        <div style={{
          fontSize: '9px', color: '#fff', whiteSpace: 'nowrap', pointerEvents: 'none',
          background: isDanger ? 'rgba(100,0,0,0.85)' : 'rgba(0,40,0,0.85)',
          padding: '1px 6px', borderRadius: '4px', border: `1px solid ${color}`,
        }}>{cls} {confidence}%</div>
      </Html>
    </group>
  );
}

function ObjectBox({ position, size, cls, confidence }) {
  const hue = [...(cls || 'obj')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const color = `hsl(${hue}, 45%, 32%)`;
  const label = `hsl(${hue}, 65%, 58%)`;
  const [sx, sy, sz] = size;
  return (
    <group position={position}>
      <Box args={[sx, sy, sz]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.65} metalness={0.25} />
      </Box>
      <Html position={[0, sy / 2 + 0.15, 0]} center>
        <div style={{
          fontSize: '9px', color: '#e5e7eb', whiteSpace: 'nowrap', pointerEvents: 'none',
          background: 'rgba(6,14,24,0.88)', padding: '1px 6px', borderRadius: '4px',
          border: `1px solid ${label}`,
        }}>{cls} {confidence}%</div>
      </Html>
    </group>
  );
}

function NoObjectsDetectedText() {
  const t = useT('safe');
  return (
    <p style={{ color: '#4b5563', fontSize: '13px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
      {t('noObjectsDetected')}
    </p>
  );
}

function MadeScene({ objects }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[8, 14, 8]} intensity={1.1} castShadow />
      <pointLight position={[-6, 6, 5]} intensity={0.35} color="#60a5fa" />
      <Plane args={[24, 24]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#080f1a" roughness={1} />
      </Plane>
      <primitive object={new THREE.GridHelper(24, 24, 0x1a3a5a, 0x0d1f2d)} />
      {objects.length === 0
        ? <Html center position={[0, 2, 0]}>
          <NoObjectsDetectedText />
        </Html>
        : objects.map(obj => obj.isPerson
          ? <PersonFigure key={obj.id} {...obj} />
          : <ObjectBox key={obj.id} {...obj} />)
      }
      <OrbitControls enablePan enableZoom enableRotate />
    </>
  );
}

// ── 3D 씬 패널 (우측 상단) ────────────────────────────────────────

function ScenePanel({ dangerous, madeObjects, onMake, making, makeCooldown, hasDetections, camStreaming, isFallback, madeFallback }) {
  const t = useT('safe');
  const hasMade = madeObjects !== null;

  const makeDisabled = !camStreaming || !hasDetections || making || makeCooldown;
  const makeLabel = making ? t('creating')
    : makeCooldown ? t('waitCooldown')
      : !hasDetections ? t('makeDetectionRequired')
        : isFallback ? t('makeDefault')
          : t('make');
  const makeTip = !camStreaming ? t('cameraTip')
    : !hasDetections ? t('detectTip')
      : t('makeTip');

  return (
    <>
      {/* 헤더 */}
      <div className="px-4 py-2 border-b shrink-0 flex items-center gap-2 flex-wrap"
        style={{ borderColor: '#253347' }}>
        <span className="text-sm font-semibold text-gray-300">{t('safeViewer')}</span>

        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${dangerous ? 'animate-pulse' : ''}`}
          style={{
            background: dangerous ? '#3a0f0f' : '#0d2a1a',
            border: `1px solid ${dangerous ? '#ef4444' : '#22c55e'}`,
            color: dangerous ? '#ef4444' : '#22c55e',
          }}>
          {dangerous ? `⚠ ${t('danger')}` : `✓ ${t('safe')}`}
        </span>

        <button onClick={onMake} disabled={makeDisabled} title={makeTip}
          className="text-xs px-3 py-1 rounded-lg transition"
          style={{
            background: makeDisabled ? '#111a25' : '#0d2040',
            border: `1px solid ${makeDisabled ? '#374151' : '#3b82f6'}`,
            color: makeDisabled ? '#6b7280' : '#93c5fd',
            cursor: makeDisabled ? 'not-allowed' : 'pointer',
          }}>
          {makeLabel}
        </button>

        {hasMade && !making && (
          <span className="text-xs text-blue-400">
            {madeObjects.length > 0 ? t('objectsCreated', { n: madeObjects.length }) : t('noDetectionResult')}
          </span>
        )}
        {(isFallback || madeFallback) && (
          <span className="text-xs px-2 py-0.5 rounded-full shrink-0"
            style={{ background: '#1e1000', border: '1px solid #d97706', color: '#d97706' }}>
            {t('defaultBadge')}
          </span>
        )}
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Canvas shadows camera={{ position: [8, 8, 10], fov: 50 }}
          style={{ width: '100%', height: '100%', background: '#060e18' }}>
          {hasMade ? <MadeScene objects={madeObjects} /> : <DefaultScene dangerous={dangerous} />}
        </Canvas>
      </div>
    </>
  );
}

// ── 로그 패널 (하단) ──────────────────────────────────────────────

function LogPanel({ detectionHistory }) {
  const t = useT('safe');
  const totalScans = detectionHistory.length;
  const dangerCount = detectionHistory.filter(h => h.dangerous).length;
  const helmetViolations = detectionHistory.filter(h => h.noHelmet).length;
  const areaViolations = detectionHistory.filter(h => h.restricted).length;
  const lastEntry = detectionHistory[0];

  const STATS = [
    { label: t('scans'), value: totalScans, color: '#60a5fa' },
    { label: t('dangerStat'), value: dangerCount, color: '#ef4444' },
    { label: t('noHelmetStat'), value: helmetViolations, color: '#f97316' },
    { label: t('restrictedStat'), value: areaViolations, color: '#a855f7' },
  ];

  function fmtTime(d) { return d.toLocaleTimeString('ko-KR', { hour12: false }); }

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ borderColor: '#253347', background: '#0a1525' }}>

      {/* 통계 헤더 */}
      <div className="px-4 py-2 border-b flex items-center gap-3"
        style={{ borderColor: '#253347' }}>
        <span className="text-sm font-semibold text-gray-300">{t('detectionLog')}</span>
        {lastEntry && (
          <span className="text-xs text-gray-600 ml-auto">
            {t('logUpdated', { time: fmtTime(lastEntry.time) })}
          </span>
        )}
      </div>

      {/* 통계 스트립 */}
      <div className="flex items-center border-b" style={{ borderColor: '#253347' }}>
        {STATS.map(({ label, value, color }) => (
          <div key={label}
            className="flex-1 flex flex-col items-center py-2 border-r last:border-r-0"
            style={{ borderColor: '#253347' }}>
            <span className="text-lg font-bold" style={{ color }}>{value}</span>
            <span className="text-xs" style={{ color: '#4b5563' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* 로그 목록 */}
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {detectionHistory.length === 0 ? (
          <div className="flex items-center justify-center text-xs text-gray-600 py-6">
            {t('waitingDetection')}
          </div>
        ) : (
          detectionHistory.map((entry, i) => (
            <div key={i}
              className="flex items-center gap-2 px-4 py-1.5 border-b text-xs"
              style={{
                borderColor: '#1a2a3a',
                background: entry.dangerous && i === 0 ? '#1a0a0a' : 'transparent',
              }}>
              <span style={{ color: '#4b5563', whiteSpace: 'nowrap', minWidth: '58px' }}>
                {fmtTime(entry.time)}
              </span>
              <span style={{ color: entry.dangerous ? '#ef4444' : '#22c55e' }}>
                {entry.dangerous ? '⚠' : '✓'}
              </span>
              <span className="flex-1 truncate" style={{ color: '#d1d5db' }}>
                {entry.dangerous ? (
                  <>
                    {entry.noHelmet && <span style={{ color: '#f97316' }}>{t('noHelmetLabel')} </span>}
                    {entry.restricted && <span style={{ color: '#a855f7' }}>{t('restrictedLabel')} </span>}
                  </>
                ) : (
                  <span style={{ color: '#4b5563' }}>
                    {entry.count > 0 ? t('detectedCount', { n: entry.count }) : t('clear')}
                  </span>
                )}
              </span>
              {entry.count > 0 && (
                <span className="shrink-0" style={{ color: '#374151' }}>{entry.count}</span>
              )}
              {entry.fallback && (
                <span className="shrink-0 text-xs px-1 rounded"
                  style={{ background: '#1e1000', border: '1px solid #d9770650', color: '#d97706' }}>
                  {t('basic')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── 메인 대시보드 ─────────────────────────────────────────────────

export default function SafeDashboard() {
  const t = useT('safe');
  const [safeEvent, setSafeEvent] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [detectError, setDetectError] = useState('');
  const [detectAvailable, setDetectAvailable] = useState(null);
  const [detectionHistory, setDetectionHistory] = useState([]);
  const [camStreaming, setCamStreaming] = useState(false);
  const [madeObjects, setMadeObjects] = useState(null);
  const [making, setMaking] = useState(false);
  const [makeCooldown, setMakeCooldown] = useState(false);
  const [madeFallback, setMadeFallback] = useState(false);
  const [devNoticeDismissed, setDevNoticeDismissed]         = useState(false);
  const [offlineNoticeDismissed, setOfflineNoticeDismissed] = useState(false);

  // 패널 높이 (드래그 리사이즈) — 데스크톱 전용
  const [panelH, setPanelH] = useState(480);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  const onDragStart = useCallback((clientY) => {
    isDragging.current = true;
    dragStartY.current = clientY;
    dragStartH.current = panelH;
  }, [panelH]);

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return;
      setPanelH(Math.min(CAM_MAX_H, Math.max(CAM_MIN_H, dragStartH.current + e.clientY - dragStartY.current)));
    };
    const onEnd = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
    };
  }, []);

  const makeCaptureRef = useRef(null);
  const stopDetectRef = useRef(null);
  const stompRef = useRef(null);

  const checkDetectServer = useCallback(() => {
    setDetectAvailable(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    fetch(`${DETECT_SERVER_URL}/api/detection/status`, { signal: controller.signal })
      .then(r => setDetectAvailable(r.ok))
      .catch(() => setDetectAvailable(false))
      .finally(() => clearTimeout(timer));
  }, []);

  useEffect(() => {
    checkDetectServer();
    const id = setInterval(checkDetectServer, 15000);
    return () => clearInterval(id);
  }, [checkDetectServer]);

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(`${WS_BASE}/ws/sensor`),
      reconnectDelay: 5000,
      onConnect: () => client.subscribe('/topic/safe', msg => setSafeEvent(JSON.parse(msg.body))),
    });
    client.activate();
    stompRef.current = client;
    return () => client.deactivate();
  }, []);

  useEffect(() => {
    if (!lastResult) return;
    const { noHelmet, restricted, dangerous: isDangerous } = analyzeDetections(lastResult.detections);
    setDetectionHistory(prev => [
      {
        time: new Date(), detections: lastResult.detections ?? [], count: lastResult.count ?? 0,
        noHelmet, restricted, dangerous: isDangerous, fallback: !!lastResult.fallback
      },
      ...prev.slice(0, 49),
    ]);
  }, [lastResult]);

  const handleMake = useCallback(() => {
    if (making || makeCooldown) return;
    if (!lastResult) {
      setDetectError('No Detection — Run Live Detect first.');
      return;
    }
    stopDetectRef.current?.();
    setMadeFallback(!!lastResult.fallback);
    setMaking(true);
    setMadeObjects(buildSceneObjects(lastResult.detections ?? [], lastResult._imgW, lastResult._imgH));
    setMaking(false);
    setMakeCooldown(true);
    setTimeout(() => setMakeCooldown(false), 5000);
  }, [making, makeCooldown, lastResult]);

  const dangerous = safeEvent?.dangerous ?? false;

  return (
    <div className="flex flex-col gap-4">

      {/* 위험 배너 */}
      {dangerous && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-pulse"
          style={{ backgroundColor: '#3a0f0f', borderColor: '#ef4444' }}>
          <span className="text-xl">🚨</span>
          <div className="flex-1">
            <p className="text-red-300 font-semibold">{t('dangerDetected')}</p>
            {safeEvent?.message && <p className="text-red-400 text-sm mt-0.5">{safeEvent.message}</p>}
          </div>
          <button onClick={() => setSafeEvent(null)} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
        </div>
      )}

      {/* 오류 토스트 */}
      {detectError && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs"
          style={{ background: '#2a1010', border: '1px solid #7f1d1d', color: '#f87171' }}>
          <span>⚠ {detectError}</span>
          <button onClick={() => setDetectError('')} className="ml-auto text-gray-600 hover:text-gray-400">✕</button>
        </div>
      )}

      {/* 개발 중 안내 배너 */}
      {!devNoticeDismissed && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border"
          style={{ backgroundColor: '#1e1000', borderColor: '#d97706' }}>
          <span className="text-xl mt-0.5 shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-amber-300 font-semibold text-sm">{t('developingPage')}</p>
            <p className="text-amber-700 text-xs mt-0.5">{t('testing')}</p>
          </div>
          <button onClick={() => setDevNoticeDismissed(true)}
            className="text-gray-500 hover:text-gray-300 text-lg shrink-0 leading-none">✕</button>
        </div>
      )}

      {/* Detect 서버 오프라인 경고 배너 */}
      {!offlineNoticeDismissed && (detectAvailable === false || lastResult?.fallback) && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border"
          style={{ backgroundColor: '#1e1000', borderColor: '#d97706' }}>
          <span className="text-xl mt-0.5 shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-amber-300 font-semibold text-sm">{t('detectServerOffline')}</p>
            <p className="text-amber-700 text-xs mt-0.5">{t('detectServerOfflineDesc')}</p>
          </div>
          <button onClick={() => setOfflineNoticeDismissed(true)}
            className="text-gray-500 hover:text-gray-300 text-lg shrink-0 leading-none">✕</button>
        </div>
      )}

      {/* ── 상단 행: 웹캠(좌) + 3D 씬(우) ── */}
      <div className="flex flex-col md:flex-row gap-4 justify-around">

        {/* 웹캠 — 데스크톱 최대 45% */}
        <div className="w-full md:w-[45%] md:shrink-0 rounded-xl border overflow-hidden flex flex-col"
          style={{ borderColor: '#253347', background: '#0a1525', height: panelH }}>
          <WebcamPanel
            detectAvailable={detectAvailable}
            checkDetectServer={checkDetectServer}
            onDetectResult={setLastResult}
            onError={setDetectError}
            makeCaptureRef={makeCaptureRef}
            stopDetectRef={stopDetectRef}
            onStreamingChange={setCamStreaming}
          />
        </div>

        {/* 3D 씬 — 나머지 너비 */}
        <div className="w-full md:w-[45%] rounded-xl border overflow-hidden flex flex-col"
          style={{ borderColor: '#253347', background: '#0a1525', height: panelH }}>
          <ScenePanel
            dangerous={dangerous}
            madeObjects={madeObjects}
            onMake={handleMake}
            making={making}
            makeCooldown={makeCooldown}
            hasDetections={!!lastResult}
            camStreaming={camStreaming}
            isFallback={!!lastResult?.fallback}
            madeFallback={madeFallback}
          />
        </div>
      </div>

      {/* 드래그 핸들 — 데스크톱(md+)만 표시 */}
      <div
        className="hidden md:flex items-center justify-center select-none -mt-2"
        onMouseDown={(e) => { e.preventDefault(); onDragStart(e.clientY); }}
        style={{ height: '16px', cursor: 'ns-resize' }}
        title={`높이 조절 (${CAM_MIN_H}–${CAM_MAX_H}px)`}
      >
        <div style={{ width: '56px', height: '4px', borderRadius: '2px', background: '#374151' }} />
      </div>

      {/* ── 하단: 탐지 로그 ── */}
      <LogPanel detectionHistory={detectionHistory} />

    </div>
  );
}
