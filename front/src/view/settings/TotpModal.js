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

const btn = (primary) => ({
  width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 14,
  fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
  background: primary ? '#1e3a5f' : 'transparent',
  border: `1px solid ${primary ? '#2a5080' : '#253347'}`,
  color: primary ? '#60a5fa' : '#6b7280',
});

export default function TotpModal({ onSuccess }) {
  // 'loading' | 'verify' | 'setup-loading' | 'setup' | 'setup-confirm'
  const [step, setStep] = useState('loading');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  // 상태 진입 시 input 포커스
  useEffect(() => {
    if (step === 'verify' || step === 'setup-confirm') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [step]);

  // TOTP 설정 여부 확인
  useEffect(() => {
    AxiosCustom.get('/api/auth/totp/status')
      .then(r => {
        if (r.data.configured) {
          setStep('verify');
        } else {
          // 미설정 상태: setup은 localhost에서만 가능
          setStep('setup-loading');
        }
      })
      .catch(() => setStep('verify'));
  }, []);

  // 설정 초기화: 비밀키 + QR URI 받기 (localhost에서만 성공)
  useEffect(() => {
    if (step !== 'setup-loading') return;
    setStep('setup-fetching');
    AxiosCustom.get('/api/auth/totp/setup')
      .then(async r => {
        setSecret(r.data.secret);
        const url = await QRCode.toDataURL(r.data.uri, { width: 200, margin: 2, color: { dark: '#e2e8f0', light: '#060f18' } });
        setQrDataUrl(url);
        setStep('setup');
      })
      .catch(e => {
        if (e.response?.status === 403) {
          setStep('forbidden-setup');
        } else {
          setError('QR 코드 생성 실패');
          setStep('verify');
        }
      });
  }, [step]);

  const handleCode = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    setError('');
    if (v.length === 6) submit(v);
  };

  const submit = async (c = code) => {
    if (c.length !== 6) return;
    setSubmitting(true);
    setError('');
    try {
      const endpoint = step === 'setup-confirm'
        ? '/api/auth/totp/setup/confirm'
        : '/api/auth/totp/verify';
      const r = await AxiosCustom.post(endpoint, { code: c });
      if (r.data.ok) {
        onSuccess();
      } else {
        setError('코드가 올바르지 않습니다. 30초 이내 코드를 입력하세요.');
        setCode('');
        inputRef.current?.focus();
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') submit();
  };

  // ── 접근 불가 (setup을 localhost 외에서 시도) ─────────────────────
  if (step === 'forbidden-setup') {
    return (
      <div style={overlay}>
        <div style={{ ...card }}>
          <p style={{ color: '#f59e0b', fontSize: 15, fontWeight: 700, marginBottom: 12 }}>⚠️ OTP 최초 설정 필요</p>
          <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 14 }}>
            OTP 등록은 서버에 직접 접속한 경우에만 가능합니다.
          </p>
          <p style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>아래 명령어로 포트포워딩 후 <code style={{ color: '#60a5fa' }}>http://localhost:8080</code> 에서 설정하세요:</p>
          <div style={{
            background: '#060f18', border: '1px solid #1e3a5f', borderRadius: 6,
            padding: '10px 12px', fontFamily: 'monospace', fontSize: 11,
            color: '#4ade80', lineHeight: 1.7, wordBreak: 'break-all',
          }}>
            kubectl port-forward -n twin \<br />
            &nbsp;&nbsp;pod/$(kubectl get pod -n twin \<br />
            &nbsp;&nbsp;-l app=twin-spring \<br />
            &nbsp;&nbsp;-o jsonpath='&#123;.items[0].metadata.name&#125;') \<br />
            &nbsp;&nbsp;8080:8080
          </div>
        </div>
      </div>
    );
  }

  // ── 로딩 ─────────────────────────────────────────────────────────
  if (step === 'loading' || step === 'setup-fetching') {
    return (
      <div style={overlay}>
        <div style={{ ...card, textAlign: 'center' }}>
          <p style={{ color: '#6b7280', fontSize: 13 }}>로딩 중...</p>
        </div>
      </div>
    );
  }

  // ── QR 코드 스캔 단계 ─────────────────────────────────────────────
  if (step === 'setup') {
    return (
      <div style={overlay}>
        <div style={card}>
          <h2 style={{ color: '#93c5fd', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            ⚙️ OTP 초기 설정
          </h2>
          <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 20 }}>
            Google Authenticator 또는 Authy 앱으로 QR을 스캔하세요.
          </p>

          {qrDataUrl && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <img src={qrDataUrl} alt="TOTP QR" style={{ width: 180, height: 180, borderRadius: 8 }} />
            </div>
          )}

          <p style={{ color: '#4b5563', fontSize: 11, marginBottom: 4 }}>QR 스캔이 안 될 경우 수동 입력:</p>
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

  // ── 코드 입력 단계 (설정 확정 or 로그인) ──────────────────────────
  const isSetupConfirm = step === 'setup-confirm';
  return (
    <div style={overlay}>
      <div style={card}>
        <h2 style={{ color: '#93c5fd', fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          {isSetupConfirm ? '⚙️ 설정 확인 코드 입력' : '🔐 환경설정 접근'}
        </h2>
        <p style={{ color: '#6b7280', fontSize: 12, marginBottom: 20 }}>
          {isSetupConfirm
            ? '앱에 표시된 6자리 코드를 입력하여 설정을 완료하세요.'
            : 'OTP 앱의 6자리 코드를 입력하세요.'}
        </p>

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          placeholder="000000"
          value={code}
          onChange={handleCode}
          onKeyDown={handleKeyDown}
          style={{ ...input6, opacity: submitting ? 0.5 : 1 }}
          disabled={submitting}
          maxLength={6}
        />

        {error && (
          <p style={{ color: '#ef4444', fontSize: 12, marginTop: 10, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button style={btn(true)} onClick={() => submit()} disabled={submitting || code.length !== 6}>
            {submitting ? '확인 중...' : '확인'}
          </button>

          {!isSetupConfirm && (
            <button style={{ ...btn(false), fontSize: 11 }} onClick={() => setStep('setup-loading')}>
              OTP 앱을 바꿨나요? 재설정
            </button>
          )}
          {isSetupConfirm && (
            <button style={{ ...btn(false), fontSize: 11 }} onClick={() => setStep('setup-loading')}>
              ← QR 코드로 돌아가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
