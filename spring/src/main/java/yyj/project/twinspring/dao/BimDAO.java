package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimStoreyDTO;
import yyj.project.twinspring.dto.BimWbsNodeDTO;

import java.util.List;
import java.util.Map;

@Mapper
public interface BimDAO {

    // ── 레이어 ──────────────────────────────────────────────────────
    List<Map<String, Object>> getLayersByProject(@Param("projectId") String projectId);

    void insertLayer(Map<String, Object> layer);

    void updateLayer(Map<String, Object> layer);

    void deleteLayer(@Param("layerId") String layerId);

    void deleteLayersByProject(@Param("projectId") String projectId);

    void insertLayersBatch(List<Map<String, Object>> layers);

    // ── 부재 커스텀 색상 ────────────────────────────────────────────
    List<Map<String, Object>> getColorsByProject(@Param("projectId") String projectId);

    void upsertColor(Map<String, Object> colorData);

    void deleteColor(@Param("elementId") String elementId);

    void deleteColorsByProject(@Param("projectId") String projectId);

    // ── 선 (bim_line) ───────────────────────────────────────────────
    List<Map<String, Object>> getLinesByProject(@Param("projectId") String projectId);

    void insertLine(Map<String, Object> line);

    /** 다수 선 일괄 삽입 (도면 변환 등 대량 삽입용) */
    void insertLinesBatch(List<Map<String, Object>> lines);

    void updateLine(Map<String, Object> line);

    void deleteLine(@Param("lineId") String lineId);

    void deleteLinesByProject(@Param("projectId") String projectId);

    // ── BIM 통계 / 조회 (MariaDB 직접) ─────────────────────────────
    void insertProject(Map<String, Object> params);

    List<Map<String, Object>> getAllProjects();

    Map<String, Object> getProjectById(@Param("projectId") String projectId);

    void updateProjectName(Map<String, Object> params);

    /** IFC 파일 업로드 완료 후 storage 정보 저장 */
    void updateProjectStorage(Map<String, Object> params);

    void updateProjectGlbStorage(Map<String, Object> params);

    List<Map<String, Object>> getElementStatsByProject(@Param("projectId") String projectId);

    List<Map<String, Object>> getElementsByProject(@Param("projectId") String projectId);

    /** IFC 임포트 시 부재 배치 로컬 저장 (ifcWorldX/Y/Z, globalId, storey 포함) */
    void insertElementsBatch(List<BimElementDTO> elements);

    void deleteElementsByProject(@Param("projectId") String projectId);

    void deleteProjectById(@Param("projectId") String projectId);

    // ── 층(BuildingStorey) ──────────────────────────────────────────
    List<BimStoreyDTO> getStoreysByProject(@Param("projectId") String projectId);

    void insertStoreysBatch(List<BimStoreyDTO> storeys);

    void deleteStoreysByProject(@Param("projectId") String projectId);

    // ── WBS 노드 ────────────────────────────────────────────────────
    List<BimWbsNodeDTO> getWbsByProject(@Param("projectId") String projectId);

    void insertWbsNodesBatch(List<BimWbsNodeDTO> nodes);

    void updateWbsProgress(@Param("wbsId") String wbsId, @Param("progress") int progress);

    void deleteWbsByProject(@Param("projectId") String projectId);

    // ── 부재 ↔ WBS 매핑 ────────────────────────────────────────────
    List<Map<String, Object>> getElementWbsMappings(@Param("projectId") String projectId);

    void insertElementWbsMappingsBatch(List<Map<String, Object>> mappings);

    void deleteElementWbsMappingsByProject(@Param("projectId") String projectId);

    List<String> getElementIdsByWbs(@Param("wbsId") String wbsId);

    String getWbsIdByElement(@Param("elementId") String elementId);
}
