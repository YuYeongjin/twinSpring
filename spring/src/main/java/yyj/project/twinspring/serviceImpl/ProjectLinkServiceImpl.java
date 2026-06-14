package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.ProjectLinkDAO;
import yyj.project.twinspring.dao.WbsDAO;
import yyj.project.twinspring.dto.ProjectLinkDTO;
import yyj.project.twinspring.service.ProjectLinkService;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class ProjectLinkServiceImpl implements ProjectLinkService {

    private static final Logger log = LoggerFactory.getLogger(ProjectLinkServiceImpl.class);

    private final ProjectLinkDAO linkDAO;
    private final WbsDAO wbsDAO;

    public ProjectLinkServiceImpl(ProjectLinkDAO linkDAO, WbsDAO wbsDAO) {
        this.linkDAO = linkDAO;
        this.wbsDAO  = wbsDAO;
    }

    @Override
    public List<ProjectLinkDTO> getLinksByWbsProject(String wbsProjectId) {
        return linkDAO.getLinksByWbsProject(wbsProjectId).stream()
                .map(this::rowToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public List<ProjectLinkDTO> getWbsByLinkedProject(String linkedType, String linkedProjectId) {
        return linkDAO.getWbsByLinkedProject(linkedType, linkedProjectId).stream()
                .map(this::rowToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public ProjectLinkDTO createLink(ProjectLinkDTO dto) {
        // 중복 방지
        int cnt = linkDAO.countLink(dto.getWbsProjectId(), dto.getLinkedType(), dto.getLinkedProjectId());
        if (cnt > 0) {
            // 이미 존재하는 링크는 무시 — 기존 DTO 재조회 없이 입력값을 그대로 반환
            return dto;
        }
        String id = UUID.randomUUID().toString();
        Map<String, Object> m = new HashMap<>();
        m.put("linkId",           id);
        m.put("wbsProjectId",     dto.getWbsProjectId());
        m.put("linkedType",       dto.getLinkedType());
        m.put("linkedProjectId",  dto.getLinkedProjectId());
        m.put("note",             dto.getNote());
        linkDAO.insertLink(m);
        dto.setLinkId(id);
        return dto;
    }

    @Override
    public void deleteLink(String linkId) {
        Map<String, Object> link = linkDAO.getLinkById(linkId);
        if (link != null && "BIM".equals(link.get("linkedType"))) {
            String wbsProjectId = (String) link.get("wbsProjectId");
            String bimProjectId = (String) link.get("linkedProjectId");
            try {
                wbsDAO.deleteTasksByBimMarker(wbsProjectId, bimProjectId);
                log.info("[ProjectLink] BIM WBS 태스크 삭제: wbsProjectId={}, bimProjectId={}", wbsProjectId, bimProjectId);
            } catch (Exception e) {
                log.warn("[ProjectLink] BIM WBS 태스크 삭제 실패(무시): {}", e.getMessage());
            }
        }
        linkDAO.deleteLink(linkId);
    }

    private ProjectLinkDTO rowToDTO(Map<String, Object> r) {
        ProjectLinkDTO dto = new ProjectLinkDTO();
        dto.setLinkId((String)             r.get("linkId"));
        dto.setWbsProjectId((String)       r.get("wbsProjectId"));
        dto.setWbsProjectName((String)     r.get("wbsProjectName"));   // 역방향 조회시 채워짐
        dto.setLinkedType((String)         r.get("linkedType"));
        dto.setLinkedProjectId((String)    r.get("linkedProjectId"));
        dto.setLinkedProjectName((String)  r.get("linkedProjectName")); // 순방향 조회시 채워짐
        dto.setLinkedLocation((String)     r.get("linkedLocation"));
        dto.setLinkedStatus((String)       r.get("linkedStatus"));
        dto.setNote((String)               r.get("note"));
        dto.setCreatedAt((String)          r.get("createdAt"));
        return dto;
    }
}
