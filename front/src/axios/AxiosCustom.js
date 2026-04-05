import axios from 'axios';

const BASE = process.env.NODE_ENV === 'development'
  ? 'http://localhost:8080'
  : '';

const AxiosCustom = axios.create({
  baseURL: BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const WS_BASE = BASE;

export default AxiosCustom;
