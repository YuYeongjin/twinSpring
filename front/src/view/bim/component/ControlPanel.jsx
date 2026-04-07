import React, { useState } from 'react';

// ── 랜드마크 구조물 생성 함수 ────────────────────────────────────────

function genTowerOfPisa() {
    const els = [];
    const floors = 8, floorH = 5.5, radius = 6.5, lean = 0.35;
    for (let f = 0; f < floors; f++) {
        const xOff = f * lean;
        for (let c = 0; c < 8; c++) {
            const a = (c / 8) * Math.PI * 2;
            els.push({
                elementType: 'IfcColumn', material: 'Concrete C40',
                sizeX: 1.0, sizeY: floorH, sizeZ: 1.0,
                positionX: Math.round((xOff + radius * Math.cos(a)) * 100) / 100,
                positionY: f * floorH,
                positionZ: Math.round(radius * Math.sin(a) * 100) / 100,
            });
        }
        els.push({
            elementType: 'IfcSlab', material: 'Concrete C35',
            sizeX: 15, sizeY: 0.4, sizeZ: 15,
            positionX: Math.round(xOff * 100) / 100,
            positionY: (f + 1) * floorH,
            positionZ: 0,
        });
    }
    // 종탑
    els.push({
        elementType: 'IfcSlab', material: 'Concrete C50',
        sizeX: 7, sizeY: 3.5, sizeZ: 7,
        positionX: Math.round(floors * lean * 100) / 100,
        positionY: floors * floorH,
        positionZ: 0,
    });
    return els;
}

function genEiffelTower() {
    return [
        // 1층 기초 교각 (4개, 넓게 벌림)
        { elementType: 'IfcPier',   material: 'Steel Grade A', sizeX: 3.0, sizeY: 20, sizeZ: 3.0, positionX: -18, positionY:  0,    positionZ: -18 },
        { elementType: 'IfcPier',   material: 'Steel Grade A', sizeX: 3.0, sizeY: 20, sizeZ: 3.0, positionX:  18, positionY:  0,    positionZ: -18 },
        { elementType: 'IfcPier',   material: 'Steel Grade A', sizeX: 3.0, sizeY: 20, sizeZ: 3.0, positionX: -18, positionY:  0,    positionZ:  18 },
        { elementType: 'IfcPier',   material: 'Steel Grade A', sizeX: 3.0, sizeY: 20, sizeZ: 3.0, positionX:  18, positionY:  0,    positionZ:  18 },
        // 1층 가로 브레이싱
        { elementType: 'IfcBeam',   material: 'Steel Grade A', sizeX: 39,  sizeY: 0.8, sizeZ: 0.8, positionX:  0, positionY: 10,    positionZ: -18 },
        { elementType: 'IfcBeam',   material: 'Steel Grade A', sizeX: 39,  sizeY: 0.8, sizeZ: 0.8, positionX:  0, positionY: 10,    positionZ:  18 },
        { elementType: 'IfcBeam',   material: 'Steel Grade A', sizeX: 0.8, sizeY: 0.8, sizeZ: 39,  positionX: -18, positionY: 10,   positionZ:   0 },
        { elementType: 'IfcBeam',   material: 'Steel Grade A', sizeX: 0.8, sizeY: 0.8, sizeZ: 39,  positionX:  18, positionY: 10,   positionZ:   0 },
        // 1층 플랫폼
        { elementType: 'IfcSlab',   material: 'Steel Grade A', sizeX: 40,  sizeY: 0.5, sizeZ: 40,  positionX:  0, positionY: 20,    positionZ:   0 },
        // 2층 기둥 (수렴)
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 2.0, sizeY: 18, sizeZ: 2.0, positionX: -11, positionY: 20.5, positionZ: -11 },
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 2.0, sizeY: 18, sizeZ: 2.0, positionX:  11, positionY: 20.5, positionZ: -11 },
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 2.0, sizeY: 18, sizeZ: 2.0, positionX: -11, positionY: 20.5, positionZ:  11 },
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 2.0, sizeY: 18, sizeZ: 2.0, positionX:  11, positionY: 20.5, positionZ:  11 },
        // 2층 플랫폼
        { elementType: 'IfcSlab',   material: 'Steel Grade A', sizeX: 26,  sizeY: 0.5, sizeZ: 26,  positionX:  0, positionY: 38.5, positionZ:   0 },
        // 3층 기둥 (더 수렴)
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 1.5, sizeY: 20, sizeZ: 1.5, positionX:  -5, positionY: 39,   positionZ:  -5 },
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 1.5, sizeY: 20, sizeZ: 1.5, positionX:   5, positionY: 39,   positionZ:  -5 },
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 1.5, sizeY: 20, sizeZ: 1.5, positionX:  -5, positionY: 39,   positionZ:   5 },
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 1.5, sizeY: 20, sizeZ: 1.5, positionX:   5, positionY: 39,   positionZ:   5 },
        // 3층 플랫폼
        { elementType: 'IfcSlab',   material: 'Steel Grade A', sizeX: 14,  sizeY: 0.5, sizeZ: 14,  positionX:  0, positionY: 59,   positionZ:   0 },
        // 정상 첨탑
        { elementType: 'IfcColumn', material: 'Steel Grade A', sizeX: 1.0, sizeY: 30, sizeZ: 1.0, positionX:   0, positionY: 59.5, positionZ:   0 },
    ];
}

