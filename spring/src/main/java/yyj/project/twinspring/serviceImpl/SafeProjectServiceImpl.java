package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.SafeDAO;
import yyj.project.twinspring.dto.SafeProjectDTO;
import yyj.project.twinspring.service.SafeProjectService;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class SafeProjectServiceImpl implements SafeProjectService {

    private final SafeDAO safeDAO;

    public SafeProjectServiceImpl(SafeDAO safeDAO) {
        this.safeDAO = safeDAO;
    }

    @Override
    public List<SafeProjectDTO> getAllProjects() {
        return safeDAO.getAllSafeProjects().stream()
                .map(this::rowToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public SafeProjectDTO getProjectById(String projectId) {
        Map<String, Object> row = safeDAO.getSafeProjectById(projectId);
        return row != null ? rowToDTO(row) : null;
    }

    @Override
    public SafeProjectDTO createProject(SafeProjectDTO dto) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> p = new HashMap<>();
        p.put("projectId",   id);
        p.put("projectName", dto.getProjectName());
        p.put("location",    dto.getLocation());
        p.put("description", dto.getDescription());
        p.put("cameraUrl",   dto.getCameraUrl());
        p.put("status",      dto.getStatus() != null ? dto.getStatus() : "ACTIVE");
        safeDAO.insertSafeProject(p);
        dto.setProjectId(id);
        return dto;
    }

    @Override
    public void updateProject(String projectId, SafeProjectDTO dto) {
        Map<String, Object> p = new HashMap<>();
        p.put("projectId",   projectId);
        p.put("projectName", dto.getProjectName());
        p.put("location",    dto.getLocation());
        p.put("description", dto.getDescription());
        p.put("cameraUrl",   dto.getCameraUrl());
        p.put("status",      dto.getStatus() != null ? dto.getStatus() : "ACTIVE");
        safeDAO.updateSafeProject(p);
    }

    @Override
    public void deleteProject(String projectId) {
        safeDAO.deleteSafeProject(projectId);
    }

    private SafeProjectDTO rowToDTO(Map<String, Object> r) {
        SafeProjectDTO dto = new SafeProjectDTO();
        dto.setProjectId((String)   r.get("projectId"));
        dto.setProjectName((String) r.get("projectName"));
        dto.setLocation((String)    r.get("location"));
        dto.setDescription((String) r.get("description"));
        dto.setCameraUrl((String)   r.get("cameraUrl"));
        dto.setStatus((String)      r.get("status"));
        dto.setCreatedAt((String)   r.get("createdAt"));
        return dto;
    }
}
