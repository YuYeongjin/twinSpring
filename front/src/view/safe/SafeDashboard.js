import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Box, Plane, Html } from '@react-three/drei';
import * as THREE from 'three';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { useT } from '../../i18n/LanguageContext';
import { pushAlert, pushWbsSuggest } from '../../utils/alertStore';
import { useCrackMonitor } from '../../context/CrackMonitorContext';

const DETECT_SERVER_URL = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'development'
      ? `http://${window.location.hostname}:8080`
      : '');

/**
 * SockJS 연결 URL을 항상 절대 경로로 반환한다.
 *
 * K8s nginx-ingress 환경에서 SockJS에 상대경로('/ws/sensor')를 넘기면
 * 일부 버전에서 URL 재구성이 불안정하다.
 * window.location 기반으로 프로토콜·호스트를 명시적으로 붙여준다.
 */
function buildWsUrl(path) {
  if (typeof window === 'undefined') return path;
  const proto = window.location.protocol; // 'https:' or 'http:'
  const host  = window.location.host;     // 'example.com' or 'twin.local'
  return `${proto}//${host}${path}`;
}

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

// ── 안전구역 상수 / 유틸 ──────────────────────────────────────────────
const ZONE_HEIGHT = 3.0; // 안전구역 기본 높이 (m)

/** AABB XZ 평면 충돌 검사 */
function personInZone(position, size, zone) {
  const [px, , pz] = position;
  const [sw, , sz] = size;
  return (
    Math.abs(px - zone.cx) < (sw / 2 + zone.w / 2) &&
    Math.abs(pz - zone.cz) < (sz / 2 + zone.d / 2)
  );
}

// ── 안전구역 Box (빨간 반투명 + 와이어프레임) ────────────────────────
function SafeZoneBox({ zone, violated, onDelete, editMode }) {
  const meshRef = useRef();
  const edgesGeo = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(zone.w, ZONE_HEIGHT, zone.d)),
    [zone.w, zone.d]
  );

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    meshRef.current.material.opacity = violated
      ? 0.48 + 0.18 * Math.sin(clock.elapsedTime * 6)
      : 0.22;
    meshRef.current.material.color.setStyle(violated ? '#ff1111' : '#ef4444');
  });

  return (
    <group>
      {/* 반투명 채움 */}
      <mesh ref={meshRef} position={[zone.cx, ZONE_HEIGHT / 2, zone.cz]}>
        <boxGeometry args={[zone.w, ZONE_HEIGHT, zone.d]} />
        <meshStandardMaterial
          color="#ef4444" transparent opacity={0.22}
          side={THREE.DoubleSide} depthWrite={false}
        />
      </mesh>
      {/* 와이어프레임 엣지 */}
      <lineSegments position={[zone.cx, ZONE_HEIGHT / 2, zone.cz]} geometry={edgesGeo}>
        <lineBasicMaterial color={violated ? '#ff4444' : '#ff8888'} />
      </lineSegments>
      {/* 라벨 + 삭제 버튼 */}
      <Html position={[zone.cx, ZONE_HEIGHT + 0.5, zone.cz]} center>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: '10px', whiteSpace: 'nowrap', pointerEvents: 'auto',
          background: violated ? 'rgba(180,0,0,0.92)' : 'rgba(60,0,0,0.85)',
          border: `1px solid ${violated ? '#ff4444' : '#ef4444'}`,
          padding: '2px 7px', borderRadius: '4px', color: '#fff',
          userSelect: 'none',
        }}>
          <span>{violated ? '🚨 침범!' : '🚧 안전구역'}</span>
          {editMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(zone.id); }}
              style={{
                background: 'none', border: 'none', color: '#fca5a5',
                cursor: 'pointer', fontSize: '12px', padding: '0 2px', marginLeft: '2px',
              }}>✕</button>
          )}
        </div>
      </Html>
    </group>
  );
}

