import axios from 'axios';

// 개발 환경에서 모바일 등 외부 기기로 접속할 때도 동작하도록
// window.location.hostname을 사용 (localhost → localhost, 192.168.x.x → 해당 IP)
const BASE = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'development'
      ? `http://${window.location.hostname}:8080`
      : '');

const AxiosCustom = axios.create({
  baseURL: BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const WS_BASE = BASE;

export default AxiosCustom;
