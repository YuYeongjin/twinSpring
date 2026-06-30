import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sky, GizmoHelper, GizmoViewport, Box, Edges } from '@react-three/drei';
import * as THREE from 'three';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import AxiosCustom from '../../axios/AxiosCustom';
import MobileGpsSender from './MobileGpsSender';
import { pushWbsSuggest } from '../../utils/alertStore';
import { useT } from '../../i18n/LanguageContext';

const D2R = Math.PI / 180;

const JOINT_LIMITS = {
  boomAngle:   { min: 0,   max: 80  },
  armAngle:    { min: -20, max: 120 },
  bucketAngle: { min: -90, max: 30  },
};

const DEFAULT_STATE = {
  positionX: 0, positionY: 0, positionZ: 0,
  bodyRotation: 0,
  swingAngle: 0,
  boomAngle: 35,
  armAngle: 60,
  bucketAngle: -25,
};

const MACHINE = { bodyScale: 0.78, boomLen: 4.8, armLen: 2.8, bucketLen: 0.68 };

// Building placed 8m in front of excavator (along +Z)
const BUILDING_OFFSET_Z = 8;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Auto-play cycle phases
const AUTO_PHASES = [
  { boomAngle: 15, armAngle: 85,  bucketAngle: 5,   swingAngle: 0  },
  { boomAngle: 5,  armAngle: 100, bucketAngle: 10,  swingAngle: 0  },
  { boomAngle: 50, armAngle: 40,  bucketAngle: -20, swingAngle: 60 },
  { boomAngle: 65, armAngle: 20,  bucketAngle: -80, swingAngle: 90 },
  { boomAngle: 35, armAngle: 60,  bucketAngle: -25, swingAngle: 0  },
];
const PHASE_DURATION = 2200;

function buildWsUrl() {
  if (process.env.REACT_APP_API_URL) {
    return `${process.env.REACT_APP_API_URL.replace(/\/$/, '')}/ws/sensor`;
  }
  if (process.env.NODE_ENV === 'development') {
    return `${window.location.protocol}//${window.location.hostname}:8080/ws/sensor`;
  }
  return `${window.location.origin}/ws/sensor`;
}

function latLngToXZ(lat, lng, originLat, originLng) {
  const dx = (lat - originLat) * 111111;
  const dz = (lng - originLng) * 111111 * Math.cos(originLat * D2R);
  return { x: dx, z: dz };
}

function computeArmPoints(st, machine) {
  const ms = machine.bodyScale;
  const totalRad    = (st.bodyRotation + st.swingAngle) * D2R;
  const boomRad     = st.boomAngle   * D2R;
  const armRad      = st.armAngle    * D2R;
  const bucketRad   = st.bucketAngle * D2R;
  const armAbsRad   = boomRad - armRad;
  const bucketAbsRad = armAbsRad - bucketRad;
  const sinT = Math.sin(totalRad);
  const cosT = Math.cos(totalRad);

  const baseY = st.positionY + 0.72 * ms;

  function worldPoint(localZ, localY) {
    return {
      x: st.positionX + sinT * localZ,
      y: baseY + localY,
      z: st.positionZ + cosT * localZ,
    };
  }

  const bpZ = 1.9 * ms, bpY = 1.4 * ms;
  const apZ = bpZ + machine.boomLen * Math.cos(boomRad);
  const apY = bpY + machine.boomLen * Math.sin(boomRad);
  const bkpZ = apZ + machine.armLen  * Math.cos(armAbsRad);
  const bkpY = apY + machine.armLen  * Math.sin(armAbsRad);
  const tipZ = bkpZ + machine.bucketLen * Math.cos(bucketAbsRad);
  const tipY = bkpY + machine.bucketLen * Math.sin(bucketAbsRad);

  return [
    worldPoint(bpZ,                       bpY),
    worldPoint(bpZ + (apZ-bpZ)*0.5,       bpY + (apY-bpY)*0.5),
    worldPoint(apZ,                       apY),
    worldPoint(apZ + (bkpZ-apZ)*0.5,      apY + (bkpY-apY)*0.5),
    worldPoint(bkpZ,                      bkpY),
    worldPoint(tipZ,                      tipY),
  ];
}

function TransparentBimElement({ element, offsetX, offsetZ, isColliding }) {
  // BIM 좌표 규칙: positionY=높이(→Three.js Y), positionZ=깊이(→Three.js Z)
  //               sizeY=높이크기(→Three.js Y), sizeZ=깊이크기(→Three.js Z)
  const size = useMemo(() => [
    Math.max(0.1, Number(element.sizeX)),
    Math.max(0.1, Number(element.sizeY)),  // Three.js height = BIM sizeY
    Math.max(0.1, Number(element.sizeZ)),  // Three.js depth  = BIM sizeZ
  ], [element.sizeX, element.sizeY, element.sizeZ]);

  const position = useMemo(() => [
    Number(element.positionX) + offsetX,
    Number(element.positionY) + offsetZ,       // Three.js Y = BIM positionY + bimOffset.z
    Number(element.positionZ) + size[1] / 2,  // Three.js Z = BIM positionZ + sizeY/2
  ], [element.positionX, element.positionY, element.positionZ, size, offsetX, offsetZ]);

  const rotation = useMemo(() => [
    Number(element.rotationX) || 0,
    Number(element.rotationY) || 0,
    Number(element.rotationZ) || 0,
  ], [element.rotationX, element.rotationY, element.rotationZ]);

  return (
      <Box args={size} position={position} rotation={rotation}>
        <meshStandardMaterial
            color={isColliding ? '#ff7777' : '#6699dd'}
            transparent
            opacity={isColliding ? 0.55 : 0.25}
            roughness={0.3}
            metalness={0.08}
            side={THREE.DoubleSide}
        />
        <Edges threshold={15} color={isColliding ? '#ff3333' : '#4477bb'} linewidth={isColliding ? 2.5 : 1.2} />
      </Box>
  );
}

function TrackRollers({ side }) {
  const x = side === 'left' ? -2.1 : 2.1;
  return (
      <>
        {[-2.2, -1.1, 0, 1.1, 2.2].map((z, i) => (
            <mesh key={i} position={[x, 0.04, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.27, 0.27, 0.52, 10]} />
              <meshStandardMaterial color="#1c1c1c" metalness={0.7} roughness={0.3} />
            </mesh>
        ))}
      </>
  );
}

