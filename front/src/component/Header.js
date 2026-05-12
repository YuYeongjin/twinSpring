import { useEffect, useRef, useState } from "react";

const NAV_ITEMS = [
  { id: "",                    label: "IoT",        icon: "📡" },
  { id: "bim-projects",        label: "BIM",        icon: "🏗" },
  { id: "agent",               label: "Agent",      icon: "🤖" },
  { id: "simulation-projects", label: "Simulation", icon: "🚜" },
  { id: "safe",                label: "Safe",       icon: "🦺" },
];

export default function Header({ viewComponent, setViceComponent, agentAvailable }) {
  const [time, setTime] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      setTime(kst.toISOString().replace("T", " ").slice(0, 19));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // 메뉴 외부 클릭 시 닫기
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

        {/* 로고 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-accent-blue to-accent-green shadow-glow" />
          <h1 className="text-base sm:text-xl font-semibold tracking-wide whitespace-nowrap">
            Digital Twin <span className="text-accent-blue">YJ-01</span>
          </h1>
        </div>

        {/* 데스크탑 네비게이션 (md 이상) */}
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
                  }}
                >
                  <span className="text-base">{icon}</span>
                  <span>{label}{disabled ? " (offline)" : ""}</span>
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {/* 시계 — 데스크탑만 */}
          <div className="hidden sm:block text-xs sm:text-sm text-gray-400 whitespace-nowrap">
            KST {time}
          </div>

          {/* 햄버거 버튼 — 모바일만 */}
          {setViceComponent && (
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
              style={{ backgroundColor: menuOpen ? "#1e3a5f" : "transparent", border: "1px solid #253347" }}
              aria-label="메뉴 열기/닫기"
              aria-expanded={menuOpen}
            >
              <span className="text-gray-300 text-lg leading-none select-none">
                {menuOpen ? "✕" : "☰"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 모바일 드롭다운 메뉴 */}
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
                <span className="flex-1 text-left text-base">{label}{disabled ? " (offline)" : ""}</span>
                {isActive && !disabled && (
                  <span className="w-2 h-2 rounded-full bg-accent-blue" />
                )}
              </button>
            );
          })}
          <div className="px-6 py-3 text-xs text-gray-500 border-t border-[#1a2a3a]">
            KST {time}
          </div>
        </nav>
      )}
    </header>
  );
}
