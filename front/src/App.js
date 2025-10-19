import axios from 'axios';
import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/bim/BimDashboard';
import SatelliteDashboard from './view/SatelliteDashboard';
import ElementEditPanel from './view/bim/component/ElementEditPanel';
import { useEffect, useState } from 'react';

function App() {

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  const [viewComponent, setViceComponent] = useState('');

  const [elements, setElements] = useState(null); // 모든 부재 데이터

  const [selectedElement, setSelectedElement] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [modelData, setModelData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projectList, setProjectList] = useState([]);

  const handleElementSelect = (elementData) => {
    setSelectedElement(elementData);
  };
  function handleProjectSelect(projectData) {
    setSelectedProject(projectData);
    axios.get(`http://localhost:8080/api/bim/project/${projectData.projectId}`)
      .then(response => {
        setModelData(response.data);
        // setElements(response.data);
        setLoading(false);
      })
      .catch(error => {
        console.error("Error fetching BIM data from Spring:", error);
        setLoading(false);
      });
  };
  const handleElementUpdate = (updatedElement) => {
    // C# 서버에서 데이터 업데이트 성공 후, React 상태도 갱신
    if (elements) {
      setElements(
        elements.map(el => (el.elementId === updatedElement.elementId ? updatedElement : el))
      );
      setSelectedElement(updatedElement);
    }
  };

  useEffect(() => {
    // Spring API 호출
    axios.get(`http://localhost:8080/api/bim/projects`)
      .then(response => {
        setProjectList(response.data);
        setLoading(false);
      })
      .catch(error => {
        setLoading(false);
      });

  }, [viewComponent]);

  // useEffect(() => {
  //   // Spring API 호출
  //   console.log(selectedProject);
  //   if (selectedProject && selectedProject.projectId) {

  //     axios.get(`http://localhost:8080/api/bim//project/projectId=${selectedProject.projectId}`)
  //       .then(response => {
  //         setModelData(response.data);
  //         // setElements(response.data);
  //         setLoading(false);
  //       })
  //       .catch(error => {
  //         console.error("Error fetching BIM data from Spring:", error);
  //         setLoading(false);
  //       });

  //   }
  // }, [selectedProject]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}>Loading 3D Model...</div>;
  }

  // const { elements } = modelData;
  return (
    <div className="min-h-screen bg-space-900 text-gray-200">
      {/* Top Bar */}
      <Header />

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {
          viewComponent && viewComponent === 'bim' ?
            <BimDashboard setViceComponent={setViceComponent} elements={elements} modelData={modelData} />
            :
            selectedElement && selectedElement ?
              <ElementEditPanel
                element={selectedElement}
                onClose={() => setSelectedElement(null)}
                onUpdate={handleElementUpdate} // 업데이트 핸들러 전달
              />
              :
              <>
                <SatelliteDashboard setViceComponent={setViceComponent} elements={elements} modelData={modelData} onProjectSelect={handleProjectSelect} projectList={projectList} />
              </>
        }
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;
