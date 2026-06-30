package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.SafeDAO;
import yyj.project.twinspring.dto.SafeIotMappingDTO;
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
        p.put("mode",        dto.getMode()   != null ? dto.getMode()   : "SAFETY");
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
        p.put("mode",        dto.getMode()   != null ? dto.getMode()   : "SAFETY");
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
        dto.setMode((String)        r.get("mode"));
        dto.setCreatedAt((String)   r.get("createdAt"));
        return dto;
    }

    // ── IoT 매핑 ─────────────────────────────────────────────────

    @Override
    public List<SafeIotMappingDTO> getAllIotMappings() {
        return safeDAO.getAllIotMappings().stream()
                .map(this::rowToMappingDTO)
                .collect(Collectors.toList());
    }

    @Override
    public List<SafeIotMappingDTO> getIotMappingsByProject(String projectId) {
        return safeDAO.getIotMappingsByProject(projectId).stream()
                .map(this::rowToMappingDTO)
                .collect(Collectors.toList());
    }

    @Override
    public SafeIotMappingDTO addIotMapping(String projectId, String sensorLocation, String sensorAlias) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> p = new HashMap<>();
        p.put("mappingId",      id);
        p.put("projectId",      projectId);
        p.put("sensorLocation", sensorLocation);
        p.put("sensorAlias",    sensorAlias);
        safeDAO.insertIotMapping(p);

        SafeIotMappingDTO dto = new SafeIotMappingDTO();
        dto.setMappingId(id);
        dto.setProjectId(projectId);
        dto.setSensorLocation(sensorLocation);
        dto.setSensorAlias(sensorAlias);
        return dto;
    }

    @Override
    public void removeIotMapping(String mappingId) {
        safeDAO.deleteIotMapping(mappingId);
    }

    private SafeIotMappingDTO rowToMappingDTO(Map<String, Object> r) {
        SafeIotMappingDTO dto = new SafeIotMappingDTO();
        dto.setMappingId((String)      r.get("mappingId"));
        dto.setProjectId((String)      r.get("projectId"));
        dto.setProjectName((String)    r.get("projectName"));
        dto.setSensorLocation((String) r.get("sensorLocation"));
        dto.setSensorAlias((String)    r.get("sensorAlias"));
        dto.setCreatedAt((String)      r.get("createdAt"));
        return dto;
    }
}
