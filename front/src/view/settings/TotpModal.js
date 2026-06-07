import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import AxiosCustom from '../../axios/AxiosCustom';

const overlay = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'rgba(6,15,24,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const card = {
  background: '#0a1525', border: '1px solid #1e3a5f',
  borderRadius: 16, padding: '32px 28px', width: 340, maxWidth: '92vw',
};

const input6 = {
  width: '100%', background: '#060f18', border: '1px solid #253347',
  borderRadius: 8, color: '#e2e8f0', fontSize: 28, fontWeight: 700,
  letterSpacing: 10, textAlign: 'center', padding: '10px 0',
  outline: 'none', boxSizing: 'border-box',
};

const inputText = {
  width: '100%', background: '#060f18', border: '1px solid #253347',
  borderRadius: 8, color: '#e2e8f0', fontSize: 14,
  padding: '10px 12px', outline: 'none', boxSizing: 'border-box',
};

const btn = (primary) => ({
  width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 14,
  fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
  background: primary ? '#1e3a5f' : 'transparent',
  border: `1px solid ${primary ? '#2a5080' : '#253347'}`,
  color: primary ? '#60a5fa' : '#6b7280',
});

export default function TotpModal({ onSuccess }) {
  // loading | setup-password | setup-fetching | setup | setup-confirm | verify | reset-confirm
  const [step, setStep] = useState('loading');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const pwRef = useRef(null);

  useEffect(() => {
    if (['verify', 'setup-confirm', 'reset-confirm'].includes(step)) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (step === 'setup-password') {
      setTimeout(() => pwRef.current?.focus(), 50);
    }
  }, [step]);

  // TOTP 설정 여부 확인
  useEffect(() => {
    AxiosCustom.get('/api/auth/totp/status')
      .then(r => setStep(r.data.configured ? 'verify' : 'setup-password'))
      .catch(() => setStep('verify'));
  }, []);

  // 비밀번호 입력 후 QR 발급 요청
  const handleSetupPassword = async () => {
    if (!password) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await AxiosCustom.post('/api/auth/totp/setup', { password });
      setSecret(r.data.secret);
      const url = await QRCode.toDataURL(r.data.uri, {
        width: 200, margin: 2,
        color: { dark: '#e2e8f0', light: '#060f18' },
      });
      setQrDataUrl(url);
      setStep('setup');
    } catch (e) {
      if (e.response?.status === 401) setError('비밀번호가 올바르지 않습니다.');
      else if (e.response?.status === 409) setError('이미 OTP가 등록되어 있습니다.');
      else setError('오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCode = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    setError('');
    if (v.length === 6) submitCode(v);
  };

  const submitCode = async (c = code) => {
    if (c.length !== 6) return;
    setSubmitting(true);
    setError('');
    try {
      const endpoint =
        step === 'setup-confirm' ? '/api/auth/totp/setup/confirm' :
        step === 'reset-confirm' ? '/api/auth/totp/reset' :
        '/api/auth/totp/verify';

      const r = await AxiosCustom.post(endpoint, { code: c });

      if (r.data.ok) {
        if (step === 'reset-confirm') {
          setCode(''); setPassword('');
          setStep('setup-password');
        } else {
          onSuccess();
        }
      } else {
        setError('코드가 올바르지 않습니다.');
        setCode('');
        inputRef.current?.focus();
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── 로딩 ──────────────────────────────────────────────────────────
  if (step === 'loading' || step === 'setup-fetching') {
    return (
      <div style={overlay}>
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: '#6b7280', fontSize: 13 }}>로딩 중...</p>
        </div>
      </div>
    );
  }

  // ── 초기 설정 비밀번호 입력 ────────────────────────────────────────
  if (step === 'setup-password') {
    return (
      <div style={overlay}>
        <div style={card}>
          <h2 style={{ color: '#93c5fd', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            ⚙️ OTP 초기 설정
          </h2>
          <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 20 }}>
            설정 비밀번호를 입력하면 QR 코드를 발급합니다.
          </p>
          <input
            ref={pwRef}
            type="password"
            placeholder="설정 비밀번호"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleSetupPassword()}
            style={inputText}
            disabled={submitting}
          />
          {error && (
            <p style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</p>
          )}
          <div style={{ marginTop: 16 }}>
            <button style={btn(true)} onClick={handleSetupPassword} disabled={submitting || !password}>
              {submitting ? '확인 중...' : 'QR 코드 발급'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── QR 스캔 화면 ──────────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <div style={overlay}>
        <div style={card}>
          <h2 style={{ color: '#93c5fd', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            ⚙️ OTP 등록
          </h2>
          <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 20 }}>
            Google Authenticator 또는 Authy 앱으로 QR을 스캔하세요.
          </p>
          {qrDataUrl && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <img src={qrDataUrl} alt="TOTP QR" style={{ width: 180, height: 180, borderRadius: 8 }} />
            </div>
          )}
          <p style={{ color: '#4b5563', fontSize: 11, marginBottom: 4 }}>수동 입력 키:</p>
          <div style={{
            background: '#060f18', border: '1px solid #253347', borderRadius: 6,
            padding: '7px 10px', fontFamily: 'monospace', fontSize: 12,
            color: '#60a5fa', wordBreak: 'break-all', marginBottom: 20,
          }}>
            {secret}
          </div>
          <button style={btn(true)} onClick={() => { setCode(''); setStep('setup-confirm'); }}>
            스캔 완료 → 코드 확인
          </button>
        </div>
      </div>
    );
  }

  // ── 코드 입력 화면 ────────────────────────────────────────────────
  const isSetupConfirm = step === 'setup-confirm';
  const isReset = step === 'reset-confirm';

  const title = isSetupConfirm ? '⚙️ 설정 확인'
    : isReset ? '🔄 OTP 재설정'
    : '🔐 환경설정 접근';

  const desc = isSetupConfirm ? '앱에 표시된 6자리 코드를 입력하여 등록을 완료하세요.'
    : isReset ? '현재 OTP 코드를 입력하면 초기화 후 재설정 화면으로 이동합니다.'
    : 'OTP 앱의 6자리 코드를 입력하세요.';

  return (
    <div style={overlay}>
      <div style={card}>
        <h2 style={{ color: '#93c5fd', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{title}</h2>
        <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 20 }}>{desc}</p>

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          placeholder="000000"
          value={code}
          onChange={handleCode}
          onKeyDown={e => e.key === 'Enter' && submitCode()}
          style={{ ...input6, opacity: submitting ? 0.5 : 1 }}
          disabled={submitting}
          maxLength={6}
        />

        {error && (
          <p style={{ color: '#ef4444', fontSize: 12, marginTop: 10, textAlign: 'center' }}>{error}</p>
        )}

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button style={btn(true)} onClick={() => submitCode()} disabled={submitting || code.length !== 6}>
            {submitting ? '확인 중...' : '확인'}
          </button>
          {isSetupConfirm && (
            <button style={{ ...btn(false), fontSize: 11 }} onClick={() => setStep('setup')}>
              ← QR 코드로 돌아가기
            </button>
          )}
          {isReset && (
            <button style={{ ...btn(false), fontSize: 11 }} onClick={() => { setCode(''); setError(''); setStep('verify'); }}>
              ← 취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
