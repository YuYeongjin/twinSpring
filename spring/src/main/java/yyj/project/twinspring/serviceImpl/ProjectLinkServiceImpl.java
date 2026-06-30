package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.IntegrationDAO;
import yyj.project.twinspring.dao.ProjectLinkDAO;
import yyj.project.twinspring.dao.WbsDAO;
import yyj.project.twinspring.dto.ProjectLinkDTO;
import yyj.project.twinspring.service.ProjectLinkService;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class ProjectLinkServiceImpl implements ProjectLinkService {

    private static final Logger log = LoggerFactory.getLogger(ProjectLinkServiceImpl.class);

    private final ProjectLinkDAO  linkDAO;
    private final WbsDAO          wbsDAO;
    private final IntegrationDAO  integrationDAO;

    public ProjectLinkServiceImpl(ProjectLinkDAO linkDAO, WbsDAO wbsDAO, IntegrationDAO integrationDAO) {
        this.linkDAO        = linkDAO;
        this.wbsDAO         = wbsDAO;
        this.integrationDAO = integrationDAO;
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
        // note 에 instanceKey가 포함된 경우 (BIM:xxx:ROOT:key 형태) → note까지 포함해 중복 체크
        // 그 외에는 (wbs, type, linkedProject) 기준 중복 방지
        String note = dto.getNote();
        boolean hasInstanceKey = note != null && note.startsWith("BIM:") && note.contains(":ROOT:");
        int cnt = hasInstanceKey
            ? linkDAO.countLinkByNote(dto.getWbsProjectId(), dto.getLinkedType(), dto.getLinkedProjectId(), note)
            : linkDAO.countLink(dto.getWbsProjectId(), dto.getLinkedType(), dto.getLinkedProjectId());
        if (cnt > 0) {
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
            String note         = (String) link.get("note");
            // note 에 instanceKey가 있으면 해당 루트만 삭제 (동일 BIM 여러 개 중 1개만 지우기)
            boolean hasInstanceKey = note != null && note.startsWith("BIM:") && note.contains(":ROOT:");
            if (hasInstanceKey) {
                try {
                    wbsDAO.deleteTasksByRootMarker(wbsProjectId, note);
                    log.info("[ProjectLink] BIM WBS 루트 삭제: rootMarker={}", note);
                } catch (Exception e) {
                    log.warn("[ProjectLink] BIM WBS 루트 삭제 실패(무시): {}", e.getMessage());
                }
            } else {
                // instanceKey 없는 구 방식: 통합관제 참조가 없을 때만 전체 삭제
                int integrationRefs = 0;
                try {
                    integrationRefs = integrationDAO.countIntegrationByWbsAndBim(wbsProjectId, bimProjectId);
                } catch (Exception e) {
                    log.warn("[ProjectLink] 통합관제 참조 카운트 실패(무시): {}", e.getMessage());
                }
                if (integrationRefs == 0) {
                    try {
                        wbsDAO.deleteTasksByBimMarker(wbsProjectId, bimProjectId);
                        log.info("[ProjectLink] BIM WBS 태스크 전체 삭제: wbsProjectId={}, bimProjectId={}", wbsProjectId, bimProjectId);
                    } catch (Exception e) {
                        log.warn("[ProjectLink] BIM WBS 태스크 삭제 실패(무시): {}", e.getMessage());
                    }
                }
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