// ── 구역 드래그 그리기 레이어 ─────────────────────────────────────────
function ZoneDrawingLayer({ enabled, onZoneCreated }) {
  const { camera, gl, raycaster } = useThree();
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const startPt     = useRef(null);
  const previewRef  = useRef(null);
  const [preview, setPreview] = useState(null);

  const getGroundPt = useCallback((e) => {
    const rect = gl.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const target = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, target) ? target : null;
  }, [camera, gl, raycaster, groundPlane]);

  useEffect(() => {
    if (!enabled) {
      setPreview(null); previewRef.current = null; startPt.current = null; return;
    }
    const canvas = gl.domElement;

    const onDown = (e) => {
      const pt = getGroundPt(e); if (!pt) return;
      startPt.current = { x: pt.x, z: pt.z };
      previewRef.current = null; setPreview(null);
    };
    const onMove = (e) => {
      if (!startPt.current) return;
      const pt = getGroundPt(e); if (!pt) return;
      const { x: sx, z: sz } = startPt.current;
      const next = {
        cx: (sx + pt.x) / 2, cz: (sz + pt.z) / 2,
        w: Math.max(Math.abs(pt.x - sx), 0.3),
        d: Math.max(Math.abs(pt.z - sz), 0.3),
      };
      previewRef.current = next; setPreview({ ...next });
    };
    const onUp = () => {
      const p = previewRef.current;
      if (p && p.w > 0.5 && p.d > 0.5)
        onZoneCreated({ id: `zone-${Date.now()}`, ...p });
      startPt.current = null; previewRef.current = null; setPreview(null);
    };
    const onRightClick = (e) => { e.preventDefault(); startPt.current = null; setPreview(null); };

    canvas.addEventListener('mousedown',   onDown);
    canvas.addEventListener('mousemove',   onMove);
    canvas.addEventListener('mouseup',     onUp);
    canvas.addEventListener('contextmenu', onRightClick);
    return () => {
      canvas.removeEventListener('mousedown',   onDown);
      canvas.removeEventListener('mousemove',   onMove);
      canvas.removeEventListener('mouseup',     onUp);
      canvas.removeEventListener('contextmenu', onRightClick);
    };
  }, [enabled, getGroundPt, onZoneCreated, gl]);

  if (!preview) return null;
  return (
    <group>
      <mesh position={[preview.cx, ZONE_HEIGHT / 2, preview.cz]}>
        <boxGeometry args={[preview.w, ZONE_HEIGHT, preview.d]} />
        <meshStandardMaterial color="#ef4444" transparent opacity={0.35}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments position={[preview.cx, ZONE_HEIGHT / 2, preview.cz]}>
        <edgesGeometry args={[new THREE.BoxGeometry(preview.w, ZONE_HEIGHT, preview.d)]} />
        <lineBasicMaterial color="#ff6666" />
      </lineSegments>
    </group>
  );
}

// ── 구역 침범 검사 (매 프레임, 변경 시에만 콜백) ─────────────────────
function ZoneChecker({ persons, zones, onViolationChange }) {
  const lastSet = useRef(new Set());
  useFrame(() => {
    const current = new Set();
    for (const p of persons)
      for (const z of zones)
        if (personInZone(p.position, p.size ?? [0.4, 1.6, 0.4], z))
          current.add(z.id);

    const same = current.size === lastSet.current.size &&
      [...current].every(id => lastSet.current.has(id));
    if (!same) { lastSet.current = new Set(current); onViolationChange(current); }
  });
  return null;
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

  // t를 ref로 보관 — startCamera가 언어 변경 때마다 재생성되어
  // useEffect 무한루프가 발생하는 것을 완전히 차단
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const startCamera = useCallback(async () => {
    const tr = tRef.current;
    setCamError('');

    // 1) Secure Context 체크
    if (!window.isSecureContext) {
      setCamError('[K8s] 페이지가 Secure Context가 아닙니다. HTTPS 인증서를 확인하거나 브라우저 주소창에서 직접 https://를 확인하세요.');
      return;
    }
    // 2) mediaDevices API 가용성 체크
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('[브라우저] navigator.mediaDevices.getUserMedia 를 지원하지 않습니다. — ' + tr('cameraHttpsRequired'));
      return;
    }
    // 3) Permissions-Policy 체크 (K8s ingress가 camera=() 헤더를 내려보낼 경우)
    if (navigator.permissions) {
      try {
        const perm = await navigator.permissions.query({ name: 'camera' });
        if (perm.state === 'denied') {
          setCamError('[권한 거부] 브라우저가 이 사이트의 카메라를 차단했습니다. 브라우저 설정 → 사이트 권한에서 카메라를 허용해 주세요.');
          return;
        }
      } catch (_) { /* permissions API 미지원 브라우저는 무시 */ }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoRef.current) { videoRef.current.srcObject = stream; setStreaming(true); }
    } catch (e) {
      // NotAllowedError: 사용자 거부 또는 Permissions-Policy 차단
      // NotFoundError: 카메라 없음
      // NotReadableError: 카메라가 다른 앱에서 사용 중
      const name = e.name ?? '';
      if (name === 'NotAllowedError') {
        setCamError('[권한 거부] 카메라 접근이 차단되었습니다. K8s Ingress의 Permissions-Policy 헤더를 확인하거나 브라우저 주소창 자물쇠 → 카메라를 "허용"으로 설정하세요.');
      } else if (name === 'NotFoundError') {
        setCamError('[장치 없음] 연결된 카메라를 찾을 수 없습니다.');
      } else if (name === 'NotReadableError') {
        setCamError('[장치 사용 중] 카메라가 다른 앱에서 사용 중입니다. 다른 탭/앱을 닫고 다시 시도하세요.');
      } else {
        setCamError(tr('cameraError') + e.message);
      }
    }
  }, []); // ← 의존성 없음: tRef를 통해 최신 t를 참조하므로 안전

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
  }, [captureOnce, onDetectResult, onError, t]);

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

const DEFAULT_WORKERS = [
  { pos: [-2, 0.4, 0],  size: [0.4, 0.8, 0.4] },
  { pos: [0,  0.4, 2],  size: [0.4, 0.8, 0.4] },
  { pos: [3,  0.4, -1], size: [0.4, 0.8, 0.4] },
  { pos: [-1, 0.4, -3], size: [0.4, 0.8, 0.4] },
  { pos: [2,  0.4, 3],  size: [0.4, 0.8, 0.4] },
];

