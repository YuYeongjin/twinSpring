import AxiosCustom from './axios/AxiosCustom';
import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/bim/BimDashboard';
import BimProjectList from './view/bim/BimProjectList';
import SatelliteDashboard from './view/SatelliteDashboard';
import ElementEditPanel from './view/bim/component/ElementEditPanel';
// import EmsDashboard from './view/ems/EmsDashboard';
import ChatView from './view/chat/ChatView';
import AgentDashboard from './view/agent/AgentDashboard';
import { useCallback, useEffect, useState } from 'react';

function App() {

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const [viewComponent, setViceComponent] = useState('');

  const [elements, setElements] = useState(null);
  const [selectedElement, setSelectedElement] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [modelData, setModelData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [projectList, setProjectList] = useState([]);

  // ---------------------------------------------------------------
  // 프로젝트 목록 새로 고침
  // ---------------------------------------------------------------
  const refreshProjectList = useCallback(() => {
    return AxiosCustom.get('/api/bim/projects')
      .then(response => {
        setProjectList(response.data);
      })
      .catch(error => {
        console.error('프로젝트 목록 로딩 실패:', error);
      });
  }, []);

  // ---------------------------------------------------------------
  // 신규 프로젝트 생성 (BimProjectList에서 사용)
  // ---------------------------------------------------------------
  const addNewProject = useCallback((type, name, callback) => {
    AxiosCustom.post('/api/bim/project', {
      structureType: type,
      projectName: name || type + ' project',
      spanCount: 0,
    })
      .then(() => refreshProjectList())
      .then(() => { if (callback) callback(); })
      .catch(error => {
        console.error('프로젝트 생성 실패:', error);
        if (callback) callback();
      });
  }, [refreshProjectList]);

  // ---------------------------------------------------------------
  // 프로젝트 선택 → BIM 모델 데이터 로딩
  // ---------------------------------------------------------------
  function handleProjectSelect(projectData) {
    setSelectedProject(projectData);
    AxiosCustom.get(`/api/bim/project/${projectData.projectId}`)
      .then(response => {
        setModelData(response.data);
      })
      .catch(error => {
        console.error('BIM 데이터 로딩 실패:', error);
      });
  }

  const handleElementUpdate = (updatedElement) => {
    if (elements) {
      setElements(
        elements.map(el => (el.elementId === updatedElement.elementId ? updatedElement : el))
      );
      setSelectedElement(updatedElement);
    }
  };

  // AI가 BIM 부재를 생성/수정/삭제한 후 3D 뷰어 즉시 갱신
  const refreshModelData = useCallback(() => {
    if (!selectedProject) return;
    AxiosCustom.get(`/api/bim/project/${selectedProject.projectId}`)
      .then(response => setModelData(response.data))
      .catch(error => console.error('모델 갱신 실패:', error));
  }, [selectedProject]);

  // 초기 프로젝트 목록 로딩
  useEffect(() => {
    refreshProjectList().finally(() => setLoading(false));
  }, [refreshProjectList]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🏗</div>
          <div className="text-sm">Digital Twin 초기화 중…</div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // 뷰 렌더링
  // ---------------------------------------------------------------
  const renderView = () => {
    if (viewComponent === 'agent') {
      return (
        <AgentDashboard
          selectedProject={selectedProject}
          onBimUpdate={refreshModelData}
        />
      );
    }
    // if (viewComponent === 'ems') {
    //   return <EmsDashboard setViceComponent={setViceComponent} />;
    // }
    if (viewComponent === 'bim') {
      return (
        <BimDashboard
          setViceComponent={setViceComponent}
          elements={elements}
          modelData={modelData}
          setModelData={setModelData}
          selectedProject={selectedProject}
        />
      );
    }
    if (viewComponent === 'bim-projects') {
      return (
        <BimProjectList
          setViceComponent={setViceComponent}
          projectList={projectList}
          onProjectSelect={handleProjectSelect}
          onCreateProject={addNewProject}
        />
      );
    }
    if (selectedElement) {
      return (
        <ElementEditPanel
          element={selectedElement}
          onClose={() => setSelectedElement(null)}
          onUpdate={handleElementUpdate}
        />
      );
    }
    return (
      <SatelliteDashboard
        setViceComponent={setViceComponent}
        elements={elements}
        modelData={modelData}
        onProjectSelect={handleProjectSelect}
        projectList={projectList}
      />
    );
  };

  return (
    <div className="min-h-screen bg-space-900 text-gray-200">
      <Header viewComponent={viewComponent} setViceComponent={setViceComponent} />

      <main className="w-full px-2 sm:px-4 py-4 sm:py-6 overflow-x-hidden">
        {renderView()}
      </main>

      <Footer />

      {/* AI 채팅 어시스턴트 — Agent 전용 화면 제외 모든 뷰에서 표시 */}
      {viewComponent !== 'agent' && (
        <ChatView selectedProject={selectedProject} onBimUpdate={refreshModelData} />
      )}
    </div>
  );
}

export default App;
