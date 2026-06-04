import { useEffect, useRef, useState } from "react";
import { useLanguage, useT } from "../i18n/LanguageContext";

const NAV_IDS = [
  { id: "wbs",                 key: "wbs",        icon: "📊" },
  { id: "bim-projects",        key: "bim",        icon: "🏗" },
  { id: "simulation-projects", key: "simulation", icon: "🚜" },
  { id: "safe-projects",       key: "safe",       icon: "🦺" },
  { id: "test",                key: "test",       icon: "🧪" },
  { id: "agent",               key: "agent",      icon: "🤖" },
  { id: "settings",            key: "settings",   icon: "⚙️" },
];

const LANGS = ['en', 'ko', 'ja'];

export default function Header({ viewComponent, setViceComponent, agentAvailable, settingsAllowed }) {
  const { lang, setLang } = useLanguage();
  const t = useT('header');

  const [time, setTime] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const iconRef = useRef(null);

  useEffect(() => {
    let frame;
    let startTime;
    const animate = (ts) => {
      if (!startTime) startTime = ts;
      const hue = ((ts - startTime) / 1000 * 28) % 360;
      if (iconRef.current) {
        const h = (n) => `hsl(${((hue + n) % 360).toFixed(0)},100%,72%)`;
        iconRef.current.style.background =
          `conic-gradient(${h(0)},${h(55)},${h(110)},${h(165)},${h(220)},${h(275)},${h(0)})`;
        iconRef.current.style.boxShadow =
          `0 0 18px ${h(0)}, 0 0 8px ${h(55)}, 0 0 4px rgba(255,255,255,0.5)`;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  const NAV_ITEMS = NAV_IDS
    .filter(({ id }) => id !== 'settings' || settingsAllowed)
    .map(({ id, key, icon }) => ({ id, label: t(key), icon }));

  const TZ_MAP = { ko: { label: "KST", offset: 9 }, ja: { label: "JST", offset: 9 }, en: { label: "UST", offset: 0 } };
  const { label: tzLabel, offset: tzOffset } = TZ_MAP[lang] ?? TZ_MAP.ko;

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const local = new Date(now.getTime() + tzOffset * 60 * 60 * 1000);
      setTime(local.toISOString().replace("T", " ").slice(0, 19));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [tzOffset]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [menuOpen]);

  const activeTab = viewComponent === "bim"        ? "bim-projects"
    : viewComponent === "simulation"               ? "simulation-projects"
    : viewComponent === "safe"                     ? "safe-projects"
    : viewComponent;

  const isTabDisabled = (id) => id === 'agent' && agentAvailable === false;

  const handleNavClick = (id) => {
    if (isTabDisabled(id)) return;
    setViceComponent(id);
    setMenuOpen(false);
  };

  return (
    <header ref={menuRef} className="sticky top-0 z-30 backdrop-blur bg-space-900/80 border-b border-space-700"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>

      <div className="mx-auto w-full px-4 py-3 flex items-center justify-between gap-3">

        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div ref={iconRef} onClick={() => handleNavClick("wbs")} className="h-7 w-7 rounded-full flex-shrink-0 cursor-pointer" style={{
            willChange: 'background, box-shadow',
            transform: 'translateZ(0)',
            isolation: 'isolate',
            filter: 'saturate(1.3) brightness(1.15)',
          }} />
          <h1 className="text-base sm:text-xl font-semibold tracking-wide whitespace-nowrap">
            Digital Twin
          </h1>
        </div>

        {/* Desktop navigation (md+) */}
        {setViceComponent && (
            <nav className="hidden md:flex items-center gap-1 bg-[#0d1b2a] border border-[#253347] rounded-xl p-1">
              {NAV_ITEMS.map(({ id, label, icon }) => {
                const isActive = activeTab === id;
                const disabled = isTabDisabled(id);
                return (
                    <button
                        key={id}
                        onClick={() => handleNavClick(id)}
                        disabled={disabled}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150"
                        style={{
                          backgroundColor: isActive ? "#1e3a5f" : "transparent",
                          color: disabled ? "#4a5568" : isActive ? "#60a5fa" : "#8896a4",
                          border: isActive ? "1px solid #2a5080" : "1px solid transparent",
                          boxShadow: isActive ? "0 0 8px #2196f330" : "none",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                          maxWidth: "200px",
                          minWidth: "60px",
                          flexShrink: 1,
                        }}
                    >
                      <span className="text-base flex-shrink-0">{icon}</span>

                      <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            width: "100%"
                          }}
                      >
            {label}{disabled ? " " + t('offline') : ""}
          </span>
                    </button>
                );
              })}
            </nav>
        )}

        {/* Language switcher — 모바일 포함 항상 표시 (로고↔우측 사이 중앙) */}
        <div className="flex items-center gap-1 bg-[#0d1b2a] border border-[#253347] rounded-lg px-1 py-0.5">
          {LANGS.map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className="px-2 py-0.5 rounded text-xs font-semibold transition-all"
              style={{
                backgroundColor: lang === l ? "#1e3a5f" : "transparent",
                color: lang === l ? "#60a5fa" : "#8896a4",
                border: lang === l ? "1px solid #2a5080" : "1px solid transparent",
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">

          {/* Clock — desktop only */}
          <div className="hidden sm:block text-xs sm:text-sm text-gray-400 whitespace-nowrap">
            {tzLabel} {time}
          </div>

          {/* Hamburger button — mobile only */}
          {setViceComponent && (
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
              style={{ backgroundColor: menuOpen ? "#1e3a5f" : "transparent", border: "1px solid #253347" }}
              aria-label={t('toggleMenu')}
              aria-expanded={menuOpen}
            >
              <span className="text-gray-300 text-lg leading-none select-none">
                {menuOpen ? "✕" : "☰"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && setViceComponent && (
        <nav className="md:hidden border-t border-space-700 bg-[#0a1525]/97 backdrop-blur-lg">
          {NAV_ITEMS.map(({ id, label, icon }) => {
            const isActive = activeTab === id;
            const disabled = isTabDisabled(id);
            return (
              <button
                key={id}
                onClick={() => handleNavClick(id)}
                disabled={disabled}
                className="w-full flex items-center gap-4 px-6 py-4 text-sm font-semibold transition-colors border-b border-[#1a2a3a] last:border-0 active:bg-[#1e3a5f]"
                style={{
                  backgroundColor: isActive ? "#1a3050" : "transparent",
                  color: disabled ? "#4a5568" : isActive ? "#60a5fa" : "#8896a4",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <span className="text-2xl w-8 text-center">{icon}</span>
                <span className="flex-1 text-left text-base">{label}{disabled ? " " + t('offline') : ""}</span>
                {isActive && !disabled && (
                  <span className="w-2 h-2 rounded-full bg-accent-blue" />
                )}
              </button>
            );
          })}
          <div className="px-6 py-3 text-xs text-gray-500 border-t border-[#1a2a3a]">
            {tzLabel} {time}
          </div>
        </nav>
      )}
    </header>
  );
}
