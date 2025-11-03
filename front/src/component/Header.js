import { useEffect, useState } from "react";

export default function Header() {

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

    return (
        <header className="sticky top-0 z-30 backdrop-blur bg-space-900/80 border-b border-space-700">
            <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent-blue to-accent-green shadow-glow" />
                    <h1 className="text-xl md:text-2xl font-semibold tracking-wide">
                        Digital Twin • <span className="text-accent-blue">YJ-01</span>
                    </h1>
                </div>
                <div className="text-sm text-gray-400">
                    KTC {time}
                </div>
            </div>
        </header>
    )
}