function genPyramid() {
    const levels = [
        { s: 60, y: 0  }, { s: 50, y: 3  }, { s: 40, y: 6  },
        { s: 30, y: 9  }, { s: 22, y: 12 }, { s: 15, y: 15 },
        { s: 10, y: 18 }, { s:  6, y: 21 }, { s:  2, y: 24 },
    ];
    return levels.map(({ s, y }) => ({
        elementType: 'IfcSlab', material: 'Concrete C25',
        sizeX: s, sizeY: 3, sizeZ: s,
        positionX: 0, positionY: y, positionZ: 0,
    }));
}

function genBurjKhalifa() {
    // Y 모양 단면 + 계단식 세트백 구조 (단순화)
    const els = [];
    const setbacks = [
        { floors: 10, h: 5,   baseW: 14, arms: 3 },
        { floors:  8, h: 5,   baseW: 11, arms: 3 },
        { floors:  7, h: 4.5, baseW:  8, arms: 2 },
        { floors:  6, h: 4,   baseW:  6, arms: 2 },
        { floors:  4, h: 4,   baseW:  4, arms: 1 },
        { floors:  3, h: 4,   baseW:  3, arms: 1 },
    ];
    let yBase = 0;
    const angles = [0, 2.094, 4.189]; // 120도 간격 Y-wing
    setbacks.forEach(({ floors, h, baseW, arms }) => {
        const armAngles = angles.slice(0, arms === 3 ? 3 : 2);
        for (let f = 0; f < floors; f++) {
            // 중앙 코어
            els.push({
                elementType: 'IfcColumn', material: 'Concrete C60',
                sizeX: baseW * 0.5, sizeY: h, sizeZ: baseW * 0.5,
                positionX: 0, positionY: yBase + f * h, positionZ: 0,
            });
            // 날개 슬래브
            armAngles.forEach(angle => {
                const dist = baseW * 0.8;
                els.push({
                    elementType: 'IfcSlab', material: 'Concrete C50',
                    sizeX: baseW * 0.5, sizeY: 0.3, sizeZ: baseW,
                    positionX: Math.round(Math.cos(angle) * dist * 100) / 100,
                    positionY: yBase + f * h + h,
                    positionZ: Math.round(Math.sin(angle) * dist * 100) / 100,
                    rotationY: angle,
                });
            });
        }
        yBase += floors * h;
    });
    // 첨탑
    els.push({
        elementType: 'IfcColumn', material: 'Steel Grade A',
        sizeX: 1, sizeY: 60, sizeZ: 1,
        positionX: 0, positionY: yBase, positionZ: 0,
    });
    return els;
}

