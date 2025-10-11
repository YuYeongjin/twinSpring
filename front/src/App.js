import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/BimDashboard';
import SatelliteDashboard from './view/SatelliteDashboard';
import { useEffect, useState } from 'react';

function App() {

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  const [viewComponent, setViceComponent] = useState('');
  return (
    <div className="min-h-screen bg-space-900 text-gray-200">
      {/* Top Bar */}
      <Header />

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {
          viewComponent && viewComponent === 'bim' ?
            <BimDashboard />
            :

            <SatelliteDashboard setViceComponent={setViceComponent} />
        }
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;
