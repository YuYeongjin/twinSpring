package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface ProjectLinkDAO {

    /** WBS 프로젝트에 연결된 모든 링크 (JOIN으로 이름/위치 포함) */
    List<Map<String, Object>> getLinksByWbsProject(@Param("wbsProjectId") String wbsProjectId);

    /** 특정 타입만 (BIM / SAFE / SIMULATION) */
    List<Map<String, Object>> getLinksByWbsProjectAndType(
            @Param("wbsProjectId") String wbsProjectId,
            @Param("linkedType") String linkedType);

    /** 역방향: 하위 프로젝트(BIM/Safe/Sim)에 연결된 WBS 프로젝트 조회 */
    List<Map<String, Object>> getWbsByLinkedProject(
            @Param("linkedType") String linkedType,
            @Param("linkedProjectId") String linkedProjectId);

    Map<String, Object> getLinkById(@Param("linkId") String linkId);

    void insertLink(Map<String, Object> params);

    void deleteLink(@Param("linkId") String linkId);

    void deleteLinksByWbsProject(@Param("wbsProjectId") String wbsProjectId);

    /** 중복 링크 방지용 존재 여부 확인 */
    int countLink(@Param("wbsProjectId") String wbsProjectId,
                  @Param("linkedType") String linkedType,
                  @Param("linkedProjectId") String linkedProjectId);
}
