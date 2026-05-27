package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.ProjectLinkDTO;

import java.util.List;

public interface ProjectLinkService {
    /** WBS 프로젝트에 연결된 전체 링크 */
    List<ProjectLinkDTO> getLinksByWbsProject(String wbsProjectId);

    /** 하위 프로젝트(BIM/Safe/Sim)에서 역방향으로 WBS 조회 */
    List<ProjectLinkDTO> getWbsByLinkedProject(String linkedType, String linkedProjectId);

    /** 링크 생성 (중복 방지) */
    ProjectLinkDTO createLink(ProjectLinkDTO dto);

    /** 링크 삭제 */
    void deleteLink(String linkId);
}