function ExcavatorModel({ stateRef, machine }) {
  const s   = machine.bodyScale;
  const BL  = machine.boomLen   / s;
  const AL  = machine.armLen    / s;
  const buL = machine.bucketLen / s;

  const bodyRef   = useRef();
  const swingRef  = useRef();
  const boomRef   = useRef();
  const armRef    = useRef();
  const bucketRef = useRef();

  useFrame(() => {
    const cur = stateRef.current;
    if (bodyRef.current) {
      bodyRef.current.position.set(cur.positionX, cur.positionY, cur.positionZ);
      bodyRef.current.rotation.y = cur.bodyRotation * D2R;
    }
    if (swingRef.current)  swingRef.current.rotation.y  =  cur.swingAngle  * D2R;
    if (boomRef.current)   boomRef.current.rotation.x   = -cur.boomAngle   * D2R;
    if (armRef.current)    armRef.current.rotation.x    =  cur.armAngle    * D2R;
    if (bucketRef.current) bucketRef.current.rotation.x =  cur.bucketAngle * D2R;
  });

  return (
      <group ref={bodyRef}>
        <group scale={[s, s, s]}>
          <mesh position={[0, 0.36, 0]} castShadow receiveShadow>
            <boxGeometry args={[3.9, 0.72, 5.4]} />
            <meshStandardMaterial color="#3b4228" roughness={0.85} metalness={0.1} />
          </mesh>
          <mesh position={[-2.1, 0.37, 0]} castShadow>
            <boxGeometry args={[0.62, 0.60, 5.85]} />
            <meshStandardMaterial color="#191919" roughness={0.95} />
          </mesh>
          <mesh position={[2.1, 0.37, 0]} castShadow>
            <boxGeometry args={[0.62, 0.60, 5.85]} />
            <meshStandardMaterial color="#191919" roughness={0.95} />
          </mesh>
          <TrackRollers side="left" />
          <TrackRollers side="right" />
          {[-1, 1].map((sx, i) => (
              <mesh key={`idr${i}`} position={[sx*2.1, 0.37, 2.75]} rotation={[0,0,Math.PI/2]} castShadow>
                <cylinderGeometry args={[0.32, 0.32, 0.55, 12]} />
                <meshStandardMaterial color="#2a2a2a" metalness={0.6} />
              </mesh>
          ))}

          <group ref={swingRef} position={[0, 0.72, 0]}>
            <mesh position={[0, 0.72, 0.1]} castShadow receiveShadow>
              <boxGeometry args={[3.3, 1.44, 4.0]} />
              <meshStandardMaterial color="#f5a623" roughness={0.52} metalness={0.22} />
            </mesh>
            <mesh position={[-0.65, 1.92, -0.6]} castShadow>
              <boxGeometry args={[1.95, 1.85, 2.1]} />
              <meshStandardMaterial color="#f5a623" roughness={0.48} metalness={0.2} />
            </mesh>
            <mesh position={[-0.65, 2.05, 0.45]}>
              <boxGeometry args={[1.75, 0.85, 0.06]} />
              <meshStandardMaterial color="#88ccff" transparent opacity={0.42} />
            </mesh>
            <mesh position={[0.2, 0.7, -2.45]} castShadow>
              <boxGeometry args={[3.1, 0.95, 1.25]} />
              <meshStandardMaterial color="#282828" metalness={0.55} roughness={0.6} />
            </mesh>
            <mesh position={[0, 0, 0]} rotation={[Math.PI/2, 0, 0]}>
              <torusGeometry args={[1.4, 0.15, 8, 24]} />
              <meshStandardMaterial color="#444" metalness={0.8} />
            </mesh>

            <group position={[0, 1.4, 1.9]}>
              <group ref={boomRef}>
                <mesh position={[0, 0, BL/2]} castShadow>
                  <boxGeometry args={[0.58, 0.58, BL]} />
                  <meshStandardMaterial color="#d48810" roughness={0.48} metalness={0.38} />
                </mesh>
                <mesh position={[-0.35, -0.32, BL*0.38]} rotation={[0.32,0,0]} castShadow>
                  <cylinderGeometry args={[0.11, 0.11, BL*0.72, 8]} />
                  <meshStandardMaterial color="#888" metalness={0.85} roughness={0.2} />
                </mesh>

                <group position={[0, 0, BL]}>
                  <group ref={armRef}>
                    <mesh position={[0, 0, AL/2]} castShadow>
                      <boxGeometry args={[0.44, 0.44, AL]} />
                      <meshStandardMaterial color="#c07a0a" roughness={0.5} metalness={0.35} />
                    </mesh>

                    <group position={[0, 0, AL]}>
                      <group ref={bucketRef}>
                        <mesh position={[0, -0.2, buL*0.45]} castShadow>
                          <boxGeometry args={[1.38, 0.78, buL*1.05]} />
                          <meshStandardMaterial color="#6a6a6a" metalness={0.68} roughness={0.38} />
                        </mesh>
                        <mesh position={[0, -0.06, -0.06]} castShadow>
                          <boxGeometry args={[1.38, 0.58, 0.13]} />
                          <meshStandardMaterial color="#5a5a5a" metalness={0.72} />
                        </mesh>
                        {[-0.52, -0.18, 0.18, 0.52].map((x, i) => (
                            <mesh key={i} position={[x, -0.52, buL*0.88]} castShadow>
                              <boxGeometry args={[0.1, 0.14, buL*0.35]} />
                              <meshStandardMaterial color="#3a3a3a" metalness={0.88} />
                            </mesh>
                        ))}
                      </group>
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
  );
}

function CollisionDetector({ stateRef, machine, elementsRef, offsetRef, onCollisionRef }) {
  const prevColliding = useRef(false);
  const lastCall = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - lastCall.current < 80) return;
    lastCall.current = now;

    const elements = elementsRef.current;
    const offset   = offsetRef.current;
    if (!elements || elements.length === 0) {
      if (prevColliding.current) { prevColliding.current = false; onCollisionRef.current(false, []); }
      return;
    }

    const points = computeArmPoints(stateRef.current, machine);
    const collidingIds = [];
    const MARGIN = 0.35;

    for (const elem of elements) {
      // BIM 좌표 규칙: positionY=높이(Three.js Y), positionZ=깊이(Three.js Z)
      const cx = Number(elem.positionX) + offset.x;
      const cy = Number(elem.positionY) + offset.z;                 // Three.js Y center (BIM positionY + bimOffset.z)
      const cz = Number(elem.positionZ) + Number(elem.sizeY) / 2;  // Three.js Z
      const hx = Number(elem.sizeX) / 2 + MARGIN;
      const hy = Number(elem.sizeY) / 2 + MARGIN;  // Three.js Y half = BIM sizeY/2
      const hz = Number(elem.sizeZ) / 2 + MARGIN;  // Three.js Z half = BIM sizeZ/2

      let hit = false;
      for (const pt of points) {
        if (Math.abs(pt.x - cx) < hx && Math.abs(pt.y - cy) < hy && Math.abs(pt.z - cz) < hz) {
          hit = true;
          break;
        }
      }
      if (hit) collidingIds.push(elem.elementId);
    }

    const isColliding = collidingIds.length > 0;
    if (isColliding !== prevColliding.current) {
      prevColliding.current = isColliding;
      onCollisionRef.current(isColliding, collidingIds);
    }
  });

  return null;
}

function Ground() {
  return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#2e3a1a" roughness={0.95} />
      </mesh>
  );
}

