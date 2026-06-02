package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.SafeIotMappingDTO;
import yyj.project.twinspring.dto.SafeProjectDTO;

import java.util.List;

public interface SafeProjectService {
    List<SafeProjectDTO> getAllProjects();
    SafeProjectDTO getProjectById(String projectId);
    SafeProjectDTO createProject(SafeProjectDTO dto);
    void updateProject(String projectId, SafeProjectDTO dto);
    void deleteProject(String projectId);

    // IoT 센서 매핑
    List<SafeIotMappingDTO> getAllIotMappings();
    List<SafeIotMappingDTO> getIotMappingsByProject(String projectId);
    SafeIotMappingDTO addIotMapping(String projectId, String sensorLocation, String sensorAlias);
    void removeIotMapping(String mappingId);
}
