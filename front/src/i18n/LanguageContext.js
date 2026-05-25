import { createContext, useCallback, useContext, useState } from 'react';
import { translations } from './translations';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState('ko');
  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * useT — 번역 함수 반환
 *
 * 🔧 핵심 수정: 이전에는 매 렌더마다 새 함수를 반환했기 때문에
 *   useCallback / useEffect 의존성 배열에 `t`가 포함된 컴포넌트에서
 *   무한 재렌더링 루프(카메라 start→stop→start…)가 발생했다.
 *   useCallback([lang, namespace])으로 감싸서 언어 변경 시에만 새 참조를 만든다.
 */
export function useT(namespace) {
  const { lang } = useLanguage();
  return useCallback((key, vars) => {
    const ns = translations[lang]?.[namespace] ?? translations['ko'][namespace] ?? {};
    let str = ns[key] ?? translations['ko'][namespace]?.[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      });
    }
    return str;
  }, [lang, namespace]); // lang·namespace 변경 시에만 새 함수 생성
}
