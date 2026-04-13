package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

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

    // ── 부재 커스텀 색상 ────────────────────────────────────────────
    List<Map<String, Object>> getColorsByProject(@Param("projectId") String projectId);

    void upsertColor(Map<String, Object> colorData);

    void deleteColor(@Param("elementId") String elementId);

    void deleteColorsByProject(@Param("projectId") String projectId);

    // ── 선 (bim_line) ───────────────────────────────────────────────
    List<Map<String, Object>> getLinesByProject(@Param("projectId") String projectId);

    void insertLine(Map<String, Object> line);

    void updateLine(Map<String, Object> line);

    void deleteLine(@Param("lineId") String lineId);

    void deleteLinesByProject(@Param("projectId") String projectId);

    // ── BIM 통계 / 조회 (MariaDB 직접) ─────────────────────────────
    List<Map<String, Object>> getAllProjects();

    List<Map<String, Object>> getElementStatsByProject(@Param("projectId") String projectId);

    List<Map<String, Object>> getElementsByProject(@Param("projectId") String projectId);
}
