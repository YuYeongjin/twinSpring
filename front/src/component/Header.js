import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { id: "",             label: "IoT",  icon: "📡" },
  { id: "bim-projects", label: "BIM",  icon: "🏗" },
  { id: "ems",          label: "EMS",  icon: "⚡" },
];

export default function Header({ viewComponent, setViceComponent }) {

  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const iso = kst.toISOString().replace("T", " ").slice(0, 19);
      setTime(iso);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // 활성 탭 판단: 'bim' 뷰는 'bim-projects' 탭으로 인식
  const activeTab = viewComponent === "bim" ? "bim-projects" : viewComponent;

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-space-900/80 border-b border-space-700">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">

        {/* 로고 */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent-blue to-accent-green shadow-glow" />
          <h1 className="text-xl font-semibold tracking-wide whitespace-nowrap">
            Digital Twin • <span className="text-accent-blue">YJ-01</span>
          </h1>
        </div>

        {/* 네비게이션 탭 */}
        {setViceComponent && (
          <nav className="flex items-center gap-1 bg-[#0d1b2a] border border-[#253347] rounded-xl p-1">
            {NAV_ITEMS.map(({ id, label, icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setViceComponent(id)}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150"
                  style={{
                    backgroundColor: isActive ? "#1e3a5f" : "transparent",
                    color: isActive ? "#60a5fa" : "#8896a4",
                    border: isActive ? "1px solid #2a5080" : "1px solid transparent",
                    boxShadow: isActive ? "0 0 8px #2196f330" : "none",
                  }}
                >
                  <span className="text-base">{icon}</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* 시계 */}
        <div className="text-sm text-gray-400 whitespace-nowrap shrink-0">
          KST {time}
        </div>
      </div>
    </header>
  );
}
