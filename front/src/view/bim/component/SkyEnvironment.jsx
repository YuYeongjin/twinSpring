import React, { useEffect, useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Sky, Stars, Environment } from '@react-three/drei';
import * as THREE from 'three';

// ================================================================
// 환경 프리셋 정의
// ================================================================
export const ENV_PRESETS = [
    {
        id: 'none',
        label: '기본 (없음)',
        icon: '⬛',
        env: null,
        useEnvBg: false,
        useSky: false,
        useStars: false,
        bgColor: '#000000',
        fog: null,
        light: { ambientIntensity: 0.7, dirColor: '#ffffff', dirIntensity: 1.0, dirPos: [10, 10, 10] },
    },
    {
        id: 'city',
        label: '도시',
        icon: '🏙',
        env: 'city',
        useEnvBg: true,
        useSky: false,
        useStars: false,
        bgColor: null,
        fog: null,
        light: { ambientIntensity: 0.7, dirColor: '#ffffff', dirIntensity: 1.0, dirPos: [10, 10, 10] },
    },
    {
        id: 'day_clear',
        label: '맑은 낮',
        icon: '☀️',
        env: 'park',
        useEnvBg: false,
        useSky: true,
        useStars: false,
        bgColor: null,
        sunPosition: [200, 100, 100],
        turbidity: 0.3,
        rayleigh: 0.5,
        mieCoefficient: 0.002,
        mieDirectionalG: 0.99,
        fog: null,
        light: { ambientIntensity: 0.9, dirColor: '#fffbe8', dirIntensity: 2.5, dirPos: [30, 60, 20] },
    },
    {
        id: 'day_cloudy',
        label: '흐린 낮',
        icon: '⛅',
        env: 'apartment',
        useEnvBg: false,
        useSky: true,
        useStars: false,
        bgColor: null,
        sunPosition: [100, 60, 100],
        turbidity: 12,
        rayleigh: 3,
        mieCoefficient: 0.08,
        mieDirectionalG: 0.85,
        fog: { color: '#b8c8d8', density: 0.005 },
        light: { ambientIntensity: 0.8, dirColor: '#d8e8f0', dirIntensity: 1.2, dirPos: [10, 30, 10] },
    },
    {
        id: 'sunset',
        label: '저녁 노을',
        icon: '🌅',
        env: 'sunset',
        useEnvBg: false,
        useSky: true,
        useStars: false,
        bgColor: null,
        sunPosition: [100, 2, 100],
        turbidity: 10,
        rayleigh: 3,
        mieCoefficient: 0.05,
        mieDirectionalG: 0.92,
        fog: { color: '#ff6030', density: 0.005 },
        light: { ambientIntensity: 0.4, dirColor: '#ff8040', dirIntensity: 1.8, dirPos: [100, 8, 50] },
    },
    {
        id: 'dawn',
        label: '새벽 여명',
        icon: '🌄',
        env: 'dawn',
        useEnvBg: true,
        useSky: false,
        useStars: false,
        bgColor: null,
        fog: null,
        light: { ambientIntensity: 0.5, dirColor: '#ffd0a0', dirIntensity: 1.2, dirPos: [-80, 15, 50] },
    },
    {
        id: 'night',
        label: '밤하늘',
        icon: '🌙',
        env: 'night',
        useEnvBg: false,
        useSky: false,
        useStars: true,
        bgColor: '#04091a',
        fog: null,
        light: { ambientIntensity: 0.15, dirColor: '#8090ff', dirIntensity: 0.4, dirPos: [10, 30, 10] },
    },
    {
        id: 'ocean_day',
        label: '바다 (낮)',
        icon: '🌊',
        env: 'park',
        useEnvBg: false,
        useSky: true,
        useStars: false,
        useWater: true,
        waterColor: '#1a6fa0',
        bgColor: null,
        sunPosition: [150, 60, 100],
        turbidity: 2,
        rayleigh: 1.5,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.95,
        fog: { color: '#a0c8e0', density: 0.0015 },
        light: { ambientIntensity: 0.85, dirColor: '#fffbe8', dirIntensity: 2.2, dirPos: [20, 50, 20] },
    },
    {
        id: 'ocean_sunset',
        label: '바다 (노을)',
        icon: '🌅',
        env: 'sunset',
        useEnvBg: false,
        useSky: true,
        useStars: false,
        useWater: true,
        waterColor: '#8b4060',
        bgColor: null,
        sunPosition: [100, 3, 100],
        turbidity: 15,
        rayleigh: 4,
        mieCoefficient: 0.06,
        mieDirectionalG: 0.9,
        fog: { color: '#c06040', density: 0.002 },
        light: { ambientIntensity: 0.4, dirColor: '#ff7030', dirIntensity: 2.0, dirPos: [80, 5, 50] },
    },
    {
        id: 'ocean_night',
        label: '바다 (밤)',
        icon: '🌙',
        env: 'night',
        useEnvBg: false,
        useSky: false,
        useStars: true,
        useWater: true,
        waterColor: '#051530',
        bgColor: '#04091a',
        fog: { color: '#020810', density: 0.002 },
        light: { ambientIntensity: 0.12, dirColor: '#6080ff', dirIntensity: 0.3, dirPos: [10, 30, 10] },
    },
    {
        id: 'forest',
        label: '숲',
        icon: '🌲',
        env: 'forest',
        useEnvBg: true,
        useSky: false,
        useStars: false,
        bgColor: null,
        fog: { color: '#4a7040', density: 0.004 },
        light: { ambientIntensity: 0.6, dirColor: '#e8ffe0', dirIntensity: 1.0, dirPos: [10, 30, 10] },
    },
    {
        id: 'studio',
        label: '스튜디오',
        icon: '💡',
        env: 'studio',
        useEnvBg: true,
        useSky: false,
        useStars: false,
        bgColor: null,
        fog: null,
        light: { ambientIntensity: 1.2, dirColor: '#ffffff', dirIntensity: 0.8, dirPos: [5, 10, 5] },
    },
    {
        id: 'tunnel',
        label: '터널 공사',
        icon: '🚇',
        env: null,
        useEnvBg: false,
        useSky: false,
        useStars: false,
        useTunnel: true,
        bgColor: '#050505',
        fog: { color: '#0e0e0e', density: 0.022 },
        light: { ambientIntensity: 0.12, dirColor: '#ffcc88', dirIntensity: 0.2, dirPos: [0, 10, 0] },
    },
    {
        id: 'rain',
        label: '비오는 현장',
        icon: '🌧',
        env: 'apartment',
        useEnvBg: false,
        useSky: true,
        useStars: false,
        useRain: true,
        useWetGround: true,
        bgColor: null,
        sunPosition: [100, 8, 100],
        turbidity: 20,
        rayleigh: 5,
        mieCoefficient: 0.12,
        mieDirectionalG: 0.7,
        fog: { color: '#687880', density: 0.009 },
        light: { ambientIntensity: 0.5, dirColor: '#b8c8d4', dirIntensity: 0.65, dirPos: [10, 30, 10] },
    },
];