function genIncheonBridge() {
    const els = [];
    const tX = 42;          // 주탑 X 위치 (중심 기준)
    const tH = 25;          // 주탑 높이
    const tFH = 1.5;        // 기초 슬래브 높이
    const deckY = 9;        // 상판 하단 Y
    const deckH = 0.8;      // 상판 두께
    const deckCY = deckY + deckH / 2;   // 상판 중심 Y
    const tTopY = tFH + tH;             // 주탑 꼭대기 Y = 26.5
    const cAttY = tTopY - 1.5;          // 케이블 탑 부착점 Y = 25

    // 주탑 기초 슬래브
    [-tX, tX].forEach(tx => {
        els.push({ elementType:'IfcSlab', material:'Concrete C60', sizeX:10, sizeY:tFH, sizeZ:18, positionX:tx, positionY:0, positionZ:0 });
    });

    // 주탑 기둥 (A형: 탑당 앞·뒤 2개)
    [-tX, tX].forEach(tx => {
        [-4.5, 4.5].forEach(tz => {
            els.push({ elementType:'IfcColumn', material:'Concrete C60', sizeX:2, sizeY:tH, sizeZ:2, positionX:tx, positionY:tFH, positionZ:tz });
        });
    });

    // 주탑 수평 가로보 (상단 + 중간)
    [-tX, tX].forEach(tx => {
        els.push({ elementType:'IfcBeam', material:'Concrete C60', sizeX:1.2, sizeY:1.5, sizeZ:12, positionX:tx, positionY:tTopY - 1, positionZ:0 });
        els.push({ elementType:'IfcBeam', material:'Concrete C60', sizeX:1.2, sizeY:1.2, sizeZ:12, positionX:tx, positionY:12, positionZ:0 });
    });

    // 주경간 상판
    els.push({ elementType:'IfcSlab', material:'Prestressed Concrete', sizeX:tX * 2 + 4, sizeY:deckH, sizeZ:16, positionX:0, positionY:deckY, positionZ:0 });

    // 사장 케이블 (rotationZ 사용) — 각 탑 내측 4가닥 × 앞뒤 2열
    const anchorDists = [10, 20, 30, 38]; // 탑에서 내측으로의 거리
    [-1, 1].forEach(side => {
        const cz = side * 6.5;
        // 좌탑 (x = -tX) 내측 케이블
        anchorDists.forEach(d => {
            const ancX = -tX + d;
            const dx = ancX - (-tX);           // +d
            const dy = deckCY - cAttY;          // 음수 (아래 방향)
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);
            const midX = -tX + dx / 2;
            const midY = cAttY + dy / 2 - 0.125;
            els.push({ elementType:'IfcBeam', material:'Steel Grade A',
                sizeX: Math.round(len * 100) / 100, sizeY:0.25, sizeZ:0.25,
                positionX: Math.round(midX * 100) / 100,
                positionY: Math.round(midY * 100) / 100, positionZ: cz,
                rotationZ: Math.round(angle * 10000) / 10000 });
        });
        // 우탑 (x = +tX) 내측 케이블
        anchorDists.forEach(d => {
            const ancX = tX - d;
            const dx = ancX - tX;              // -d
            const dy = deckCY - cAttY;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);
            const midX = tX + dx / 2;
            const midY = cAttY + dy / 2 - 0.125;
            els.push({ elementType:'IfcBeam', material:'Steel Grade A',
                sizeX: Math.round(len * 100) / 100, sizeY:0.25, sizeZ:0.25,
                positionX: Math.round(midX * 100) / 100,
                positionY: Math.round(midY * 100) / 100, positionZ: cz,
                rotationZ: Math.round(angle * 10000) / 10000 });
        });
    });

    // 접속 교각 (양측 각 2기)
    [-73, -58].forEach(px => els.push({ elementType:'IfcPier', material:'Concrete C50', sizeX:5, sizeY:9, sizeZ:14, positionX:px, positionY:0, positionZ:0 }));
    [ 58,  73].forEach(px => els.push({ elementType:'IfcPier', material:'Concrete C50', sizeX:5, sizeY:9, sizeZ:14, positionX:px, positionY:0, positionZ:0 }));

    // 접속 상판
    els.push({ elementType:'IfcSlab', material:'Prestressed Concrete', sizeX:34, sizeY:deckH, sizeZ:16, positionX:-57.5, positionY:deckY, positionZ:0 });
    els.push({ elementType:'IfcSlab', material:'Prestressed Concrete', sizeX:34, sizeY:deckH, sizeZ:16, positionX: 57.5, positionY:deckY, positionZ:0 });

    return els;
}

