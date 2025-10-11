import axios from 'axios';
import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/bim/BimDashboard';
import SatelliteDashboard from './view/SatelliteDashboard';
import { useEffect, useState } from 'react';

function App() {

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  const [viewComponent, setViceComponent] = useState('');


  const [modelData, setModelData] = useState(null);
  const [loading, setLoading] = useState(true);
  const projectId = "P-101"; // 가상 프로젝트 ID

  useEffect(() => {
    // Spring API 호출
    axios.get(`http://localhost:8080/api/bim/model?projectId=${projectId}`)
      .then(response => {
        setModelData(response.data);
        // setElements(response.data);
        setLoading(false);
      })
      .catch(error => {
        console.error("Error fetching BIM data from Spring:", error);
        setLoading(false);
      });

  }, [viewComponent]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}>Loading 3D Model...</div>;
  }

  if (!modelData || !modelData.elements || modelData.elements.length === 0) {
    return <div style={{ textAlign: 'center', padding: '50px' }}>No BIM data available for {projectId}.</div>;
  }
  const { elements } = modelData;

  return (
    <div className="min-h-screen bg-space-900 text-gray-200">
      {/* Top Bar */}
      <Header />

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {
          viewComponent && elements && viewComponent === 'bim' ?
            <BimDashboard  setViceComponent={setViceComponent} elements={elements} modelData={modelData} />
            :
            <SatelliteDashboard setViceComponent={setViceComponent} elements={elements} modelData={modelData} />
        }
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;
