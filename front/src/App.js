import AxiosCustom from './axios/AxiosCustom';
import Footer from './component/Footer';
import Header from './component/Header';
import BimDashboard from './view/bim/BimDashboard';
import BimProjectList from './view/bim/BimProjectList';
import SatelliteDashboard from './view/SatelliteDashboard';
import ElementEditPanel from './view/bim/component/ElementEditPanel';
import ChatView from './view/chat/ChatView';
import AgentDashboard from './view/agent/AgentDashboard';
import SimulationDashboard from './view/simulation/SimulationDashboard';
import SimulationProjectList from './view/simulation/SimulationProjectList';
import SafeDashboard from './view/safe/SafeDashboard';
import TestDashboard from './view/test/TestDashboard';
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

  // ── Simulation projects ───────────────────────────────────────
  const [simulationProjectList, setSimulationProjectList] = useState([]);
  const [selectedSimulationProject, setSelectedSimulationProject] = useState(null);

  // ── Agent health check ────────────────────────────────────────
  const [agentAvailable, setAgentAvailable] = useState(null);

  // ---------------------------------------------------------------
  // Refresh BIM project list
  // ---------------------------------------------------------------
  const refreshProjectList = useCallback(() => {
    return AxiosCustom.get('/api/bim/projects')
      .then(response => {
        setProjectList(response.data);
      })
      .catch(error => {
        console.error('Failed to load project list:', error);
      });
  }, []);

  // ---------------------------------------------------------------
  // Rename BIM project
  // ---------------------------------------------------------------
  const renameProject = useCallback((projectId, newName, callback) => {
    AxiosCustom.put(`/api/bim/project/${projectId}/name`, { projectName: newName })
      .then(() => {
        setProjectList(prev =>
          prev.map(p => p.projectId === projectId ? { ...p, projectName: newName } : p)
        );
        if (callback) callback(true);
      })
      .catch(error => {
        console.error('Failed to rename project:', error);
        if (callback) callback(false);
      });
  }, []);

  // ---------------------------------------------------------------
  // Create new BIM project
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
        console.error('Failed to create project:', error);
        if (callback) callback();
      });
  }, [refreshProjectList]);

  // ---------------------------------------------------------------
  // Select BIM project → load BIM model data
  // ---------------------------------------------------------------
  function handleProjectSelect(projectData) {
    setSelectedProject(projectData);
    setModelData([]);
    AxiosCustom.get(`/api/bim/project/${projectData.projectId}`)
      .then(response => {
        setModelData(response.data);
      })
      .catch(error => {
        console.error('Failed to load BIM data:', error);
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

  const refreshModelData = useCallback(() => {
    if (!selectedProject) return;
    AxiosCustom.get(`/api/bim/project/${selectedProject.projectId}`)
      .then(response => setModelData(response.data))
      .catch(error => console.error('Failed to refresh model:', error));
  }, [selectedProject]);

  // ---------------------------------------------------------------
  // Refresh simulation project list
  // ---------------------------------------------------------------
  const refreshSimulationProjectList = useCallback(() => {
    return AxiosCustom.get('/api/simulation/projects')
      .then(response => setSimulationProjectList(response.data))
      .catch(error => console.error('Failed to load simulation project list:', error));
  }, []);

  // ---------------------------------------------------------------
  // Create new simulation project
  // ---------------------------------------------------------------
  const addSimulationProject = useCallback((name, callback) => {
    AxiosCustom.post('/api/simulation/project', { projectName: name })
      .then(() => refreshSimulationProjectList())
      .then(() => { if (callback) callback(); })
      .catch(error => {
        console.error('Failed to create simulation project:', error);
        if (callback) callback();
      });
  }, [refreshSimulationProjectList]);

  // ---------------------------------------------------------------
  // Rename simulation project
  // ---------------------------------------------------------------
  const renameSimulationProject = useCallback((projectId, newName, callback) => {
    AxiosCustom.put(`/api/simulation/project/${projectId}/name`, { projectName: newName })
      .then(() => {
        setSimulationProjectList(prev =>
          prev.map(p => p.projectId === projectId ? { ...p, projectName: newName } : p)
        );
        if (selectedSimulationProject?.projectId === projectId) {
          setSelectedSimulationProject(prev => ({ ...prev, projectName: newName }));
        }
        if (callback) callback(true);
      })
      .catch(error => {
        console.error('Failed to rename simulation project:', error);
        if (callback) callback(false);
      });
  }, [selectedSimulationProject]);

  // Initial load
  useEffect(() => {
    Promise.all([
      refreshProjectList(),
      refreshSimulationProjectList(),
    ]).finally(() => setLoading(false));
  }, [refreshProjectList, refreshSimulationProjectList]);

  useEffect(() => {
    AxiosCustom.get('/api/chat/status')
      .then(() => setAgentAvailable(true))
      .catch(() => setAgentAvailable(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🏗</div>
          <div className="text-sm">Initializing Digital Twin…</div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // View rendering
  // ---------------------------------------------------------------
  const renderView = () => {
    if (viewComponent === 'simulation-projects') {
      return (
        <SimulationProjectList
          setViceComponent={setViceComponent}
          projectList={simulationProjectList}
          onProjectSelect={setSelectedSimulationProject}
          onCreateProject={addSimulationProject}
          onRenameProject={renameSimulationProject}
        />
      );
    }
    if (viewComponent === 'simulation') {
      return (
        <SimulationDashboard
          selectedProject={selectedSimulationProject}
          modelData={modelData}
          setViceComponent={setViceComponent}
        />
      );
    }
    if (viewComponent === 'safe') {
      return <SafeDashboard />;
    }
    if (viewComponent === 'test') {
      return <TestDashboard />;
    }
    if (viewComponent === 'agent') {
      return (
        <AgentDashboard
          selectedProject={selectedProject}
          onBimUpdate={refreshModelData}
          modelData={modelData}
          selectedSimulationProject={selectedSimulationProject}
          agentAvailable={agentAvailable}
        />
      );
    }
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
          onRenameProject={renameProject}
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
      <Header viewComponent={viewComponent} setViceComponent={setViceComponent} agentAvailable={agentAvailable} />

      <main className="w-full px-2 sm:px-4 py-4 sm:py-6 pb-24 sm:pb-6 overflow-x-hidden">
        {renderView()}
      </main>

      <Footer />

      {viewComponent !== 'agent' && (
        <ChatView
          selectedProject={selectedProject}
          onBimUpdate={refreshModelData}
          selectedSimulationProject={selectedSimulationProject}
        />
      )}
    </div>
  );
}

export default App;