// 정적 생성 (컴포넌트 외부, 한 번만 실행)
const _TOWER_OF_PISA   = genTowerOfPisa();
const _EIFFEL_TOWER    = genEiffelTower();
const _PYRAMID         = genPyramid();
const _BURJ_KHALIFA    = genBurjKhalifa();
const _INCHEON_BRIDGE  = genIncheonBridge();

/**
 * BIM 편집 도구 패널
 *
 * A. 부재 배치 — 클릭 시 "배치 모드"로 진입, 3D 뷰어에서 위치를 지정해 배치
 * B. 조작 모드 전환 — TransformControls 모드
 * C. 선택 모드 토글 — 러버밴드 드래그 다중 선택
 * D. 샘플 구조물 — 미리 정의된 구조물 일괄 배치
 */
export default function ControlPanel({
    startPlacement,
    pendingElement,
    cancelPlacement,
    currentMode,
    setMode,
    isSelectMode,
    toggleSelectMode,
    onPlaceSample,       // (elements) => void — 샘플 구조물 일괄 배치
    isPlacingSample,     // boolean — 샘플 배치 중
}) {

    const [showSamples, setShowSamples] = useState(false);

    const elementTemplates = [
        {
            label: '기둥', icon: '▮',
            color: 'bg-yellow-800/50 text-yellow-200 hover:bg-yellow-700/60',
            activeColor: 'bg-yellow-600/70 text-yellow-100 ring-1 ring-yellow-400',
            data: {
                elementType: 'IfcColumn', material: 'Concrete C30',
                sizeX: 0.5, sizeY: 6.0, sizeZ: 0.5,
            },
        },
        {
            label: '보', icon: '━',
            color: 'bg-gray-700/60 text-gray-200 hover:bg-gray-600/70',
            activeColor: 'bg-gray-500/70 text-white ring-1 ring-gray-300',
            data: {
                elementType: 'IfcBeam', material: 'Steel Grade A',
                sizeX: 8.0, sizeY: 0.5, sizeZ: 0.3,
            },
        },
        {
            label: '벽', icon: '▬',
            color: 'bg-slate-700/60 text-slate-200 hover:bg-slate-600/70',
            activeColor: 'bg-slate-500/70 text-white ring-1 ring-slate-300',
            data: {
                elementType: 'IfcWall', material: 'Concrete C25',
                sizeX: 0.2, sizeY: 3.0, sizeZ: 5.0,
            },
        },
        {
            label: '슬래브', icon: '▭',
            color: 'bg-blue-900/50 text-blue-200 hover:bg-blue-800/60',
            activeColor: 'bg-blue-600/70 text-white ring-1 ring-blue-400',
            data: {
                elementType: 'IfcSlab', material: 'Concrete C30',
                sizeX: 8.0, sizeY: 0.25, sizeZ: 8.0,
            },
        },
        {
            label: '교각', icon: '⬛',
            color: 'bg-orange-900/50 text-orange-200 hover:bg-orange-800/60',
            activeColor: 'bg-orange-600/70 text-white ring-1 ring-orange-400',
            data: {
                elementType: 'IfcPier', material: 'Concrete C50',
                sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0,
            },
        },
    ];

    const modes = [
        { key: 'translate', label: '이동', icon: '✥', shortcut: 'T' },
        { key: 'rotate',    label: '회전', icon: '↺', shortcut: 'R' },
        { key: 'scale',     label: '크기', icon: '⤢', shortcut: 'S' },
    ];

    // ── 샘플 구조물 정의 ─────────────────────────────────────────
    const sampleStructures = [
        {
            label: '단층 건물 골조',
            icon: '🏢',
            desc: '기둥 4개 + 보 4개 + 슬래브',
            color: 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/50',
            elements: [
                // 기둥 4개 (모서리)
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX: -4,  positionY: 0, positionZ: -4 },
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX:  4,  positionY: 0, positionZ: -4 },
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX: -4,  positionY: 0, positionZ:  4 },
                { elementType: 'IfcColumn', material: 'Concrete C30', sizeX: 0.5, sizeY: 4.0, sizeZ: 0.5, positionX:  4,  positionY: 0, positionZ:  4 },
                // 보 4개 (테두리, sizeY 기준 top)
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 8.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0,  positionY: 3.8, positionZ: -4 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 8.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0,  positionY: 3.8, positionZ:  4 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 8.5, positionX: -4,  positionY: 3.8, positionZ:  0 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 8.5, positionX:  4,  positionY: 3.8, positionZ:  0 },
                // 슬래브
                { elementType: 'IfcSlab', material: 'Concrete C30', sizeX: 8.5, sizeY: 0.25, sizeZ: 8.5, positionX:  0,  positionY: 4.2, positionZ:  0 },
            ],
        },
        {
            label: '2경간 교량',
            icon: '🌉',
            desc: '교각 3개 + 상부 슬래브',
            color: 'bg-orange-900/40 text-orange-200 hover:bg-orange-800/50',
            elements: [
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 2.5, sizeY: 8.0, sizeZ: 2.5, positionX: -20, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 2.5, sizeY: 8.0, sizeZ: 2.5, positionX:   0, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 2.5, sizeY: 8.0, sizeZ: 2.5, positionX:  20, positionY: 0, positionZ: 0 },
                { elementType: 'IfcSlab', material: 'Prestressed Concrete', sizeX: 42.0, sizeY: 1.0, sizeZ: 10.0, positionX: 0, positionY: 8.0, positionZ: 0 },
            ],
        },
        {
            label: '라멘 교각',
            icon: '⛩',
            desc: '교각 기둥 2개 + 캡 빔',
            color: 'bg-violet-900/40 text-violet-200 hover:bg-violet-800/50',
            elements: [
                { elementType: 'IfcPier', material: 'Concrete C40', sizeX: 2.0, sizeY: 8.0, sizeZ: 2.0, positionX: -6, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C40', sizeX: 2.0, sizeY: 8.0, sizeZ: 2.0, positionX:  6, positionY: 0, positionZ: 0 },
                { elementType: 'IfcBeam', material: 'Concrete C40', sizeX: 14.0, sizeY: 1.5, sizeZ: 2.5, positionX: 0, positionY: 8.0, positionZ: 0 },
            ],
        },
        {
            label: '3경간 교량',
            icon: '🏗',
            desc: '교각 4개 + 긴 슬래브',
            color: 'bg-sky-900/40 text-sky-200 hover:bg-sky-800/50',
            elements: [
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX: -30, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX: -10, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX:  10, positionY: 0, positionZ: 0 },
                { elementType: 'IfcPier', material: 'Concrete C50', sizeX: 3.0, sizeY: 10.0, sizeZ: 3.0, positionX:  30, positionY: 0, positionZ: 0 },
                { elementType: 'IfcSlab', material: 'Prestressed Concrete', sizeX: 64.0, sizeY: 1.2, sizeZ: 12.0, positionX: 0, positionY: 10.0, positionZ: 0 },
            ],
        },
        // ── 랜드마크 구조물 ──────────────────────────────────────────
        {
            label: '인천대교 사장교',
            icon: '🌉',
            desc: '사장 케이블 · A형 주탑 2기 · 접속경간 포함 · 33개 부재',
            color: 'bg-blue-900/40 text-blue-200 hover:bg-blue-800/50',
            elements: _INCHEON_BRIDGE,
        },
        {
            label: '피사의 사탑',
            icon: '🗼',
            desc: '8층 팔각 원형 타워 · 기울기 약 3.9° · 73개 부재',
            color: 'bg-amber-900/40 text-amber-200 hover:bg-amber-800/50',
            elements: _TOWER_OF_PISA,
        },
        {
            label: '에펠탑',
            icon: '🗽',
            desc: '3층 철골 타워 · 첨탑 포함 · 20개 부재',
            color: 'bg-gray-700/50 text-gray-200 hover:bg-gray-600/60',
            elements: _EIFFEL_TOWER,
        },
        {
            label: '이집트 피라미드',
            icon: '🔺',
            desc: '9단 계단식 피라미드 · 층별 크기 감소 · 9개 부재',
            color: 'bg-yellow-900/40 text-yellow-200 hover:bg-yellow-800/50',
            elements: _PYRAMID,
        },
        {
            label: '부르즈 할리파',
            icon: '🏙',
            desc: '세트백 Y형 초고층 · 날개 슬래브 + 첨탑',
            color: 'bg-cyan-900/40 text-cyan-200 hover:bg-cyan-800/50',
            elements: _BURJ_KHALIFA,
        },
        {
            label: '2층 건물 골조',
            icon: '🏬',
            desc: '기둥 4개 + 보 8개 + 슬래브 2개',
            color: 'bg-teal-900/40 text-teal-200 hover:bg-teal-800/50',
            elements: [
                // 기둥 4개 (2층 높이)
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX: -5, positionY: 0, positionZ: -5 },
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX:  5, positionY: 0, positionZ: -5 },
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX: -5, positionY: 0, positionZ:  5 },
                { elementType: 'IfcColumn', material: 'Concrete C35', sizeX: 0.5, sizeY: 8.0, sizeZ: 0.5, positionX:  5, positionY: 0, positionZ:  5 },
                // 1층 보 4개
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 3.8, positionZ: -5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 3.8, positionZ:  5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX: -5, positionY: 3.8, positionZ:  0 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX:  5, positionY: 3.8, positionZ:  0 },
                // 1층 슬래브
                { elementType: 'IfcSlab', material: 'Concrete C30', sizeX: 10.5, sizeY: 0.25, sizeZ: 10.5, positionX: 0, positionY: 4.2, positionZ: 0 },
                // 2층 보 4개
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 7.8, positionZ: -5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 10.5, sizeY: 0.4, sizeZ: 0.3, positionX:  0, positionY: 7.8, positionZ:  5 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX: -5, positionY: 7.8, positionZ:  0 },
                { elementType: 'IfcBeam', material: 'Steel Grade A', sizeX: 0.3, sizeY: 0.4, sizeZ: 10.5, positionX:  5, positionY: 7.8, positionZ:  0 },
                // 2층 슬래브 (지붕)
                { elementType: 'IfcSlab', material: 'Concrete C30', sizeX: 10.5, sizeY: 0.25, sizeZ: 10.5, positionX: 0, positionY: 8.2, positionZ: 0 },
            ],
        },
    ];

    return (
        <div className="space-y-4">

            {/* A. 부재 배치 버튼 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-400">새 부재 배치</p>
                    {pendingElement && (
                        <button
                            onClick={cancelPlacement}
                            className="text-xs text-red-400 hover:text-red-300 transition px-1.5 py-0.5 rounded border border-red-700/50"
                        >
                            ✕ 취소
                        </button>
                    )}
                </div>

                <div className="flex flex-col gap-1.5">
                    {elementTemplates.map(({ label, icon, color, activeColor, data }) => {
                        const isActive = pendingElement?.elementType === data.elementType;
                        return (
                            <button
                                key={data.elementType}
                                onClick={() =>
                                    isActive ? cancelPlacement() : startPlacement(data)
                                }
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                    isActive ? activeColor : color
                                }`}
                                title={isActive ? '배치 모드 취소' : `${label} 배치 시작`}
                            >
                                <span className="text-base leading-none">{icon}</span>
                                <span>{label}</span>
                                {isActive ? (
                                    <span className="ml-auto text-xs animate-pulse">📍 배치 중</span>
                                ) : (
                                    <span className="ml-auto text-xs opacity-40">{data.elementType.replace('Ifc', '')}</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {pendingElement && (
                    <p className="mt-2 text-xs text-blue-400 leading-relaxed">
                        3D 뷰어를 클릭하여 배치 &nbsp;•&nbsp; <kbd className="bg-black/30 px-1 rounded">ESC</kbd> 취소
                    </p>
                )}
            </div>

            {/* B. 조작 모드 */}
            <div className="border-t border-space-700 pt-3">
                <p className="text-xs font-medium text-gray-400 mb-2">조작 모드</p>
                <div className="flex flex-col gap-1.5">
                    {modes.map(({ key, label, icon, shortcut }) => (
                        <button
                            key={key}
                            onClick={() => setMode(key)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                currentMode === key
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                                    : 'bg-space-700/70 text-gray-300 hover:bg-space-600'
                            }`}
                        >
                            <span className="text-base leading-none">{icon}</span>
                            <span>{label}</span>
                            <kbd className="ml-auto text-xs bg-black/30 px-1 py-0.5 rounded opacity-60">{shortcut}</kbd>
                        </button>
                    ))}
                </div>
            </div>

            {/* C. 선택 모드 (러버밴드) */}
            <div className="border-t border-space-700 pt-3">
                <p className="text-xs font-medium text-gray-400 mb-2">다중 선택</p>
                <button
                    onClick={toggleSelectMode}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isSelectMode
                            ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/40'
                            : 'bg-space-700/70 text-gray-300 hover:bg-space-600'
                    }`}
                >
                    <span className="text-base leading-none">⬚</span>
                    <span>선택 모드</span>
                    <kbd className="ml-auto text-xs bg-black/30 px-1 py-0.5 rounded opacity-60">Q</kbd>
                </button>
                {isSelectMode ? (
                    <p className="mt-1.5 text-xs text-violet-400 leading-relaxed">
                        드래그로 영역 선택 &nbsp;•&nbsp; <kbd className="bg-black/30 px-1 rounded">Shift</kbd>+클릭 추가
                    </p>
                ) : (
                    <p className="mt-1.5 text-xs text-gray-600">
                        <kbd className="bg-black/30 px-1 rounded">Shift</kbd>+클릭으로 추가 선택
                    </p>
                )}
            </div>

            {/* D. 샘플 구조물 */}
            <div className="border-t border-space-700 pt-3">
                <button
                    onClick={() => setShowSamples(v => !v)}
                    className="w-full flex items-center justify-between mb-2 group"
                >
                    <p className="text-xs font-medium text-gray-400 group-hover:text-gray-200 transition">
                        샘플 구조물
                    </p>
                    <span className="text-xs text-gray-600 group-hover:text-gray-400 transition">
                        {showSamples ? '▲' : '▼'}
                    </span>
                </button>

                {showSamples && (
                    <div className="flex flex-col gap-1.5">
                        {sampleStructures.map(({ label, icon, desc, color, elements }) => (
                            <button
                                key={label}
                                onClick={() => onPlaceSample?.(elements)}
                                disabled={isPlacingSample}
                                className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left disabled:opacity-50 ${color}`}
                                title={desc}
                            >
                                <span className="text-base leading-none mt-0.5 shrink-0">{icon}</span>
                                <div className="min-w-0">
                                    <div className="font-semibold truncate">{label}</div>
                                    <div className="text-xs opacity-60 truncate">{desc}</div>
                                </div>
                                {isPlacingSample && (
                                    <span className="ml-auto shrink-0 animate-pulse text-xs">배치 중...</span>
                                )}
                            </button>
                        ))}
                        <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                            클릭하면 원점(0,0,0) 기준으로 배치됩니다
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
