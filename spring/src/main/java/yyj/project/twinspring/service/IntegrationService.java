package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.IntegrationProjectDTO;

import java.util.List;
import java.util.Map;

public interface IntegrationService {

    List<IntegrationProjectDTO> getIntegrationProjects();

    List<IntegrationProjectDTO> getIntegrationProjectsByWbs(String wbsProjectId);

    IntegrationProjectDTO getIntegrationProject(String projectId);

    IntegrationProjectDTO createIntegrationProject(Map<String, String> body);

    IntegrationProjectDTO updateIntegrationProject(String projectId, Map<String, String> body);

    void updateSimConfig(String projectId, String simConfig);

    void deleteIntegrationProject(String projectId);
}