export const DEFAULT_ENV_ID = 'none';

// ================================================================
// 터널 공사 씬
// ================================================================
function TunnelScene() {
    const LIGHT_Z = useMemo(() => Array.from({ length: 9 }, (_, i) => i * 12 - 48), []);
    const FRAME_Z = useMemo(() => Array.from({ length: 7 }, (_, i) => i * 10 - 30), []);

    const concreteMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#2c2c2c', roughness: 0.93, metalness: 0.04, side: THREE.BackSide,
    }), []);
    const floorMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#212121', roughness: 0.97, metalness: 0.02,
    }), []);
    const steelMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#5a5a5a', metalness: 0.82, roughness: 0.3,
    }), []);
    const lampMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#ffffcc', emissive: '#ffaa20', emissiveIntensity: 5,
    }), []);

    return (
        <>
            {/* 터널 본체 — 원형 단면, 안쪽에서 렌더링 */}
            <mesh rotation={[Math.PI / 2, 0, 0]} material={concreteMat}>
                <cylinderGeometry args={[9, 9, 250, 48, 1, true]} />
            </mesh>

            {/* 콘크리트 바닥 슬래브 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} material={floorMat}>
                <planeGeometry args={[16, 250]} />
            </mesh>

            {/* 작업등 (천장부) */}
            {LIGHT_Z.map(z => (
                <group key={z} position={[0, 7.9, z]}>
                    <pointLight color="#ffd080" intensity={22} distance={24} decay={2} />
                    <mesh material={lampMat}>
                        <boxGeometry args={[0.65, 0.14, 0.65]} />
                    </mesh>
                </group>
            ))}

            {/* 강재 아치 지보재 */}
            {FRAME_Z.map(z => (
                <group key={z} position={[0, 0, z]}>
                    {/* 좌측 기둥 */}
                    <mesh position={[-7.6, 3.8, 0]} material={steelMat}>
                        <boxGeometry args={[0.22, 7.6, 0.22]} />
                    </mesh>
                    {/* 우측 기둥 */}
                    <mesh position={[7.6, 3.8, 0]} material={steelMat}>
                        <boxGeometry args={[0.22, 7.6, 0.22]} />
                    </mesh>
                    {/* 상단 횡보 */}
                    <mesh position={[0, 7.7, 0]} material={steelMat}>
                        <boxGeometry args={[15.4, 0.22, 0.22]} />
                    </mesh>
                    {/* 대각 브레이스 (좌) */}
                    <mesh position={[-4, 5.8, 0]} rotation={[0, 0, 0.42]} material={steelMat}>
                        <boxGeometry args={[0.14, 5.0, 0.14]} />
                    </mesh>
                    {/* 대각 브레이스 (우) */}
                    <mesh position={[4, 5.8, 0]} rotation={[0, 0, -0.42]} material={steelMat}>
                        <boxGeometry args={[0.14, 5.0, 0.14]} />
                    </mesh>
                </group>
            ))}

            {/* 터널 막장면 (어두운 전방 끝) */}
            <mesh position={[0, 4.2, -124]}>
                <planeGeometry args={[20, 10]} />
                <meshStandardMaterial color="#060606" roughness={1} />
            </mesh>

            {/* 굴착 방향 전조등 (막장 조명) */}
            <pointLight position={[0, 4, -110]} color="#ffeecc" intensity={8} distance={30} decay={2} />
        </>
    );
}