// ================================================================
// Main TestDashboard
// ================================================================
export default function TestDashboard({ canvasFullscreen, onToggleCanvasFullscreen }) {
  const t = useT('gpsControl');
  const tb = useT('bimDashboard');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const rootContainerRef = useRef(null); // 최상위 Fullscreen API 구속 타깃 노드

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [state, setState] = useState({ ...DEFAULT_STATE });
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const [bimProjects, setBimProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [bimElements, setBimElements] = useState([]);
  const [loadingBim, setLoadingBim] = useState(false);
  const elementsRef = useRef([]);

  const [colliding, setColliding] = useState(false);
  const [collidingIds, setCollidingIds] = useState([]);
  const [collisionLog, setCollisionLog] = useState([]);
  const [alertPulse, setAlertPulse] = useState(true);
  const wasCollidingRef = useRef(false);

  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);
  const autoPhaseRef = useRef(0);

  const keysRef = useRef(new Set());
  const animRef = useRef(null);

  const [gpsConnected, setGpsConnected] = useState(false);
  const [lastGpsPacket, setLastGpsPacket] = useState(null);
  const [gpsPacketCount, setGpsPacketCount] = useState(0);
  const [gpsHz, setGpsHz] = useState(0);
  const [gpsError, setGpsError] = useState('');

  const gpsStompRef   = useRef(null);
  const gpsActiveRef  = useRef(false);
  const gpsOriginRef  = useRef(null);
  const gpsHzCountRef = useRef(0);
  const gpsHzTimerRef = useRef(null);

  // ─── [HTML5 하드웨어 Fullscreen 감지 이펙트 선언] ───
  useEffect(() => {
    const onFullscreenChange = () => {
      const isCurrentlyFull = !!document.fullscreenElement;
      if (isCurrentlyFull !== canvasFullscreen) {
        onToggleCanvasFullscreen?.();
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [canvasFullscreen, onToggleCanvasFullscreen]);

  // 스마트폰 브라우저 네비게이션 가림용 수동 풀스크린 요청 가이드
  const triggerMobileFullscreen = useCallback(() => {
    if (!rootContainerRef.current) return;
    if (!document.fullscreenElement) {
      rootContainerRef.current.requestFullscreen().catch(err => {
        console.error("모바일 전체화면 진입 거절됨:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleGpsData = useCallback((packet) => {
    if (gpsOriginRef.current === null && packet.lat != null && packet.lng != null) {
      gpsOriginRef.current = { lat: packet.lat, lng: packet.lng };
    }

    let posX = stateRef.current.positionX;
    let posZ = stateRef.current.positionZ;
    if (packet.lat != null && packet.lng != null && gpsOriginRef.current) {
      const { x, z } = latLngToXZ(packet.lat, packet.lng, gpsOriginRef.current.lat, gpsOriginRef.current.lng);
      posX = x;
      posZ = z;
    }

    let bodyRot = stateRef.current.bodyRotation;
    if (packet.heading != null) {
      bodyRot = packet.heading;
    } else if (packet.alpha != null) {
      bodyRot = packet.alpha;
    }

    let boom   = stateRef.current.boomAngle;
    let arm    = stateRef.current.armAngle;
    let bucket = stateRef.current.bucketAngle;
    let swing  = stateRef.current.swingAngle;

    if (packet.boomAngle != null) {
      boom = clamp(packet.boomAngle, JOINT_LIMITS.boomAngle.min, JOINT_LIMITS.boomAngle.max);
    } else if (packet.beta != null) {
      boom = clamp(packet.beta * 0.6 + 35, JOINT_LIMITS.boomAngle.min, JOINT_LIMITS.boomAngle.max);
    }

    if (packet.armAngle != null) {
      arm = clamp(packet.armAngle, JOINT_LIMITS.armAngle.min, JOINT_LIMITS.armAngle.max);
    }

    if (packet.bucketAngle != null) {
      bucket = clamp(packet.bucketAngle, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
    }

    if (packet.swingAngle != null) {
      swing = packet.swingAngle;
    } else if (packet.gamma != null) {
      swing = clamp(packet.gamma * 1.33, -120, 120);
    }

    stateRef.current = {
      positionX: posX, positionY: stateRef.current.positionY, positionZ: posZ,
      bodyRotation: bodyRot, swingAngle: swing, boomAngle: boom, armAngle: arm, bucketAngle: bucket,
    };

    setState({ ...stateRef.current });
    setLastGpsPacket(packet);
    setGpsPacketCount(c => c + 1);
    gpsHzCountRef.current++;
  }, []);

  const connectGps = useCallback(() => {
    if (gpsStompRef.current) return;
    setGpsError('');
    setAutoPlay(false);
    autoPlayRef.current = false;

    const client = new Client({
      webSocketFactory: () => new SockJS(buildWsUrl()),
      reconnectDelay: 3000,
      onConnect: () => {
        client.subscribe('/topic/gps/excavator', (msg) => {
          try {
            const packet = JSON.parse(msg.body);
            handleGpsData(packet);
          } catch (e) {
            console.warn('[GPS] parse error', e);
          }
        });
        setGpsConnected(true);
        gpsActiveRef.current = true;
        gpsHzTimerRef.current = setInterval(() => {
          setGpsHz(gpsHzCountRef.current);
          gpsHzCountRef.current = 0;
        }, 1000);
      },
      onDisconnect: () => {
        setGpsConnected(false);
        gpsActiveRef.current = false;
        clearInterval(gpsHzTimerRef.current);
        setGpsHz(0);
      },
      onStompError: (frame) => {
        setGpsError(t('errStomp', { msg: frame.headers?.message || t('errStompUnknown') }));
        setGpsConnected(false);
        gpsActiveRef.current = false;
      },
    });

    client.activate();
    gpsStompRef.current = client;
  }, [handleGpsData]);

  const disconnectGps = useCallback(() => {
    if (gpsStompRef.current) {
      gpsStompRef.current.deactivate();
      gpsStompRef.current = null;
    }
    clearInterval(gpsHzTimerRef.current);
    setGpsConnected(false);
    gpsActiveRef.current = false;
    gpsOriginRef.current = null;
    setLastGpsPacket(null);
    setGpsPacketCount(0);
    setGpsHz(0);
  }, []);

  const resetGpsOrigin = useCallback(() => {
    gpsOriginRef.current = null;
    setState(prev => ({ ...prev, positionX: 0, positionZ: 0 }));
    stateRef.current = { ...stateRef.current, positionX: 0, positionZ: 0 };
  }, []);

  useEffect(() => {
    return () => {
      if (gpsStompRef.current) gpsStompRef.current.deactivate();
      clearInterval(gpsHzTimerRef.current);
    };
  }, []);

  const bimOffset = useMemo(() => {
    if (bimElements.length === 0) return { x: 0, z: 0 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    bimElements.forEach(el => {
      // BIM positionY=평면Y(Three.js Z), sizeY=깊이크기(Three.js Z)
      const cx = Number(el.positionX), cz = Number(el.positionY);
      const hx = Number(el.sizeX)/2,   hz = Number(el.sizeY)/2;
      minX = Math.min(minX, cx - hx); maxX = Math.max(maxX, cx + hx);
      minZ = Math.min(minZ, cz - hz); maxZ = Math.max(maxZ, cz + hz);
    });
    return {
      x: -((minX + maxX) / 2),
      z: -minZ,
    };
  }, [bimElements]);

  const offsetRef = useRef(bimOffset);
  useEffect(() => { offsetRef.current = bimOffset; }, [bimOffset]);

  const onCollisionRef = useRef(null);
  onCollisionRef.current = useCallback((isColliding, ids) => {
    setColliding(isColliding);
    setCollidingIds(ids);
    if (isColliding && !wasCollidingRef.current) {
      const ts = new Date().toLocaleTimeString('ko-KR');
      setCollisionLog(prev => [{ ts, ids }, ...prev].slice(0, 8));

      pushWbsSuggest({
        eventType:   'COLLISION',
        source:      'TEST_COLLISION',
        title:       tb('collisionAlertTitle', { n: ids.length }),
        detail:      tb('collisionAlertDetail', { n: ids.length, ts }),
        projectId:   selectedProject?.projectId   ?? '',
        projectName: selectedProject?.projectName ?? '',
      });
    }
    wasCollidingRef.current = isColliding;
  }, [selectedProject]);

  useEffect(() => {
    AxiosCustom.get('/api/bim/projects')
        .then(res => setBimProjects(res.data || []))
        .catch(() => {});
  }, []);

  const handleSelectProject = useCallback((proj) => {
    setSelectedProject(proj);
    setLoadingBim(true);
    setBimElements([]);
    elementsRef.current = [];
    offsetRef.current = { x: 0, z: 0 };
    AxiosCustom.get(`/api/bim/project/${proj.projectId}`)
        .then(res => {
          const elems = Array.isArray(res.data) ? res.data : (res.data?.elements || []);
          // offsetRef를 elementsRef와 동시에 갱신 → 충돌 감지가 즉시 올바른 위치를 사용
          if (elems.length > 0) {
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            elems.forEach(el => {
              const cx = Number(el.positionX), cz = Number(el.positionY);
              const hx = Number(el.sizeX)/2,   hz = Number(el.sizeY)/2;
              minX = Math.min(minX, cx - hx); maxX = Math.max(maxX, cx + hx);
              minZ = Math.min(minZ, cz - hz); maxZ = Math.max(maxZ, cz + hz);
            });
            offsetRef.current = {
              x: -((minX + maxX) / 2),
              z: -minZ,
            };
          }
          setBimElements(elems);
          elementsRef.current = elems;
        })
        .catch(() => { setBimElements([]); elementsRef.current = []; offsetRef.current = { x: 0, z: 0 }; })
        .finally(() => setLoadingBim(false));
  }, []);

  useEffect(() => {
    if (!colliding) return;
    const id = setInterval(() => setAlertPulse(p => !p), 550);
    return () => clearInterval(id);
  }, [colliding]);

  useEffect(() => {
    const CTRL = new Set(['w','a','s','d','q','e','r','f','t','g','y','h','W','A','S','D','Q','E','R','F','T','G','Y','H']);
    const onDown = e => {
      if (gpsActiveRef.current) return;
      if (CTRL.has(e.key)) { e.preventDefault(); autoPlayRef.current = false; setAutoPlay(false); }
      keysRef.current.add(e.key);
    };
    const onUp = e => keysRef.current.delete(e.key);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);

  useEffect(() => {
    const MOVE = 0.07, ROT = 1.0, JOINT = 0.6;
    const tick = () => {
      if (!gpsActiveRef.current) {
        const keys = keysRef.current;
        if (keys.size > 0) {
          setState(prev => {
            const s = { ...prev };
            const cos = Math.cos(s.bodyRotation * D2R), sin = Math.sin(s.bodyRotation * D2R);
            if (keys.has('w') || keys.has('W')) { s.positionX += sin*MOVE; s.positionZ += cos*MOVE; }
            if (keys.has('s') || keys.has('S')) { s.positionX -= sin*MOVE; s.positionZ -= cos*MOVE; }
            const _rev = (keys.has('s') || keys.has('S')) ? -1 : 1;
            if (keys.has('a') || keys.has('A')) s.bodyRotation += ROT * _rev;
            if (keys.has('d') || keys.has('D')) s.bodyRotation -= ROT * _rev;
            if (keys.has('q') || keys.has('Q')) s.swingAngle -= JOINT * 1.8;
            if (keys.has('e') || keys.has('E')) s.swingAngle += JOINT * 1.8;
            if (keys.has('r') || keys.has('R')) s.boomAngle   = clamp(s.boomAngle   + JOINT, JOINT_LIMITS.boomAngle.min,   JOINT_LIMITS.boomAngle.max);
            if (keys.has('f') || keys.has('F')) s.boomAngle   = clamp(s.boomAngle   - JOINT, JOINT_LIMITS.boomAngle.min,   JOINT_LIMITS.boomAngle.max);
            if (keys.has('t') || keys.has('T')) s.armAngle    = clamp(s.armAngle    + JOINT, JOINT_LIMITS.armAngle.min,    JOINT_LIMITS.armAngle.max);
            if (keys.has('g') || keys.has('G')) s.armAngle    = clamp(s.armAngle    - JOINT, JOINT_LIMITS.armAngle.min,    JOINT_LIMITS.armAngle.max);
            if (keys.has('y') || keys.has('Y')) s.bucketAngle = clamp(s.bucketAngle + JOINT, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
            if (keys.has('h') || keys.has('H')) s.bucketAngle = clamp(s.bucketAngle - JOINT, JOINT_LIMITS.bucketAngle.min, JOINT_LIMITS.bucketAngle.max);
            return s;
          });
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  useEffect(() => {
    if (!autoPlay) return;
    autoPhaseRef.current = 0;
    let rafId = null;

    const phaseTick = () => {
      if (!gpsActiveRef.current) {
        const target = AUTO_PHASES[autoPhaseRef.current];
        setState(prev => ({
          ...prev,
          boomAngle:   prev.boomAngle   + (target.boomAngle   - prev.boomAngle)   * 0.025,
          armAngle:    prev.armAngle    + (target.armAngle    - prev.armAngle)    * 0.025,
          bucketAngle: prev.bucketAngle + (target.bucketAngle - prev.bucketAngle) * 0.025,
          swingAngle:  prev.swingAngle  + (target.swingAngle  - prev.swingAngle)  * 0.025,
        }));
      }
      rafId = requestAnimationFrame(phaseTick);
    };
    rafId = requestAnimationFrame(phaseTick);

    const phaseId = setInterval(() => {
      autoPhaseRef.current = (autoPhaseRef.current + 1) % AUTO_PHASES.length;
    }, PHASE_DURATION);

    return () => { if (rafId) cancelAnimationFrame(rafId); clearInterval(phaseId); };
  }, [autoPlay]);

  const handleReset = () => {
    setState({ ...DEFAULT_STATE });
    stateRef.current = { ...DEFAULT_STATE };
    setAutoPlay(false);
    autoPlayRef.current = false;
  };

  const panelBg     = '#0d1b2a';
  const panelBorder = '1px solid #253347';
  const secColor    = '#8896a4';
  const accentBlue  = '#60a5fa';
  const accentGreen = '#4ade80';
  const accentRed   = '#f87171';
  const gpsColor = gpsConnected ? accentGreen : (gpsError ? accentRed : secColor);

  const canvasContent = (
      <>
        <Sky sunPosition={[100, -30, 60]} turbidity={6} rayleigh={0.5} />
        <ambientLight intensity={0.5} />
        {/* Z-up 세계 좌표계: 태양/조명 위치는 world Z-up 기준 (Z=높이) */}
        <directionalLight
            position={[50, -30, 60]} intensity={1.2} castShadow
            shadow-mapSize-width={2048} shadow-mapSize-height={2048}
            shadow-camera-far={180} shadow-camera-left={-60}
            shadow-camera-right={60} shadow-camera-top={60} shadow-camera-bottom={-60}
        />
        <pointLight position={[-20, 5, 10]} intensity={0.3} color="#ff9944" />
        {/*
          Z축 위 좌표계: 내부 Y-up 씬 로직(굴착기 관절, 충돌, BIM 좌표 변환)을 그대로 유지하면서
          rotation={[Math.PI/2, 0, 0]} 그룹으로 시각적 Z축을 위로 회전.
          그룹 내부 Y(높이) → 월드 Z(위)  |  그룹 내부 Z(깊이) → 월드 -Y
        */}
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Ground />
          <gridHelper args={[80, 40, '#1a3a5f', '#0d2035']} position={[0, 0.01, 0]} />
          {bimElements.map(elem => (
              <TransparentBimElement
                  key={elem.elementId}
                  element={elem}
                  offsetX={bimOffset.x}
                  offsetZ={bimOffset.z}
                  isColliding={collidingIds.includes(elem.elementId)}
              />
          ))}
          <ExcavatorModel stateRef={stateRef} machine={MACHINE} />
        </group>
        <CollisionDetector
            stateRef={stateRef}
            machine={MACHINE}
            elementsRef={elementsRef}
            offsetRef={offsetRef}
            onCollisionRef={onCollisionRef}
        />
        <OrbitControls enableDamping dampingFactor={0.06} minDistance={4} maxDistance={120} maxPolarAngle={Math.PI / 2 - 0.01} />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.85} />
        </GizmoHelper>
      </>
  );

  return (
      /* 최상위 Fullscreen 모바일 가변 컨테이너 바인딩 */
      <div ref={rootContainerRef} style={{ display: 'flex', flexDirection: 'column', width: '100%', height: canvasFullscreen ? '100vh' : '85vh' }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          padding: '8px 14px 12px', borderBottom: '1px solid #1e3a5f', marginBottom: '10px',
        }}>
        <span style={{ color: '#f5a623', fontSize: isMobile ? '13px' : '15px', fontWeight: 700 }}>
          🧪 Test — Collision Test
        </span>
          <span style={{
            fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
            background: '#1a2a0a', color: '#f5a623', border: '1px solid #f5a62340',
          }}>Beta</span>

          {gpsConnected && (
              <span style={{
                background: 'rgba(4,47,46,0.9)', border: '1px solid #4ade80',
                color: accentGreen, borderRadius: '8px', padding: '3px 12px',
                fontSize: '12px', fontWeight: 700,
              }}>
            📡 GPS 실시간 제어 중 — {gpsHz}Hz
          </span>
          )}

          {colliding && (
              <span style={{
                background: alertPulse ? 'rgba(127,29,29,0.95)' : 'rgba(90,10,10,0.9)',
                border: `${alertPulse ? 2 : 1}px solid #ef4444`,
                color: '#fca5a5', borderRadius: '8px', padding: '3px 12px',
                fontSize: '12px', fontWeight: 700,
                boxShadow: alertPulse ? '0 0 12px #ef444450' : 'none',
                transition: 'all 0.3s',
              }}>
            🚨 Collision Detected!
          </span>
          )}
        </div>

        {/* ── Desktop Layout ── */}
        {!isMobile && (
            <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 175px)', gap: '10px', padding: '0 14px' }}>

              <div style={{
                width: '215px', flexShrink: 0, background: panelBg, border: panelBorder,
                borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column',
                gap: '10px', overflowY: 'auto', fontSize: '12px',
              }}>
                <div style={{ color: accentBlue, fontSize: '13px', fontWeight: 700, borderBottom: '1px solid #1e3a5f', paddingBottom: '8px', flexShrink: 0 }}>
                  🏗 BIM Project
                </div>

                {/* BIM 목록: 최대 50% 높이로 제한, 내부 스크롤 */}
                <div style={{ maxHeight: '50%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                {bimProjects.length === 0 ? (
                    <div style={{ color: '#3a4a5a', textAlign: 'center', padding: '20px 0', fontSize: '11px' }}>
                      No BIM Projects
                    </div>
                ) : (
                    bimProjects.map(proj => {
                      const active = selectedProject?.projectId === proj.projectId;
                      return (
                          <button
                              key={proj.projectId}
                              onClick={() => handleSelectProject(proj)}
                              style={{
                                background: active ? '#0f2040' : '#111e2e',
                                border: `1px solid ${active ? accentBlue : '#253347'}`,
                                borderRadius: '8px', padding: '8px 10px', cursor: 'pointer',
                                textAlign: 'left', width: '100%', transition: 'all 0.15s',
                              }}
                          >
                            <div style={{ color: active ? accentBlue : '#e2e8f0', fontWeight: active ? 700 : 400, fontSize: '12px', whiteSpace: 'nowrap',
                              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>
                              {proj.projectName}
                            </div>
                            <div style={{ color: '#4a5568', fontSize: '10px', marginTop: '2px' }}>{proj.structureType}</div>
                          </button>
                      );
                    })
                )}
                </div>{/* BIM 목록 스크롤 영역 끝 */}

                {selectedProject && (
                    <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
                      <div style={{ color: secColor, fontSize: '10px', marginBottom: '4px' }}>Loaded Elements</div>
                      {loadingBim
                          ? <div style={{ color: '#facc15', fontSize: '11px' }}>Loading...</div>
                          : <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '13px' }}>{bimElements.length}</div>
                      }
                    </div>
                )}

                <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px' }}>
                  <div style={{ color: '#a78bfa', fontSize: '11px', fontWeight: 700, marginBottom: '8px' }}>
                    {t('sectionTitle')}
                  </div>

                  <div style={{
                    background: gpsConnected ? '#042f2e' : '#111e2e',
                    border: `1px solid ${gpsConnected ? '#4ade8040' : '#253347'}`,
                    borderRadius: '8px', padding: '8px', marginBottom: '6px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: secColor, fontSize: '10px' }}>{t('statusLabel')}</span>
                      <span style={{ color: gpsColor, fontWeight: 700, fontSize: '11px' }}>
                    {gpsConnected ? t('connected') : t('standby')}
                  </span>
                    </div>
                    {gpsConnected && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                            <span style={{ color: secColor, fontSize: '10px' }}>{t('rxFreq')}</span>
                            <span style={{ color: accentGreen, fontFamily: 'monospace', fontSize: '10px' }}>{gpsHz} Hz</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                            <span style={{ color: secColor, fontSize: '10px' }}>{t('totalPackets')}</span>
                            <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '10px' }}>{gpsPacketCount}</span>
                          </div>
                        </>
                    )}
                    {gpsError && (
                        <div style={{ color: accentRed, fontSize: '10px', marginTop: '4px' }}>{gpsError}</div>
                    )}
                  </div>

                  {!gpsConnected ? (
                      <button
                          onClick={connectGps}
                          style={{
                            width: '100%', background: '#1a1040',
                            border: '1px solid #7c3aed', borderRadius: '8px', padding: '8px',
                            color: '#a78bfa', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                          }}
                      >
                        {t('connectBtn')}
                      </button>
                  ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button
                            onClick={resetGpsOrigin}
                            style={{
                              width: '100%', background: '#0f2a18',
                              border: '1px solid #22c55e', borderRadius: '8px', padding: '6px',
                              color: accentGreen, fontWeight: 700, fontSize: '11px', cursor: 'pointer',
                            }}
                        >
                          {t('resetOrigin')}
                        </button>
                        <button
                            onClick={disconnectGps}
                            style={{
                              width: '100%', background: '#1a0808',
                              border: '1px solid #ef4444', borderRadius: '8px', padding: '6px',
                              color: accentRed, fontWeight: 700, fontSize: '11px', cursor: 'pointer',
                            }}
                        >
                          {t('disconnect')}
                        </button>
                      </div>
                  )}

                  {gpsConnected && (
                      <div style={{
                        background: '#1a1040', border: '1px solid #7c3aed33',
                        borderRadius: '6px', padding: '7px', marginTop: '6px', fontSize: '10px',
                        color: '#a78bfa', lineheight: 1.5,
                      }}>
                        {t('kbLocked')}
                      </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: '10px' }}>
                  <div style={{ color: accentBlue, fontSize: '11px', fontWeight: 700, marginBottom: '8px' }}>⚙ Simulation</div>

                  <button
                      onClick={() => {
                        if (gpsConnected) return;
                        const next = !autoPlay; setAutoPlay(next); autoPlayRef.current = next;
                      }}
                      style={{
                        width: '100%',
                        background: autoPlay ? '#0f2a18' : '#111e2e',
                        border: `1px solid ${autoPlay ? '#22c55e' : '#253347'}`,
                        borderRadius: '8px', padding: '8px',
                        color: gpsConnected ? '#2a3a4a' : (autoPlay ? '#4ade80' : secColor),
                        fontWeight: 700, fontSize: '12px',
                        cursor: gpsConnected ? 'not-allowed' : 'pointer',
                        opacity: gpsConnected ? 0.45 : 1,
                      }}
                  >
                    {autoPlay ? '⏹ Stop Auto Mode' : '▶ Start Auto Mode'}
                  </button>

                  <button
                      onClick={handleReset}
                      style={{
                        width: '100%', background: '#111e2e', border: '1px solid #253347',
                        borderRadius: '8px', padding: '8px', marginTop: '6px',
                        color: secColor, fontSize: '12px', cursor: 'pointer',
                      }}
                  >
                    ↺ Reset
                  </button>
                </div>

                {collisionLog.length > 0 && (
                    <div style={{ background: '#1a0808', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '9px' }}>
                      <div style={{ color: '#fca5a5', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>📋 Collision Log</div>
                      {collisionLog.map((log, i) => (
                          <div key={i} style={{ fontSize: '10px', marginBottom: '5px', borderBottom: i < collisionLog.length-1 ? '1px solid #3a1a1a' : 'none', paddingBottom: '4px' }}>
                            <span style={{ color: '#ef4444', fontWeight: 700 }}>🚨 Collision Detected</span>
                            <br />
                            <span style={{ color: '#4a5568' }}>{log.ts}</span>
                            <br />
                            <span style={{ color: '#fca5a5' }}>{log.ids.length} elements in contact</span>
                          </div>
                      ))}
                    </div>
                )}
              </div>

              <div style={{
                flex: 1, height: '100%', borderRadius: '12px', overflow: 'hidden',
                border: colliding ? '2px solid #ef4444' : (gpsConnected ? '2px solid #4ade8060' : panelBorder),
                position: 'relative',
                boxShadow: colliding ? '0 0 0 1px #ef4444, 0 0 40px #ef444455' : (gpsConnected ? '0 0 0 1px #4ade8030' : 'none'),
                transition: 'box-shadow 0.3s, border-color 0.3s',
              }}>
                {colliding && (
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
                      background: alertPulse ? 'rgba(220,38,38,0.20)' : 'rgba(220,38,38,0.06)',
                      transition: 'background 0.4s', borderRadius: '10px',
                    }} />
                )}
                {colliding && (
                    <div style={{
                      position: 'absolute', top: '14px', left: '50%', transform: 'translateX(-50%)',
                      zIndex: 20, pointerEvents: 'none',
                      background: alertPulse ? 'rgba(127,29,29,0.97)' : 'rgba(100,20,20,0.94)',
                      border: `${alertPulse ? 2 : 1}px solid #ef4444`,
                      borderRadius: '10px', padding: '10px 28px',
                      color: '#fca5a5', fontSize: '14px', fontWeight: 700,
                      boxShadow: alertPulse ? '0 0 28px #ef444480, 0 0 60px #ef444430' : 'none',
                      transition: 'all 0.35s', whiteSpace: 'nowrap',
                    }}>
                      ⚠️ WARNING — Excavation equipment has contacted the structure!
                    </div>
                )}
                {!selectedProject && (
                    <div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      zIndex: 10, color: '#2a3a4a', textAlign: 'center', pointerEvents: 'none',
                    }}>
                      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏗</div>
                      <div style={{ fontSize: '14px' }}>Select a BIM project from the left panel</div>
                    </div>
                )}

                <div style={{
                  position: 'absolute', bottom: '12px', left: '12px', zIndex: 10, pointerEvents: 'none',
                  background: 'rgba(13,27,42,0.88)', border: `1px solid ${gpsConnected ? '#4ade8030' : '#253347'}`,
                  borderRadius: '10px', padding: '10px 14px', fontSize: '11px',
                  color: gpsConnected ? '#2a4a3a' : secColor, lineheight: 1.75,
                }}>
                  {gpsConnected ? (
                      <>
                        <div style={{ color: accentGreen, fontWeight: 700, marginBottom: '4px' }}>📡 GPS 제어 모드</div>
                        <div style={{ color: '#2a4a3a' }}>키보드 제어 비활성화됨</div>
                        <div style={{ color: '#2a4a3a' }}>센서 데이터로 굴착기 제어 중</div>
                      </>
                  ) : (
                      <>
                        <div style={{ color: accentBlue, fontWeight: 700, marginBottom: '4px' }}>⌨ Keyboard Controls</div>
                        {[['W / S','Forward / Backward'],['A / D','Body Rotation'],['Q / E','Swing ±'],['R / F','Boom Up/Down'],['T / G','Arm Bend'],['Y / H','Bucket Rotate']].map(([k,v]) => (
                            <div key={k} style={{ display: 'flex', gap: '8px' }}>
                              <span style={{ color: '#e2e8f0', minWidth: '52px', fontFamily: 'monospace' }}>{k}</span>
                              <span>{v}</span>
                            </div>
                        ))}
                      </>
                  )}
                </div>

                <div style={{
                  position: 'absolute', top: '12px', right: '12px', zIndex: 10, pointerEvents: 'none',
                  background: 'rgba(13,27,42,0.90)', border: '1px solid #253347',
                  borderRadius: '10px', padding: '8px 14px', fontSize: '12px', lineheight: 1.7,
                }}>
                  <div style={{ color: '#f5a623', fontWeight: 700 }}>🚜 0.6W Medium Excavator</div>
                  {selectedProject && <div style={{ color: secColor }}>🏗 {selectedProject.projectName}</div>}
                  <div style={{ color: gpsConnected ? accentGreen : (autoPlay ? '#4ade80' : secColor), fontSize: '11px' }}>
                    {gpsConnected ? `📡 GPS ${gpsHz}Hz` : (autoPlay ? '▶ Auto Mode Active' : '■ Manual Control')}
                  </div>
                  <div style={{ color: colliding ? '#ef4444' : '#4ade80', fontWeight: 700, marginTop: '4px' }}>
                    {colliding ? '● Collision' : '● Safe'}
                  </div>
                </div>

                {gpsConnected && lastGpsPacket && (
                    <div style={{
                      position: 'absolute', top: '12px', left: '12px', zIndex: 10, pointerEvents: 'none',
                      background: 'rgba(4,47,46,0.92)', border: '1px solid #4ade8040',
                      borderRadius: '10px', padding: '8px 12px', fontSize: '10px', lineheight: 1.7,
                      color: secColor, minWidth: '150px',
                    }}>
                      <div style={{ color: accentGreen, fontWeight: 700, marginBottom: '3px' }}>📡 GPS Live</div>
                      {lastGpsPacket.lat != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span>Lat / Lng</span>
                            <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
                      {lastGpsPacket.lat.toFixed(5)}, {lastGpsPacket.lng?.toFixed(5)}
                    </span>
                          </div>
                      )}
                      {lastGpsPacket.heading != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span>Heading</span>
                            <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{lastGpsPacket.heading?.toFixed(1)}°</span>
                          </div>
                      )}
                    </div>
                )}

                <Canvas shadows camera={{ position: [18, -14, 12], up: [0, 0, 1], fov: 52 }} style={{ background: '#131f2e', width: '100%', height: '100%' }}>
                  {canvasContent}
                </Canvas>
              </div>

              <div style={{
                width: '195px', flexShrink: 0, background: panelBg, border: panelBorder,
                borderRadius: '12px', padding: '14px', display: 'flex', flexDirection: 'column',
                gap: '10px', overflowY: 'auto', fontSize: '12px',
              }}>
                <div style={{ color: accentBlue, fontSize: '13px', fontWeight: 700, borderBottom: '1px solid #1e3a5f', paddingBottom: '8px' }}>
                  📊 Status Monitor
                </div>

                <div style={{
                  background: colliding ? (alertPulse ? 'rgba(127,29,29,0.6)' : 'rgba(90,15,15,0.5)') : '#0d1e10',
                  border: `1px solid ${colliding ? '#ef4444' : '#1a4a1a'}`,
                  borderRadius: '8px', padding: '10px', transition: 'all 0.35s',
                }}>
                  <div style={{ color: secColor, fontSize: '10px', marginBottom: '4px' }}>Collision Status</div>
                  <div style={{ color: colliding ? '#f87171' : '#4ade80', fontWeight: 700, fontSize: '16px' }}>
                    {colliding ? '🚨 Collision' : '✓ Safe'}
                  </div>
                </div>

                <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
                  <div style={{ color: secColor, fontSize: '10px', marginBottom: '6px' }}>Excavator Position (m)</div>
                  {[['X', state.positionX], ['Y', state.positionY], ['Z', state.positionZ]].map(([l, v]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                        <span style={{ color: secColor }}>{l}</span>
                        <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{Number(v).toFixed(1)}</span>
                      </div>
                  ))}
                </div>

                <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px' }}>
                  <div style={{ color: secColor, fontSize: '10px', marginBottom: '6px' }}>Joint Angles (°)</div>
                  {[
                    ['Body',   state.bodyRotation, '#94a3b8'],
                    ['Swing',  state.swingAngle,   '#a78bfa'],
                    ['Boom',   state.boomAngle,    accentBlue],
                    ['Arm',    state.armAngle,     '#34d399'],
                    ['Bucket', state.bucketAngle,  '#fb923c'],
                  ].map(([l, v, c]) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                        <span style={{ color: secColor }}>{l}</span>
                        <span style={{ color: c, fontFamily: 'monospace', fontWeight: 600 }}>{Math.round(v)}°</span>
                      </div>
                  ))}
                </div>

                <div style={{ background: '#111e2e', borderRadius: '8px', padding: '9px', fontSize: '10px' }}>
                  <div style={{ color: secColor, marginBottom: '6px', fontWeight: 700 }}>Legend</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <div style={{ width: '14px', height: '10px', background: '#6699dd', opacity: 0.5, border: '1px solid #4477bb', borderRadius: '2px' }} />
                    <span style={{ color: secColor }}>BIM Building</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '14px', height: '10px', background: '#f5a623', border: '1px solid #c07a0a', borderRadius: '2px' }} />
                    <span style={{ color: secColor }}>Excavator</span>
                  </div>
                </div>
              </div>

            </div>
        )}

        {/* ── Mobile Layout ── */}
        {isMobile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px' }}>

              <MobileGpsSender />

              <div style={{ background: panelBg, border: panelBorder, borderRadius: '10px', padding: '10px 12px' }}>
                <div style={{ color: accentBlue, fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                  🏗 BIM Project
                </div>
                {bimProjects.length === 0 ? (
                    <div style={{ color: '#3a4a5a', fontSize: '11px' }}>No BIM Projects</div>
                ) : (
                    <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                      {bimProjects.map(proj => {
                        const active = selectedProject?.projectId === proj.projectId;
                        return (
                            <button
                                key={proj.projectId}
                                onClick={() => handleSelectProject(proj)}
                                style={{
                                  flexShrink: 0, background: active ? '#0f2040' : '#111e2e',
                                  border: `1px solid ${active ? accentBlue : '#253347'}`,
                                  borderRadius: '8px', padding: '6px 12px', cursor: 'pointer',
                                  color: active ? accentBlue : '#e2e8f0',
                                  fontWeight: active ? 700 : 400, fontSize: '12px',
                                  whiteSpace: 'nowrap',
                                }}
                            >
                              {proj.projectName}
                            </button>
                        );
                      })}
                    </div>
                )}
              </div>

              <div style={{
                background: gpsConnected ? '#042f2e' : panelBg,
                border: `1px solid ${gpsConnected ? '#4ade8040' : '#253347'}`,
                borderRadius: '10px', padding: '10px 12px',
              }}>
                <div style={{ color: '#a78bfa', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                  {t('sectionTitle')}
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {!gpsConnected ? (
                      <button
                          onClick={connectGps}
                          style={{
                            flex: 1, background: '#1a1040', border: '1px solid #7c3aed',
                            borderRadius: '8px', padding: '9px 8px',
                            color: '#a78bfa', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                          }}
                      >
                        {t('connectBtn')}
                      </button>
                  ) : (
                      <>
                        <button
                            onClick={resetGpsOrigin}
                            style={{
                              flex: 1, background: '#0f2a18', border: '1px solid #22c55e',
                              borderRadius: '8px', padding: '9px 8px',
                              color: accentGreen, fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                            }}
                        >
                          {t('resetOrigin')}
                        </button>
                        <button
                            onClick={disconnectGps}
                            style={{
                              background: '#1a0808', border: '1px solid #ef4444',
                              borderRadius: '8px', padding: '9px 14px',
                              color: accentRed, fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                            }}
                        >
                          {t('disconnectShort')}
                        </button>
                      </>
                  )}
                  <div style={{ fontSize: '11px', color: gpsColor }}>
                    {gpsConnected ? t('connectedHz', { hz: gpsHz, count: gpsPacketCount }) : t('standby')}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    onClick={() => {
                      if (gpsConnected) return;
                      const next = !autoPlay; setAutoPlay(next); autoPlayRef.current = next;
                    }}
                    style={{
                      flex: 1, background: autoPlay ? '#0f2a18' : '#111e2e',
                      border: `1px solid ${autoPlay ? '#22c55e' : '#253347'}`,
                      borderRadius: '10px', padding: '11px 8px',
                      color: gpsConnected ? '#2a3a4a' : (autoPlay ? '#4ade80' : secColor),
                      fontWeight: 700, fontSize: '13px', cursor: gpsConnected ? 'not-allowed' : 'pointer',
                      opacity: gpsConnected ? 0.5 : 1,
                    }}
                >
                  {autoPlay ? '⏹ Stop Auto' : '▶ Auto Mode'}
                </button>
                <button onClick={handleReset} style={{ background: '#111e2e', border: '1px solid #253347', borderRadius: '10px', padding: '11px 18px', color: secColor, fontSize: '13px', cursor: 'pointer' }}>
                  ↺ Reset
                </button>
              </div>

              {/* 3D 캔버스 영역 */}
              <div style={{
                width: '100%',
                height: canvasFullscreen ? '100%' : 'clamp(320px, 45vh, 500px)',
                borderRadius: '12px', overflow: 'hidden',
                border: colliding ? '2px solid #ef4444' : (gpsConnected ? '2px solid #4ade8060' : panelBorder),
                position: 'relative',
                boxShadow: colliding ? '0 0 0 1px #ef4444, 0 0 30px #ef444455' : 'none',
                transition: 'box-shadow 0.3s, border-color 0.3s',
              }}>

                {/* ─── [모바일 전용 하드웨어 풀스크린 버튼 탑재] ─── */}
                <button
                    onClick={triggerMobileFullscreen}
                    title={canvasFullscreen ? '전체화면 해제' : '전체화면'}
                    style={{
                      position: 'absolute', top: 10, right: 10, zIndex: 30,
                      width: 34, height: 34,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 8, fontSize: 15, cursor: 'pointer',
                      backgroundColor: canvasFullscreen ? 'rgba(30,58,95,0.95)' : 'rgba(6,16,26,0.85)',
                      border: `1px solid ${canvasFullscreen ? '#3b82f6' : '#253347'}`,
                      color: canvasFullscreen ? '#60a5fa' : '#8896a4',
                      backdropFilter: 'blur(4px)',
                    }}
                >
                  {canvasFullscreen ? '⊠' : '⛶'}
                </button>

                {colliding && (
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none',
                      background: alertPulse ? 'rgba(220,38,38,0.20)' : 'rgba(220,38,38,0.06)',
                      transition: 'background 0.4s', borderRadius: '10px',
                    }} />
                )}
                {colliding && (
                    <div style={{
                      position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
                      zIndex: 20, pointerEvents: 'none',
                      background: alertPulse ? 'rgba(127,29,29,0.97)' : 'rgba(100,20,20,0.94)',
                      border: `${alertPulse ? 2 : 1}px solid #ef4444`,
                      borderRadius: '8px', padding: '7px 16px',
                      color: '#fca5a5', fontSize: '12px', fontWeight: 700,
                      boxShadow: alertPulse ? '0 0 20px #ef444470' : 'none',
                      transition: 'all 0.35s', whiteSpace: 'nowrap',
                    }}>
                      ⚠️ Collision Detected!
                    </div>
                )}
                {!selectedProject && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, color: '#2a3a4a', textAlign: 'center', pointerEvents: 'none' }}>
                      <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏗</div>
                      <div style={{ fontSize: '12px' }}>Select a BIM project above</div>
                    </div>
                )}

                <Canvas shadows camera={{ position: [18, -14, 12], up: [0, 0, 1], fov: 52 }} style={{ background: '#131f2e', width: '100%', height: '100%' }}>
                  {canvasContent}
                </Canvas>
              </div>

              <div style={{
                background: colliding ? (alertPulse ? 'rgba(127,29,29,0.55)' : 'rgba(90,15,15,0.45)') : '#0d1e10',
                border: `1px solid ${colliding ? '#ef4444' : '#1a4a1a'}`,
                borderRadius: '10px', padding: '10px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 0.35s',
              }}>
                <div>
                  <div style={{ color: secColor, fontSize: '10px' }}>Collision Status</div>
                  <div style={{ color: colliding ? '#f87171' : '#4ade80', fontWeight: 700, fontSize: '15px' }}>
                    {colliding ? `🚨 ${collidingIds.length} elements hit` : '✓ Safe'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: secColor, fontSize: '10px' }}>Control Mode</div>
                  <div style={{ color: gpsConnected ? accentGreen : (autoPlay ? '#4ade80' : '#3a4a5a'), fontWeight: 700, fontSize: '13px' }}>
                    {gpsConnected ? `GPS ${gpsHz}Hz` : (autoPlay ? `Phase ${autoPhaseRef.current + 1}/${AUTO_PHASES.length}` : 'Off')}
                  </div>
                </div>
              </div>

            </div>
        )}

      </div>
  );
}