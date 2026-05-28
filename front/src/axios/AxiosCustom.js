import axios from 'axios';

// ── REST API base ──────────────────────────────────────────────────────────
// 운영(DNS+HTTPS+nginx): '' → 상대경로, nginx가 /api/* → Spring Boot 프록시
// 개발: 접속한 hostname의 8080 포트 (localhost·IP 모두 대응)
const BASE = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'development'
      ? `http://${window.location.hostname}:8080`
      : '');

// ── WebSocket base (항상 절대 URL 필요) ────────────────────────────────────
// 운영: window.location.origin → wss://yourdomain.com, nginx가 /ws/* 프록시
// 개발: hostname:8080 절대 URL
export const WS_BASE = process.env.REACT_APP_API_URL
  ? process.env.REACT_APP_API_URL.replace(/\/$/, '')
  : (process.env.NODE_ENV === 'development'
      ? `http://${window.location.hostname}:8080`
      : window.location.origin);

const AxiosCustom = axios.create({
  baseURL: BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default AxiosCustom;