function DefaultScene({ dangerous, zones = [], violatedZones = new Set(),
  editMode, onZoneCreate, onZoneDelete, controlsRef, onViolationChange }) {

  // OrbitControls: editMode 시 비활성화
  useEffect(() => {
    if (controlsRef?.current) controlsRef.current.enabled = !editMode;
  }, [editMode, controlsRef]);

  const persons = useMemo(() =>
    DEFAULT_WORKERS.map((w, i) => ({ id: `def-${i}`, position: w.pos, size: w.size })),
  []);

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

      {DEFAULT_WORKERS.map((w, i) => {
        const inZone = zones.some(z => personInZone(w.pos, w.size, z));
        return <Worker key={i} position={w.pos} dangerous={dangerous || inZone} />;
      })}

      {/* 안전구역 박스 */}
      {zones.map(zone => (
        <SafeZoneBox key={zone.id} zone={zone}
          violated={violatedZones.has(zone.id)}
          onDelete={onZoneDelete} editMode={editMode} />
      ))}

      {/* 구역 그리기 레이어 (editMode) */}
      <ZoneDrawingLayer enabled={editMode} onZoneCreated={onZoneCreate} />

      {/* 침범 체크 */}
      <ZoneChecker persons={persons} zones={zones} onViolationChange={onViolationChange} />

      <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate />
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

function MadeScene({ objects, zones = [], violatedZones = new Set(),
  editMode, onZoneCreate, onZoneDelete, controlsRef, onViolationChange }) {

  useEffect(() => {
    if (controlsRef?.current) controlsRef.current.enabled = !editMode;
  }, [editMode, controlsRef]);

  const persons = useMemo(() =>
    objects.filter(o => o.isPerson).map(o => ({
      id: o.id, position: o.position, size: o.size,
    })),
  [objects]);

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
        ? <Html center position={[0, 2, 0]}><NoObjectsDetectedText /></Html>
        : objects.map(obj => {
          const inZone = obj.isPerson && zones.some(z => personInZone(obj.position, obj.size, z));
          return obj.isPerson
            ? <PersonFigure key={obj.id} {...obj} isDanger={obj.isDanger || inZone} />
            : <ObjectBox key={obj.id} {...obj} />;
        })
      }

      {/* 안전구역 박스 */}
      {zones.map(zone => (
        <SafeZoneBox key={zone.id} zone={zone}
          violated={violatedZones.has(zone.id)}
          onDelete={onZoneDelete} editMode={editMode} />
      ))}

      {/* 구역 그리기 레이어 (editMode) */}
      <ZoneDrawingLayer enabled={editMode} onZoneCreated={onZoneCreate} />

      {/* 침범 체크 */}
      <ZoneChecker persons={persons} zones={zones} onViolationChange={onViolationChange} />

      <OrbitControls ref={controlsRef} enablePan enableZoom enableRotate />
    </>
  );
}

// ── 3D 씬 패널 (우측 상단) ────────────────────────────────────────

function ScenePanel({ dangerous, madeObjects, onMake, making, makeCooldown, hasDetections,
  camStreaming, isFallback, madeFallback,
  zones, violatedZones, onZoneCreate, onZoneDelete, onViolationChange }) {

  const t = useT('safe');
  const hasMade = madeObjects !== null;
  const controlsRef = useRef();
  const [zoneEditMode, setZoneEditMode] = useState(false);

  const makeDisabled = !camStreaming || !hasDetections || making || makeCooldown || zoneEditMode;
  const makeLabel = making ? t('creating')
    : makeCooldown ? t('waitCooldown')
      : !hasDetections ? t('makeDetectionRequired')
        : isFallback ? t('makeDefault')
          : t('make');
  const makeTip = !camStreaming ? t('cameraTip')
    : !hasDetections ? t('detectTip')
      : t('makeTip');

  const toggleZoneEdit = useCallback(() => setZoneEditMode(v => !v), []);

  const zoneViolating = violatedZones.size > 0;

  return (
    <>
      {/* 헤더 */}
      <div className="px-4 py-2 border-b shrink-0 flex items-center gap-2 flex-wrap"
        style={{ borderColor: '#253347' }}>
        <span className="text-sm font-semibold text-gray-300">{t('safeViewer')}</span>

        {/* 감지 위험 배지 */}
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${dangerous ? 'animate-pulse' : ''}`}
          style={{
            background: dangerous ? '#3a0f0f' : '#0d2a1a',
            border: `1px solid ${dangerous ? '#ef4444' : '#22c55e'}`,
            color: dangerous ? '#ef4444' : '#22c55e',
          }}>
          {dangerous ? `⚠ ${t('danger')}` : `✓ ${t('safe')}`}
        </span>

        {/* 구역 침범 경고 배지 */}
        {zoneViolating && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full animate-pulse"
            style={{ background: '#3a0000', border: '1px solid #ff4444', color: '#ff8888' }}>
            🚨 구역 침범!
          </span>
        )}

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

        {/* ── 안전구역 컨트롤 ── */}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleZoneEdit}
            className="text-xs px-3 py-1 rounded-lg transition font-semibold"
            style={{
              background: zoneEditMode ? '#2a0000' : '#1a0a0a',
              border: `1px solid ${zoneEditMode ? '#ff4444' : '#7f1d1d'}`,
              color: zoneEditMode ? '#ff8888' : '#f87171',
            }}>
            {zoneEditMode ? '✓ 완료' : '🚧 구역 추가'}
          </button>
          {zones.length > 0 && !zoneEditMode && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: '#1a0808', border: '1px solid #7f1d1d', color: '#f87171' }}>
              {zones.length}개 구역
            </span>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', cursor: zoneEditMode ? 'crosshair' : 'default' }}>
        {/* 구역 그리기 모드 안내 */}
        {zoneEditMode && (
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, pointerEvents: 'none',
            background: 'rgba(60,0,0,0.92)', border: '1px solid #ef4444',
            borderRadius: '8px', padding: '5px 12px',
            fontSize: '11px', color: '#fca5a5', whiteSpace: 'nowrap',
          }}>
            🖱 드래그로 안전구역을 그리세요 &nbsp;·&nbsp; 우클릭으로 취소 &nbsp;·&nbsp; 구역 ✕로 삭제
          </div>
        )}

        <Canvas shadows camera={{ position: [8, 8, 10], fov: 50 }}
          style={{ width: '100%', height: '100%', background: '#060e18' }}>
          {hasMade
            ? <MadeScene objects={madeObjects}
                zones={zones} violatedZones={violatedZones}
                editMode={zoneEditMode}
                onZoneCreate={onZoneCreate} onZoneDelete={onZoneDelete}
                controlsRef={controlsRef} onViolationChange={onViolationChange} />
            : <DefaultScene dangerous={dangerous}
                zones={zones} violatedZones={violatedZones}
                editMode={zoneEditMode}
                onZoneCreate={onZoneCreate} onZoneDelete={onZoneDelete}
                controlsRef={controlsRef} onViolationChange={onViolationChange} />
          }
        </Canvas>
      </div>
    </>
  );
}

// ── 균열 비교뷰 ───────────────────────────────────────────────────

/** 감지 결과 이미지 위에 균열 bbox를 캔버스로 오버레이 */
function CrackPhotoCanvas({ entry }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!entry?.imageUrl || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      const lw = Math.max(2, img.naturalWidth / 200);
      (entry.regions || []).forEach((r, i) => {
        ctx.fillStyle   = 'rgba(239,68,68,0.14)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth   = lw;
        ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
        ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
        ctx.fillStyle = '#ef4444';
        ctx.font = `bold ${Math.max(13, img.naturalWidth / 45)}px sans-serif`;
        ctx.fillText(`#${i + 1}`, r.x1 + 4, r.y1 + 16);
      });
    };
    img.src = entry.imageUrl;
  }, [entry]);
  return (
    <canvas ref={ref}
      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, maxHeight: 260 }} />
  );
}

