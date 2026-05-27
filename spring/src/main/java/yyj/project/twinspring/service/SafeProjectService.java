package yyj.project.twinspring.service;

import yyj.project.twinspring.dto.SafeProjectDTO;

import java.util.List;

public interface SafeProjectService {
    List<SafeProjectDTO> getAllProjects();
    SafeProjectDTO getProjectById(String projectId);
    SafeProjectDTO createProject(SafeProjectDTO dto);
    void updateProject(String projectId, SafeProjectDTO dto);
    void deleteProject(String projectId);
}
