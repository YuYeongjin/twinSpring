import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Plane } from '@react-three/drei';
import * as THREE from 'three';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import { WS_BASE } from '../../axios/AxiosCustom';

const DETECT_URL = process.env.REACT_APP_DETECT_URL || 'http://localhost:5001';

// ── 3D 씬 컴포넌트 ────────────────────────────────────────────────

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

  useEffect(() => {
    targetColor.current.set(dangerous ? '#ef4444' : '#22c55e');
  }, [dangerous]);

  useFrame((_, delta) => {
    if (meshRef.current) {
      currentColor.current.lerp(targetColor.current, Math.min(delta * 4, 1));
      meshRef.current.material.color.copy(currentColor.current);
      if (dangerous) {
        meshRef.current.material.emissive.set('#7f0000');
        meshRef.current.material.emissiveIntensity = 0.4 + 0.3 * Math.sin(Date.now() * 0.005);
      } else {
        meshRef.current.material.emissiveIntensity = 0;
      }
    }
  });

  return (
    <mesh ref={meshRef} position={position} castShadow>
      <boxGeometry args={[0.4, 0.8, 0.4]} />
      <meshStandardMaterial color={dangerous ? '#ef4444' : '#22c55e'} />
    </mesh>
  );
}

function Scene({ dangerous }) {
  const WORKERS = [
    [-2, 0.4, 0],
    [0, 0.4, 2],
    [3, 0.4, -1],
    [-1, 0.4, -3],
    [2, 0.4, 3],
  ];

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 15, 10]} intensity={1.2} castShadow />

      {/* 바닥 */}
      <Plane args={[20, 20]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#1a2e1a" roughness={1} />
      </Plane>

      {/* 건물 */}
      <Building position={[-4, 1.5, -4]} size={[3, 3, 3]} />
      <Building position={[0, 2.5, -5]} size={[4, 5, 3]} />
      <Building position={[5, 1, -3]} size={[2.5, 2, 2.5]} />

      {/* 작업자 */}
      {WORKERS.map((pos, i) => (
        <Worker key={i} position={pos} dangerous={dangerous} />
      ))}

      <OrbitControls enablePan enableZoom enableRotate />
    </>
  );
}

// ── 파일 업로드 영역 ──────────────────────────────────────────────

