import AxiosCustom from './axios/AxiosCustom';
import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/bim/BimDashboard';
import SatelliteDashboard from './view/SatelliteDashboard';
import ElementEditPanel from './view/bim/component/ElementEditPanel';
import EmsDashboard from './view/ems/EmsDashboard';
import ChatView from './view/chat/ChatView';
import { useCallback, useEffect, useState } from 'react';

function App() {

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  const [viewComponent, setViceComponent] = useState('');

  const [elements, setElements] = useState(null); // 모든 부재 데이터

  const [selectedElement, setSelectedElement] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [modelData, setModelData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [projectList, setProjectList] = useState([]);

  const handleElementSelect = (elementData) => {
    setSelectedElement(elementData);
  };
  function handleProjectSelect(projectData) {
    setSelectedProject(projectData);
    AxiosCustom.get(`/api/bim/project/${projectData.projectId}`)
      .then(response => {
        console.log("projectData :: "  +response.data);
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
    if (elements) {
      setElements(
        elements.map(el => (el.elementId === updatedElement.elementId ? updatedElement : el))
      );
      setSelectedElement(updatedElement);
    }
  };

  // AI가 BIM 부재를 생성/수정/삭제한 후 3D 뷰어를 즉시 갱신
  const refreshModelData = useCallback(() => {
    if (!selectedProject) return;
    AxiosCustom.get(`/api/bim/project/${selectedProject.projectId}`)
      .then(response => setModelData(response.data))
      .catch(error => console.error('모델 갱신 실패:', error));
  }, [selectedProject]);

  useEffect(() => {
    // Spring API 호출
    AxiosCustom.get(`/api/bim/projects`)
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
      <main className="mx-auto w-full px-4 py-6">
        {
          // EMS 대시보드 뷰: setViceComponent('ems') 호출 시 표시
          viewComponent === 'ems' ?
            <EmsDashboard setViceComponent={setViceComponent} />
            :
          viewComponent && viewComponent === 'bim' ?
            <BimDashboard setViceComponent={setViceComponent} elements={elements} modelData={modelData} setModelData={setModelData} selectedProject={selectedProject}/>
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

      {/* AI 채팅 어시스턴트 - 모든 뷰에서 표시 */}
      <ChatView selectedProject={selectedProject} onBimUpdate={refreshModelData} />
    </div>
  );
}

export default App;