// ================================================================
// 비오는 현장 — 빗방울 줄기
// ================================================================
function RainScene() {
    const COUNT = 5000;
    const lineRef = useRef();

    const geometry = useMemo(() => {
        const geo = new THREE.BufferGeometry();
        const arr = new Float32Array(COUNT * 6); // 선분 1개 = 정점 2개 × xyz
        for (let i = 0; i < COUNT; i++) {
            const x = (Math.random() - 0.5) * 220;
            const y = Math.random() * 80;
            const z = (Math.random() - 0.5) * 220;
            arr[i * 6]     = x;
            arr[i * 6 + 1] = y;
            arr[i * 6 + 2] = z;
            arr[i * 6 + 3] = x + (Math.random() - 0.5) * 0.08;
            arr[i * 6 + 4] = y - 1.1; // 빗줄기 길이
            arr[i * 6 + 5] = z + (Math.random() - 0.5) * 0.08;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        return geo;
    }, []);

    useFrame(() => {
        if (!lineRef.current) return;
        const attr = lineRef.current.geometry.attributes.position;
        const arr = attr.array;
        for (let i = 0; i < COUNT; i++) {
            arr[i * 6 + 1] -= 0.58;
            arr[i * 6 + 4] -= 0.58;
            if (arr[i * 6 + 1] < -3) {
                const y = 76 + Math.random() * 4;
                arr[i * 6 + 1] = y;
                arr[i * 6 + 4] = y - 1.1;
            }
        }
        attr.needsUpdate = true;
    });

    return (
        <lineSegments ref={lineRef} geometry={geometry}>
            <lineBasicMaterial color="#8aaabb" transparent opacity={0.38} />
        </lineSegments>
    );
}

// ================================================================
// 젖은 지면 (비오는 날)
// ================================================================
function WetGroundScene() {
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
            <planeGeometry args={[300, 300]} />
            <meshStandardMaterial
                color="#1b2830"
                metalness={0.55}
                roughness={0.08}
                transparent
                opacity={0.82}
            />
        </mesh>
    );
}

// ================================================================
// SkyEnvironment 컴포넌트
// ================================================================
export default function SkyEnvironment({ preset }) {
    const { scene } = useThree();

    // 배경색 직접 설정 (bgColor 있는 프리셋용)
    useEffect(() => {
        if (preset.bgColor) {
            scene.background = new THREE.Color(preset.bgColor);
        } else if (!preset.useEnvBg && !preset.useSky) {
            scene.background = new THREE.Color('#1e293b');
        }
        // 안개 초기화
        if (!preset.fog) {
            scene.fog = null;
        }
    }, [preset, scene]);

    // fog를 Three.js 직접 설정
    useEffect(() => {
        if (preset.fog) {
            scene.fog = new THREE.FogExp2(preset.fog.color, preset.fog.density);
        }
        return () => {
            if (!preset.fog) scene.fog = null;
        };
    }, [preset.fog, scene]);

    return (
        <>
            {/* 배경색 (bgColor 프리셋용) */}
            {preset.bgColor && (
                <color attach="background" args={[preset.bgColor]} />
            )}

            {/* 스카이 박스 (태양 기반 물리 대기) */}
            {preset.useSky && (
                <Sky
                    distance={450000}
                    sunPosition={preset.sunPosition ?? [100, 50, 100]}
                    turbidity={preset.turbidity ?? 1}
                    rayleigh={preset.rayleigh ?? 0.5}
                    mieCoefficient={preset.mieCoefficient ?? 0.003}
                    mieDirectionalG={preset.mieDirectionalG ?? 0.99}
                />
            )}

            {/* 별 (밤 전용) */}
            {preset.useStars && (
                <Stars
                    radius={300}
                    depth={60}
                    count={6000}
                    factor={5}
                    saturation={0.1}
                    fade
                    speed={0.5}
                />
            )}

            {/* HDR 환경맵 (조명 + 배경) — preset.env가 없으면 렌더링 안 함 */}
            {preset.env && (
                <Environment
                    preset={preset.env}
                    background={preset.useEnvBg}
                />
            )}

            {/* 수면 (바다 배경 전용) */}
            {preset.useWater && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} receiveShadow>
                    <planeGeometry args={[3000, 3000, 1, 1]} />
                    <meshStandardMaterial
                        color={preset.waterColor ?? '#1a6fa0'}
                        metalness={0.15}
                        roughness={0.25}
                        transparent
                        opacity={0.92}
                    />
                </mesh>
            )}

            {/* 터널 공사 씬 */}
            {preset.useTunnel && <TunnelScene />}

            {/* 비오는 현장 — 빗방울 줄기 */}
            {preset.useRain && <RainScene />}

            {/* 젖은 지면 */}
            {preset.useWetGround && <WetGroundScene />}
        </>
    );
}