function UploadZone({ onUpload, uploading, disabled }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file) => {
    if (file && !disabled) onUpload(file);
  }, [onUpload, disabled]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  if (disabled) {
    return (
      <div
        className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-8 select-none"
        style={{ borderColor: '#2a3a2a', backgroundColor: '#0a120a' }}
      >
        <span className="text-3xl opacity-30">📁</span>
        <p className="text-sm text-gray-600">Detect server offline</p>
        <p className="text-xs text-gray-700">python detect/detect.py</p>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className="cursor-pointer rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-8 transition-colors select-none"
      style={{
        borderColor: dragging ? '#3b82f6' : '#253347',
        backgroundColor: dragging ? '#0d2040' : '#0a1525',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
      {uploading ? (
        <div className="text-blue-400 text-sm animate-pulse">Detecting…</div>
      ) : (
        <>
          <span className="text-3xl">📁</span>
          <p className="text-sm text-gray-400">Drag-and-click to upload an image or video </p>
          <p className="text-xs text-gray-600">.jpg .png .mp4 .avi ...</p>
        </>
      )}
    </div>
  );
}

// ── 메인 대시보드 ─────────────────────────────────────────────────

export default function SafeDashboard() {
  const [safeEvent, setSafeEvent] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState('');
  const [detectAvailable, setDetectAvailable] = useState(null); // null=checking, true=ok, false=offline
  const stompRef = useRef(null);

  const checkDetectServer = useCallback(() => {
    setDetectAvailable(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    fetch(`${DETECT_URL}/status`, { signal: controller.signal })
      .then(r => { if (r.ok) setDetectAvailable(true); else setDetectAvailable(false); })
      .catch(() => setDetectAvailable(false))
      .finally(() => clearTimeout(timer));
  }, []);

  useEffect(() => { checkDetectServer(); }, [checkDetectServer]);

  // WebSocket 연결
  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(`${WS_BASE}/ws/sensor`),
      reconnectDelay: 5000,
      onConnect: () => {
        client.subscribe('/topic/safe', (msg) => {
          const event = JSON.parse(msg.body);
          setSafeEvent(event);
        });
      },
    });
    client.activate();
    stompRef.current = client;
    return () => client.deactivate();
  }, []);

  // 파일 업로드 → detect.py → Spring → WebSocket
  const handleUpload = useCallback(async (file) => {
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${DETECT_URL}/detect`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Detection server error: ${res.status}`);
      const data = await res.json();
      setLastResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }, []);

  const dangerous = safeEvent?.dangerous ?? false;

  return (
    <div className="flex flex-col gap-4">
      {/* 경고 배너 */}
      {dangerous && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-pulse"
          style={{ backgroundColor: '#3a0f0f', borderColor: '#ef4444' }}
        >
          <span className="text-xl">🚨</span>
          <div className="flex-1">
            <p className="text-red-300 font-semibold">Danger Detected</p>
            {safeEvent?.message && (
              <p className="text-red-400 text-sm mt-0.5">{safeEvent.message}</p>
            )}
            {safeEvent?.filename && (
              <p className="text-gray-500 text-xs mt-1">File: {safeEvent.filename}</p>
            )}
          </div>
          <button
            onClick={() => setSafeEvent(null)}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
          >✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 3D 뷰어 */}
        <div
          className="lg:col-span-2 rounded-xl border overflow-hidden flex flex-col"
          style={{ borderColor: '#253347', height: '480px', background: '#0a1525' }}
        >
          <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0" style={{ borderColor: '#253347' }}>
            <span className="text-sm font-semibold text-gray-300">Safe Test 3D viewer</span>
            <span
              className="ml-auto text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: dangerous ? '#3a0f0f' : '#0d2a1a',
                color: dangerous ? '#ef4444' : '#22c55e',
              }}
            >
              {dangerous ? 'Danger' : 'Safe'}
            </span>
          </div>
          <Canvas
            shadows
            camera={{ position: [8, 8, 10], fov: 50 }}
            style={{ flex: 1, background: '#060e18' }}
          >
            <Scene dangerous={dangerous} />
          </Canvas>
        </div>

        {/* 우측 패널 */}
        <div className="flex flex-col gap-4">
          {/* 업로드 */}
          <div className="rounded-xl border p-4" style={{ borderColor: '#253347', background: '#0a1525' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-300">Upload Image or Video (Detect)</p>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: detectAvailable === true ? '#0d2a1a' : detectAvailable === false ? '#2a1010' : '#1a1a2a',
                    color: detectAvailable === true ? '#22c55e' : detectAvailable === false ? '#f87171' : '#6b7280',
                  }}
                >
                  {detectAvailable === true ? 'online' : detectAvailable === false ? 'offline' : 'checking…'}
                </span>
                {detectAvailable === false && (
                  <button
                    onClick={checkDetectServer}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    retry
                  </button>
                )}
              </div>
            </div>
            <UploadZone onUpload={handleUpload} uploading={uploading} disabled={detectAvailable !== true} />
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>

          {/* 탐지 결과 */}
          {lastResult && (
            <div className="rounded-xl border p-4" style={{ borderColor: '#253347', background: '#0a1525' }}>
              <p className="text-sm font-semibold text-gray-300 mb-2">Result Latest Detect</p>
              <div className="flex gap-4 text-xs text-gray-400 mb-3">
                <span>Detect amount: <span className="text-white">{lastResult.count}</span></span>
                <span>type: <span className="text-white">{lastResult.source}</span></span>
              </div>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                {(lastResult.detections || []).map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-2 py-1 rounded text-xs"
                    style={{ background: '#0d1e30' }}
                  >
                    <span className="text-gray-300">{d.class}</span>
                    <span className="text-blue-400">{(d.confidence * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* WebSocket 이벤트 */}
          {safeEvent && (
            <div className="rounded-xl border p-4" style={{ borderColor: '#253347', background: '#0a1525' }}>
              <p className="text-sm font-semibold text-gray-300 mb-2">Last WebSocket Event</p>
              <div className="text-xs text-gray-400 space-y-1">
                <div>No Helmet: <span className={safeEvent.noHelmet ? 'text-red-400' : 'text-green-400'}>{safeEvent.noHelmet ? 'Detected' : 'None'}</span></div>
                <div>Restricted Area: <span className={safeEvent.restricted ? 'text-red-400' : 'text-green-400'}>{safeEvent.restricted ? 'Detected' : 'None'}</span></div>
                <div className="text-gray-500 pt-1">{safeEvent.message}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
