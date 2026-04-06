import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
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
];

export const DEFAULT_ENV_ID = 'none';

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
        </>
    );
}