/** 균열 영역을 정규화 좌표로 보여주는 위치 맵 */
function CrackLocationMap({ entry }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!entry?.imageUrl || !ref.current) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth  || 200;
    const H = canvas.offsetHeight || 150;
    canvas.width  = W;
    canvas.height = H;

    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth  || 640;
      const ih = img.naturalHeight || 480;

      ctx.fillStyle = '#060f1a';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, W - 2, H - 2);

      // 격자
      ctx.strokeStyle = '#0d1e30';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo((W * i) / 4, 0); ctx.lineTo((W * i) / 4, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); ctx.stroke();
      }

      // 퍼센트 레이블
      ctx.fillStyle = '#1e3a5f';
      ctx.font = '9px sans-serif';
      ['0%','25%','50%','75%','100%'].forEach((lbl, i) => {
        ctx.fillText(lbl, (W * i) / 4, H - 2);
      });

      // 균열 영역
      (entry.regions || []).forEach((r, idx) => {
        const nx = (r.x1 / iw) * W;
        const ny = (r.y1 / ih) * H;
        const nw = ((r.x2 - r.x1) / iw) * W;
        const nh = ((r.y2 - r.y1) / ih) * H;
        ctx.fillStyle   = 'rgba(239,68,68,0.4)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth   = 1.5;
        ctx.fillRect(nx, ny, Math.max(nw, 4), Math.max(nh, 4));
        ctx.strokeRect(nx, ny, Math.max(nw, 4), Math.max(nh, 4));
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(`#${idx + 1}`, nx + 2, ny + 10);
      });
    };
    img.src = entry.imageUrl;
  }, [entry]);

  return (
    <canvas ref={ref} style={{ width: '100%', aspectRatio: '4/3', display: 'block',
                                borderRadius: 8, border: '1px solid #1e3a5f' }}
            width={200} height={150} />
  );
}

