// Mock detection responses for development/testing without a real detection server.

const CRACK_SCENARIOS = [
  {
    hasCrack: true, confidence: 0.87, method: 'cnn_demo',
    detail: '수직 균열 감지됨 (데모)',
    regions: [{ x1: 186, y1: 53, x2: 198, y2: 379 }, { x1: 365, y1: 82, x2: 384, y2: 350 }],
  },
  {
    hasCrack: false, confidence: 0.09, method: 'edge_demo',
    detail: '이상 없음 (데모)', regions: [],
  },
  {
    hasCrack: true, confidence: 0.63, method: 'edge_demo',
    detail: '수평 미세 균열 — 경미한 손상 (데모)',
    regions: [{ x1: 90, y1: 211, x2: 358, y2: 240 }],
  },
  {
    hasCrack: false, confidence: 0.14, method: 'cnn_demo',
    detail: '균열 없음 (데모)', regions: [],
  },
  {
    hasCrack: true, confidence: 0.79, method: 'cnn_demo',
    detail: '교차 균열 — 즉시 점검 필요 (데모)',
    regions: [
      { x1: 186, y1: 53, x2: 198, y2: 379 },
      { x1: 90, y1: 211, x2: 358, y2: 240 },
    ],
  },
  {
    hasCrack: false, confidence: 0.06, method: 'edge_demo',
    detail: '정상 (데모)', regions: [],
  },
];

const SAFETY_SCENARIOS = [
  {
    count: 3, fallback: false,
    detections: [
      { class: 'person',      confidence: 0.92, bbox: [100, 95,  205, 410] },
      { class: 'no-hard-hat', confidence: 0.85, bbox: [300, 75,  425, 385] },
      { class: 'person',      confidence: 0.78, bbox: [490, 115, 620, 450] },
    ],
  },
  {
    count: 2, fallback: false,
    detections: [
      { class: 'person', confidence: 0.91, bbox: [145, 120, 280, 445] },
      { class: 'person', confidence: 0.88, bbox: [395, 100, 520, 430] },
    ],
  },
  {
    count: 1, fallback: false,
    detections: [
      { class: 'no-hard-hat', confidence: 0.82, bbox: [215, 85, 375, 415] },
    ],
  },
  {
    count: 0, fallback: false, detections: [],
  },
  {
    count: 4, fallback: false,
    detections: [
      { class: 'person',      confidence: 0.95, bbox: [60,  110, 180, 440] },
      { class: 'no-hard-hat', confidence: 0.88, bbox: [220, 80,  355, 420] },
      { class: 'person',      confidence: 0.82, bbox: [380, 100, 490, 435] },
      { class: 'no-hard-hat', confidence: 0.76, bbox: [510, 90,  625, 450] },
    ],
  },
  {
    count: 1, fallback: false,
    detections: [
      { class: 'person', confidence: 0.89, bbox: [250, 100, 390, 440] },
    ],
  },
];

let crackIdx = 0;
let safetyIdx = 0;

function mockDelay() {
  return new Promise(r => setTimeout(r, 400 + Math.random() * 400));
}

export async function getMockCrackDetection() {
  await mockDelay();
  const s = CRACK_SCENARIOS[crackIdx % CRACK_SCENARIOS.length];
  crackIdx++;
  return { ...s, regions: [...(s.regions || [])].map(r => ({ ...r })) };
}

export async function getMockSafetyDetection() {
  await mockDelay();
  const s = SAFETY_SCENARIOS[safetyIdx % SAFETY_SCENARIOS.length];
  safetyIdx++;
  return {
    ...s,
    detections: (s.detections || []).map(d => ({ ...d, bbox: [...d.bbox] })),
  };
}
