package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.WbsProjectDTO;
import yyj.project.twinspring.dto.WbsTaskDTO;

import java.util.List;
import java.util.Map;

public interface WbsService {

    // ── 프로젝트 ──────────────────────────────────────────────────────

    List<WbsProjectDTO> getAllProjects();

    WbsProjectDTO getProjectById(String projectId);

    WbsProjectDTO createProject(WbsProjectDTO dto);

    void updateProject(String projectId, WbsProjectDTO dto);

    void deleteProject(String projectId);

    // ── 태스크 ────────────────────────────────────────────────────────

    List<WbsTaskDTO> getTasksByProject(String projectId);

    /** 전체 프로젝트 태스크 목록 (통합 간트용) */
    List<WbsTaskDTO> getAllTasks();

    WbsTaskDTO createTask(WbsTaskDTO dto);

    void updateTask(String taskId, WbsTaskDTO dto);

    void deleteTask(String taskId);

    /** Agent가 CPM/균열 감지 이벤트로 태스크를 자동 추가 */
    List<WbsTaskDTO> addAgentTasks(String projectId, List<Map<String, Object>> taskPayloads, String source);
}