/** 균열 감지 결과 사진 + BIM 위치 비교 패널 */
function CrackCompareView({ entry, bimProject }) {
  if (!entry?.imageUrl) return null;
  const conf = Math.round((entry.confidence ?? 0) * 100);
  const regionCount = (entry.regions || []).length;

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${entry.hasCrack ? '#7c2d12' : '#14532d'}`,
                  background: '#060f1a', overflow: 'hidden' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                    background: 'linear-gradient(135deg,#0a1a2e,#060f1a)',
                    borderBottom: `1px solid ${entry.hasCrack ? '#7c2d12' : '#14532d'}` }}>
        <span style={{ fontSize: 16 }}>{entry.hasCrack ? '🚨' : '✅'}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>균열 감지 비교뷰</span>
        {bimProject && (
          <span style={{ fontSize: 10, color: '#60a5fa', background: '#0d2040', borderRadius: 8,
                         padding: '2px 8px', border: '1px solid #1e3a5f', maxWidth: 120,
                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            🏗 {bimProject.projectName}
          </span>
        )}
        {entry.hasCrack && regionCount > 0 && (
          <span style={{ fontSize: 10, background: '#3a1a00', border: '1px solid #f97316',
                         color: '#fb923c', borderRadius: 8, padding: '2px 7px' }}>
            균열 {regionCount}개 영역 감지
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10,
                       color: entry.hasCrack ? '#fb923c' : '#4ade80' }}>
          신뢰도 {conf}% · {entry.time.toLocaleTimeString('ko-KR', { hour12: false })}
        </span>
      </div>

      {/* 본문: 좌(사진+박스) · 우(BIM정보+위치맵) */}
      <div style={{ display: 'flex', gap: 0, minHeight: 280 }}>

        {/* ── 좌: 감지 사진 ── */}
        <div style={{ flex: 1, padding: 12, borderRight: '1px solid #1a2a3a',
                      display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#8896a4', display: 'flex', alignItems: 'center', gap: 6 }}>
            📷 감지 사진
            <span style={{ fontSize: 10, color: '#4b5563' }}>
              {entry.source === 'camera' ? '(카메라 촬영)' : '(파일 업로드)'}
            </span>
          </div>

          <CrackPhotoCanvas entry={entry} />

          {/* 좌표 목록 */}
          {regionCount > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 2 }}>📐 균열 좌표</div>
              {(entry.regions || []).map((r, i) => (
                <div key={i} style={{ fontSize: 10, color: '#8896a4', display: 'flex', gap: 6,
                                      padding: '3px 8px', background: '#0d1b2a', borderRadius: 6,
                                      border: '1px solid #1a2a3a' }}>
                  <span style={{ color: '#ef4444', fontWeight: 700, minWidth: 22 }}>#{i + 1}</span>
                  <span>({r.x1},{r.y1})</span>
                  <span style={{ color: '#253347' }}>→</span>
                  <span>({r.x2},{r.y2})</span>
                  <span style={{ color: '#4b5563', marginLeft: 'auto' }}>
                    {r.x2 - r.x1}×{r.y2 - r.y1}px
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#4b5563', textAlign: 'center', padding: '8px 0' }}>
              {entry.hasCrack ? '좌표 데이터 없음' : '균열 미감지'}
            </div>
          )}
        </div>

        {/* ── 우: BIM 정보 + 위치 맵 ── */}
        <div style={{ width: 210, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
                      flexShrink: 0 }}>

          {/* BIM 프로젝트 카드 */}
          {bimProject ? (
            <div style={{ background: '#0d2040', borderRadius: 8, border: '1px solid #1e3a5f', padding: 10 }}>
              <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 4 }}>
                🏗 연결된 BIM 프로젝트
              </div>
              <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bimProject.projectName}
              </div>
              {bimProject.location && (
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 3 }}>
                  📍 {bimProject.location}
                </div>
              )}
              {bimProject.description && (
                <div style={{ fontSize: 10, color: '#4b5563', marginTop: 2,
                              display: '-webkit-box', WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {bimProject.description}
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: '#0d1b2a', borderRadius: 8, border: '1px solid #1a2a3a',
                          padding: 10, fontSize: 10, color: '#4b5563', textAlign: 'center' }}>
              위의 드롭다운에서 BIM 프로젝트를 선택하면 도면 정보가 연결됩니다.
            </div>
          )}

          {/* 위치 맵 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <div style={{ fontSize: 10, color: '#8896a4', display: 'flex', alignItems: 'center', gap: 4 }}>
              📐 균열 위치 맵
              <span style={{ fontSize: 9, color: '#4b5563' }}>(정규화 좌표)</span>
            </div>
            <CrackLocationMap entry={entry} />

            {/* 정규화 % 좌표 */}
            {regionCount > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(entry.regions || []).map((r, i) => {
                  // 이미지 크기를 모를 때 640×480 기본값 사용 (캔버스 드로우 후)
                  return (
                    <div key={i} style={{ fontSize: 9, color: '#4b5563', display: 'flex', gap: 4 }}>
                      <span style={{ color: '#ef4444' }}>#{i + 1}</span>
                      <span>X:{r.x1}–{r.x2}px · Y:{r.y1}–{r.y2}px</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 균열 감지 패널 ────────────────────────────────────────────────

// CRACK_INTERVALS labels are translated at render time via t('intervalManual') / '{n}분'
const CRACK_INTERVAL_VALUES = [0, 60, 300, 600];

function CrackMonitorPanel({ selectedProject }) {
  const t = useT('safe');

  // ── Context에서 영속 상태·함수 가져오기 ────────────────────────
  const {
    streaming, camError,
    capturing,
    autoRunning, setAutoRunning,
    intervalSec, setIntervalSec,
    crackLog,
    streamRef,
    selectedProjectRef,
    startCamera, stopCamera,
    captureFromCamera, detectFromBlob,
  } = useCrackMonitor();

  const [bimProjects, setBimProjects] = useState([]);
  const [bimProjectId, setBimProjectId] = useState('');
  const fileInputRef    = useRef(null);
  const visibleVideoRef = useRef(null);  // 표시 전용 (캡처는 Context 숨김 비디오)

  // 선택된 BIM 프로젝트 객체 (비교뷰에 전달)
  const selectedBimProject = bimProjects.find(p => (p.projectId || p.id) === bimProjectId) || null;

  // 현재 Safe 프로젝트를 Context ref에 주입 — 탭 이탈 후에도 알림 전송 시 사용
  useEffect(() => {
    selectedProjectRef.current = selectedProject ?? null;
  }, [selectedProject, selectedProjectRef]);

  // 표시용 <video>에 Context 스트림 연결 (탭 복귀 시 자동 복원)
  useEffect(() => {
    const video = visibleVideoRef.current;
    if (!video) return;
    video.srcObject = streaming ? (streamRef.current ?? null) : null;
    if (streaming && streamRef.current) video.play().catch(() => {});
  }, [streaming, streamRef]);

  // BIM 프로젝트 목록 로드
  useEffect(() => {
    fetch('/api/bim/db-projects')
      .then(r => r.ok ? r.json() : [])
      .then(list => setBimProjects(list || []))
      .catch(() => setBimProjects([]));
  }, []);

  // 파일 업로드 → 감지 (Context의 detectFromBlob 사용)
  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await detectFromBlob(file, 'file');
    e.target.value = '';
  }, [detectFromBlob]);

  const hasCrackNow = crackLog.length > 0 && crackLog[0].hasCrack;
  const crackCount  = crackLog.filter(e => e.hasCrack).length;
  const totalCount  = crackLog.length;

  function fmtTime(d) { return d.toLocaleTimeString([], { hour12: false }); }

  function intervalLabel(v) {
    if (v === 0) return t('intervalManual');
    return `${v / 60}${t('intervalManual') === '수동' ? '분' : v / 60 === 1 ? 'min' : 'min'}`;
  }

  return (
    <div className="flex flex-col gap-4">

      {/* 균열 경고 배너 */}
      {hasCrackNow && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-pulse"
             style={{ backgroundColor: '#3a1a00', borderColor: '#f97316' }}>
          <span className="text-2xl">🚧</span>
          <div className="flex-1">
            <p className="text-orange-300 font-bold text-base">{t('crackWarningTitle')}</p>
            <p className="text-orange-400 text-sm mt-0.5">
              {t('crackFound', { n: Math.round((crackLog[0].confidence ?? 0) * 100) })} — {crackLog[0].detail}
            </p>
          </div>
        </div>
      )}

      {/* 컨트롤 패널 */}
      <div className="rounded-xl border p-4 flex flex-col gap-4"
           style={{ backgroundColor: "#0a1525", borderColor: "#253347" }}>

        {/* BIM 프로젝트 선택 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-xs font-semibold shrink-0" style={{ color: "#8896a4" }}>
            {t('bimProjectLabel')}
          </label>
          <select value={bimProjectId} onChange={e => setBimProjectId(e.target.value)}
                  className="flex-1 bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none focus:border-blue-500">
            <option value="">{t('bimProjectNone')}</option>
            {bimProjects.map(p => (
              <option key={p.projectId || p.id} value={p.projectId || p.id}>
                {p.projectName || p.name}
              </option>
            ))}
          </select>
        </div>

        {/* 촬영 간격 */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold shrink-0" style={{ color: "#8896a4" }}>
            {t('intervalLabel')}
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {CRACK_INTERVAL_VALUES.map(v => (
              <button key={v} onClick={() => setIntervalSec(v)}
                      className="px-3 py-1 rounded-full text-xs transition"
                      style={{
                        backgroundColor: intervalSec === v ? "#1e3a5f" : "#0d1b2a",
                        border: `1px solid ${intervalSec === v ? "#60a5fa" : "#253347"}`,
                        color: intervalSec === v ? "#93c5fd" : "#8896a4",
                      }}>
                {intervalLabel(v)}
              </button>
            ))}
          </div>
        </div>

        {/* 실행 버튼 */}
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={captureFromCamera} disabled={capturing || !streaming}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition"
                  style={{
                    backgroundColor: streaming && !capturing ? "#0d2040" : "#0d1b2a",
                    border: `1px solid ${streaming && !capturing ? "#3b82f6" : "#253347"}`,
                    color: streaming && !capturing ? "#93c5fd" : "#4b5563",
                    cursor: streaming && !capturing ? "pointer" : "not-allowed",
                  }}>
            {capturing ? t('capturing') : t('captureNow')}
          </button>

          <button onClick={() => fileInputRef.current?.click()} disabled={capturing}
                  className="px-4 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    backgroundColor: "#0d1b2a",
                    border: "1px solid #253347",
                    color: capturing ? "#4b5563" : "#8896a4",
                    cursor: capturing ? "not-allowed" : "pointer",
                  }}>
            {t('uploadImage')}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                 onChange={handleFileUpload} />

          {intervalSec > 0 && (
            <button onClick={() => setAutoRunning(r => !r)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold"
                    style={{
                      backgroundColor: autoRunning ? "#3a1a00" : "#0d2a1a",
                      border: `1px solid ${autoRunning ? "#f97316" : "#22c55e"}`,
                      color: autoRunning ? "#fb923c" : "#4ade80",
                    }}>
              {autoRunning ? t('autoStop') : t('autoStart')}
            </button>
          )}

          {autoRunning && (
            <span className="text-xs px-2 py-0.5 rounded-full animate-pulse"
                  style={{ background: "#3a1a00", border: "1px solid #f97316", color: "#fb923c" }}>
              {t('autoLabel')} — 탭 이탈 후에도 계속 촬영됩니다
            </span>
          )}
        </div>
      </div>

      {/* 웹캠 + 로그 행 */}
      <div className="flex flex-col md:flex-row gap-4">

        {/* 웹캠 미리보기 */}
        <div className="w-full md:w-[45%] rounded-xl border overflow-hidden flex flex-col"
             style={{ borderColor: "#253347", backgroundColor: "#0a1525", height: "320px" }}>
          <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0"
               style={{ borderColor: "#253347" }}>
            <span className="text-sm font-semibold text-gray-300">{t('cameraPreview')}</span>
            <span className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: streaming ? "#22c55e" : "#6b7280" }} />
            <span className="text-xs" style={{ color: streaming ? "#22c55e" : "#6b7280" }}>
              {streaming ? t('on') : t('off')}
            </span>
            <div className="ml-auto flex gap-2">
              {!streaming
                ? <button onClick={startCamera} className="text-xs px-3 py-1 rounded-lg"
                          style={{ background: "#0d2a1a", border: "1px solid #22c55e", color: "#22c55e" }}>
                    {t('startCamera')}
                  </button>
                : <button onClick={stopCamera} className="text-xs px-3 py-1 rounded-lg"
                          style={{ background: "#2a1010", border: "1px solid #ef4444", color: "#ef4444" }}>
                    {t('stopCamera')}
                  </button>
              }
            </div>
          </div>
          <div className="flex-1 relative bg-black flex items-center justify-center">
            <video ref={visibleVideoRef} autoPlay playsInline muted
                   style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            {!streaming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="text-4xl opacity-30">📷</span>
                {camError
                  ? <p className="text-xs text-red-400 px-4 text-center">{camError}</p>
                  : <p className="text-sm text-gray-600">{t('cameraOff2')}</p>
                }
              </div>
            )}
          </div>
        </div>

        {/* 균열 감지 로그 */}
        <div className="flex-1 rounded-xl border overflow-hidden flex flex-col"
             style={{ borderColor: "#253347", backgroundColor: "#0a1525" }}>
          <div className="px-4 py-2 border-b flex items-center gap-3 shrink-0"
               style={{ borderColor: "#253347" }}>
            <span className="text-sm font-semibold text-gray-300">{t('crackLogTitle')}</span>
            <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "#1e3a5f", color: "#93c5fd" }}>
              {t('crackLogChecks', { n: totalCount })}
            </span>
            {crackCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: "#3a1a00", color: "#fb923c" }}>
                {t('crackLogCracks', { n: crackCount })}
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {crackLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <span className="text-4xl opacity-20 mb-3">🔍</span>
                <p className="text-sm text-gray-600">{t('crackLogEmpty')}</p>
              </div>
            ) : (
              crackLog.map((entry, i) => (
                <div key={i}
                     className="flex items-start gap-2 px-4 py-2 border-b text-xs"
                     style={{
                       borderColor: "#1a2a3a",
                       backgroundColor: entry.hasCrack ? (i === 0 ? "#1a0d00" : "transparent") : "transparent",
                     }}>
                  <span style={{ color: "#4b5563", whiteSpace: "nowrap", minWidth: "58px", paddingTop: "1px" }}>
                    {fmtTime(entry.time)}
                  </span>
                  <span className="text-base shrink-0" style={{ lineHeight: 1 }}>
                    {entry.error ? "❌" : entry.hasCrack ? "🚧" : "✅"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div style={{ color: entry.hasCrack ? "#fb923c" : entry.error ? "#f87171" : "#4ade80", fontWeight: entry.hasCrack ? "bold" : "normal" }}>
                      {entry.error
                        ? t('crackError', { msg: entry.detail })
                        : entry.hasCrack
                          ? t('crackFound', { n: Math.round((entry.confidence ?? 0) * 100) })
                          : t('crackNone',  { n: Math.round((1 - (entry.confidence ?? 0)) * 100) })}
                    </div>
                    {!entry.error && entry.detail && (
                      <div className="truncate mt-0.5" style={{ color: "#4b5563" }}>{entry.detail}</div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs px-1 rounded"
                        style={{ backgroundColor: "#0d1b2a", border: "1px solid #253347", color: "#4b5563" }}>
                    {entry.source === "camera" ? "📷" : "📁"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 균열 감지 비교뷰 — 감지 결과가 있을 때만 표시 */}
      {crackLog.length > 0 && crackLog[0].imageUrl && (
        <CrackCompareView
          entry={crackLog[0]}
          bimProject={selectedBimProject}
        />
      )}
    </div>
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

/**
 * props:
 *   selectedProject : SafeProjectDTO | null  — 현재 선택된 안전 현장
 *   onBack          : () => void             — 목록으로 돌아가기
 */
export default function SafeDashboard({ selectedProject = null, onBack }) {
  const t  = useT('safe');
  const tP = useT('safeProjectList'); // 헤더 배지 등 프로젝트 리스트 번역
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

  // ── 안전구역 상태 ──────────────────────────────────────────────────
  const [zones, setZones]               = useState([]);          // {id, cx, cz, w, d}[]
  const [violatedZones, setViolatedZones] = useState(new Set()); // 침범 중인 zone id Set
  const prevViolated = useRef(new Set());

  const handleZoneCreate = useCallback((zone) => {
    setZones(prev => [...prev, zone]);
  }, []);

  const handleZoneDelete = useCallback((id) => {
    setZones(prev => prev.filter(z => z.id !== id));
    setViolatedZones(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const handleViolationChange = useCallback((newSet) => {
    setViolatedZones(new Set(newSet));
    // 새로 침범한 구역에 대해서만 알림 발생 (중복 방지)
    for (const id of newSet) {
      if (!prevViolated.current.has(id)) {
        const zoneAlert = pushAlert({
          source:      'SAFE_ZONE',
          severity:    'HIGH',
          title:       `안전구역 침범 — ${selectedProject?.projectName ?? '현장'}`,
          detail:      `지정 안전구역에 작업자가 진입했습니다.`,
          projectId:   selectedProject?.projectId   ?? '',
          projectName: selectedProject?.projectName ?? '',
        });
        // Agent WBS 수정 제안 (1분 쿨타임)
        pushWbsSuggest({
          eventType:   'SAFE_ZONE',
          source:      'SAFE_ZONE_VIOLATION',
          title:       `안전구역 침범 감지`,
          detail:      `${selectedProject?.projectName ?? '현장'}에서 작업자가 지정 안전구역에 진입했습니다. 안전 점검 일정 추가를 권장합니다.`,
          projectId:   selectedProject?.projectId   ?? '',
          projectName: selectedProject?.projectName ?? '',
          alertId:     zoneAlert.id,
        });
      }
    }
    prevViolated.current = new Set(newSet);
  }, [selectedProject]);

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
    // K8s nginx-ingress 환경에서 SockJS에 상대경로를 넘기면 URL 재구성이 불안정.
    // window.location 기반 절대 URL을 명시적으로 구성한다.
    const wsUrl = buildWsUrl('/ws/sensor');
    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      reconnectDelay: 5000,
      onConnect: () => client.subscribe('/topic/safe', msg => setSafeEvent(JSON.parse(msg.body))),
      onStompError: () => { /* 재접속은 reconnectDelay가 처리 — 콘솔 오류 억제 */ },
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
  const isCrackMode = (selectedProject?.mode || 'SAFETY') === 'CRACK';

  return (
    <div className="flex flex-col gap-4">

      {/* 현장 정보 헤더 바 */}
      {selectedProject && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
             style={{ backgroundColor: "#0a1521", border: "1px solid #1e3a5f" }}>
          {onBack && (
            <button onClick={onBack}
                    className="text-sm px-3 py-1 rounded-lg transition"
                    style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: "#8896a4" }}>
              {tP('backToList')}
            </button>
          )}
          <span className="text-base font-bold text-white">
            {isCrackMode ? "🔍" : "🛡"} {selectedProject.projectName}
          </span>
          {selectedProject.location && (
            <span className="text-xs text-gray-400">📍 {selectedProject.location}</span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{
                  backgroundColor: isCrackMode ? "#1e3a5f" : "#14532d",
                  border: `1px solid ${isCrackMode ? "#60a5fa" : "#4ade80"}`,
                  color: isCrackMode ? "#93c5fd" : "#4ade80",
                }}>
            {isCrackMode ? tP('modeCrackBadge') : tP('modeSafetyBadge')}
          </span>
          {!isCrackMode && selectedProject.cameraUrl && (
            <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "#0c2233", border: "1px solid #0ea5e9", color: "#7dd3fc" }}>
              {tP('cameraConnected')}
            </span>
          )}
        </div>
      )}

      {/* ── 균열 감지 모드 ── */}
      {isCrackMode ? (
        <CrackMonitorPanel selectedProject={selectedProject} />
      ) : (
        <>
          {/* 위험 배너 (감지 서버) */}
          {dangerous && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-pulse"
              style={{ backgroundColor: '#3a0f0f', borderColor: '#ef4444' }}>
              <span className="text-xl">🚨</span>
              <div className="flex-1">
                <p className="text-red-300 font-semibold">{t('dangerDetected')}</p>
                <p className="text-red-400 text-sm mt-0.5">
                  {safeEvent?.noHelmet && safeEvent?.restricted ? t('msgBoth')
                    : safeEvent?.noHelmet   ? t('msgNoHelmet')
                    : safeEvent?.restricted ? t('msgRestricted')
                    : ''}
                </p>
              </div>
              <button onClick={() => setSafeEvent(null)} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
            </div>
          )}

          {/* 안전구역 침범 배너 */}
          {violatedZones.size > 0 && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-pulse"
              style={{ backgroundColor: '#3a0000', borderColor: '#ff4444' }}>
              <span className="text-xl">🚨</span>
              <div className="flex-1">
                <p className="text-red-300 font-bold text-sm">안전구역 침범 감지!</p>
                <p className="text-red-400 text-xs mt-0.5">
                  {violatedZones.size}개 구역에 작업자가 진입했습니다. 즉시 확인하세요.
                </p>
              </div>
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
                zones={zones}
                violatedZones={violatedZones}
                onZoneCreate={handleZoneCreate}
                onZoneDelete={handleZoneDelete}
                onViolationChange={handleViolationChange}
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
        </>
      )}

    </div>
  );
}
