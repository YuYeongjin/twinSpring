/**
 * alertStore.js
 * ──────────────────────────────────────────────────────────────────
 * BIM / Safe 탭 등 여러 화면에서 발생한 알림을 localStorage에 영속 저장하고
 * CustomEvent로 구독자(WbsAlertLogPanel 등)에게 실시간 전파한다.
 *
 * 사용법:
 *   import { pushAlert, getAlerts, ALERT_EVENT } from '../utils/alertStore';
 *
 *   // 알림 등록 (어디서든 호출 가능)
 *   pushAlert({ source:'CRACK', severity:'HIGH', title:'균열 감지', detail:'...', projectId, projectName });
 *
 *   // 구독
 *   window.addEventListener(ALERT_EVENT, () => setAlerts(getAlerts()));
 * ──────────────────────────────────────────────────────────────────
 */

const STORAGE_KEY = 'dt_wbs_alerts';
const EVENT_NAME  = 'dt-alert-push';
const MAX_ITEMS   = 150;

/** @typedef {{ id:string, ts:string, source:'CRACK'|'SAFETY'|'BIM', severity:'HIGH'|'MEDIUM'|'LOW', title:string, detail:string, projectId:string, projectName:string, read:boolean, applied:boolean }} AlertItem */

// ── 내부 헬퍼 ────────────────────────────────────────────────────
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function save(arr) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

// ── 공개 API ─────────────────────────────────────────────────────

/**
 * 새 알림을 추가한다.
 * @param {{ source:string, severity?:string, title:string, detail?:string, projectId?:string, projectName?:string }} opts
 * @returns {AlertItem} 생성된 알림 객체
 */
export function pushAlert({ source, severity = 'MEDIUM', title, detail = '', projectId = '', projectName = '' }) {
  const item = {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ts:          new Date().toISOString(),
    source,
    severity,
    title,
    detail,
    projectId,
    projectName,
    read:        false,
    applied:     false,
  };
  const all = load();
  all.unshift(item);
  save(all.slice(0, MAX_ITEMS));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: item }));
  return item;
}

/** 전체 알림 목록 반환 */
export function getAlerts() {
  return load();
}

/** 특정 알림을 읽음 처리 */
export function markRead(id) {
  save(load().map(a => a.id === id ? { ...a, read: true } : a));
}

/** 모든 알림을 읽음 처리 */
export function markAllRead() {
  save(load().map(a => ({ ...a, read: true })));
}

/** 특정 알림을 "WBS 반영 완료" 처리 */
export function markApplied(id) {
  save(load().map(a => a.id === id ? { ...a, applied: true, read: true } : a));
}

/** 특정 알림 삭제 */
export function deleteAlert(id) {
  save(load().filter(a => a.id !== id));
}

/** 전체 알림 삭제 */
export function clearAll() {
  save([]);
}

/** 읽지 않은 알림 수 */
export function unreadCount() {
  return load().filter(a => !a.read).length;
}

/** CustomEvent 이름 (구독 시 사용) */
export const ALERT_EVENT = EVENT_NAME;
