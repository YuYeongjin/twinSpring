package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.IntegrationDAO;
import yyj.project.twinspring.dto.IntegrationProjectDTO;
import yyj.project.twinspring.service.IntegrationService;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class IntegrationServiceImpl implements IntegrationService {

    private final IntegrationDAO integrationDAO;

    public IntegrationServiceImpl(IntegrationDAO integrationDAO) {
        this.integrationDAO = integrationDAO;
    }

    @Override
    public List<IntegrationProjectDTO> getIntegrationProjects() {
        return integrationDAO.getAllIntegrationProjects().stream()
                .map(this::rowToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public List<IntegrationProjectDTO> getIntegrationProjectsByWbs(String wbsProjectId) {
        return integrationDAO.getIntegrationProjectsByWbs(wbsProjectId).stream()
                .map(this::rowToDTO)
                .collect(Collectors.toList());
    }

    @Override
    public IntegrationProjectDTO getIntegrationProject(String projectId) {
        Map<String, Object> row = integrationDAO.getIntegrationProjectById(projectId);
        if (row == null) return null;
        return rowToDTO(row);
    }

    @Override
    public IntegrationProjectDTO createIntegrationProject(Map<String, String> body) {
        String projectId = UUID.randomUUID().toString();
        Map<String, Object> params = new HashMap<>();
        params.put("projectId",    projectId);
        params.put("projectName",  body.getOrDefault("projectName", "새 통합관제 프로젝트"));
        params.put("wbsProjectId", body.get("wbsProjectId"));
        params.put("bimProjectId", body.get("bimProjectId"));
        params.put("description",  body.get("description"));
        integrationDAO.insertIntegrationProject(params);
        return getIntegrationProject(projectId);
    }

    @Override
    public IntegrationProjectDTO updateIntegrationProject(String projectId, Map<String, String> body) {
        Map<String, Object> params = new HashMap<>();
        params.put("projectId",    projectId);
        params.put("projectName",  body.get("projectName"));
        params.put("wbsProjectId", body.get("wbsProjectId"));
        params.put("bimProjectId", body.get("bimProjectId"));
        params.put("description",  body.get("description"));
        params.put("status",       body.get("status"));
        integrationDAO.updateIntegrationProject(params);
        return getIntegrationProject(projectId);
    }

    @Override
    public void updateSimConfig(String projectId, String simConfig) {
        Map<String, Object> params = new HashMap<>();
        params.put("projectId", projectId);
        params.put("simConfig", simConfig);
        integrationDAO.updateSimConfig(params);
    }

    @Override
    public void updateSiteOrigin(String projectId, Double refLat, Double refLng) {
        Map<String, Object> params = new HashMap<>();
        params.put("projectId", projectId);
        params.put("refLat",    refLat);
        params.put("refLng",    refLng);
        integrationDAO.updateSiteOrigin(params);
    }

    @Override
    public void deleteIntegrationProject(String projectId) {
        integrationDAO.deleteIntegrationProject(projectId);
    }

    private IntegrationProjectDTO rowToDTO(Map<String, Object> row) {
        IntegrationProjectDTO dto = new IntegrationProjectDTO();
        dto.setProjectId((String)   row.get("projectId"));
        dto.setProjectName((String) row.get("projectName"));
        dto.setWbsProjectId((String) row.get("wbsProjectId"));
        dto.setBimProjectId((String) row.get("bimProjectId"));
        dto.setDescription((String) row.get("description"));
        dto.setSimConfig((String)   row.get("simConfig"));
        dto.setStatus((String)      row.get("status"));
        dto.setRefLat(toDouble(row.get("refLat")));
        dto.setRefLng(toDouble(row.get("refLng")));
        dto.setCreatedAt(row.get("createdAt") != null ? row.get("createdAt").toString() : null);
        return dto;
    }

    private Double toDouble(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).doubleValue();
        try { return Double.parseDouble(v.toString()); } catch (Exception e) { return null; }
    }
}
