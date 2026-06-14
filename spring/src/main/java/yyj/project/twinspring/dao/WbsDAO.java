package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface WbsDAO {

    // ── WBS 프로젝트 ────────────────────────────────────────────────

    List<Map<String, Object>> getAllWbsProjects();

    Map<String, Object> getWbsProjectById(@Param("projectId") String projectId);

    void insertWbsProject(Map<String, Object> params);

    void updateWbsProject(Map<String, Object> params);

    void deleteWbsProject(@Param("projectId") String projectId);

    // ── WBS 작업 (태스크) ────────────────────────────────────────────

    List<Map<String, Object>> getTasksByProject(@Param("projectId") String projectId);

    /** 전체 프로젝트 태스크 (간트 전체 보기용) */
    List<Map<String, Object>> getAllTasks();

    Map<String, Object> getTaskById(@Param("taskId") String taskId);

    void insertTask(Map<String, Object> params);

    void updateTask(Map<String, Object> params);

    void deleteTask(@Param("taskId") String taskId);

    void deleteTasksByProject(@Param("projectId") String projectId);

    /** BIM 연결 해제 시 notes가 'BIM:{bimProjectId}:%' 인 태스크와 그 세부공정을 일괄 삭제 */
    void deleteTasksByBimMarker(@Param("wbsProjectId") String wbsProjectId,
                                @Param("bimProjectId") String bimProjectId);

    /** Agent가 CPM/균열 이벤트로 자동 추가할 때 사용 */
    void insertTaskBatch(List<Map<String, Object>> tasks);
}
