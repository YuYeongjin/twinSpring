package yyj.project.twinspring.serviceImpl;

import org.springframework.stereotype.Service;
import yyj.project.twinspring.dao.WbsDAO;
import yyj.project.twinspring.dto.WbsProjectDTO;
import yyj.project.twinspring.dto.WbsTaskDTO;
import yyj.project.twinspring.service.WbsService;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class WbsServiceImpl implements WbsService {

    private final WbsDAO wbsDAO;

    public WbsServiceImpl(WbsDAO wbsDAO) {
        this.wbsDAO = wbsDAO;
    }

    // ════════════════════════════════ PROJECTS ════════════════════════════════

    @Override
    public List<WbsProjectDTO> getAllProjects() {
        return wbsDAO.getAllWbsProjects().stream()
                .map(this::rowToProjectDTO)
                .collect(Collectors.toList());
    }

    @Override
    public WbsProjectDTO getProjectById(String projectId) {
        Map<String, Object> row = wbsDAO.getWbsProjectById(projectId);
        return row != null ? rowToProjectDTO(row) : null;
    }

    @Override
    public WbsProjectDTO createProject(WbsProjectDTO dto) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> p = new HashMap<>();
        p.put("projectId",      id);
        p.put("projectName",    dto.getProjectName());
        p.put("location",       dto.getLocation());
        p.put("contractAmount", dto.getContractAmount());
        p.put("status",         dto.getStatus() != null ? dto.getStatus() : "PLANNED");
        p.put("description",    dto.getDescription());
        p.put("startDate",      dto.getStartDate());
        p.put("endDate",        dto.getEndDate());
        p.put("clientName",     dto.getClientName());
        p.put("managerName",    dto.getManagerName());
        wbsDAO.insertWbsProject(p);
        dto.setProjectId(id);
        return dto;
    }

    @Override
    public void updateProject(String projectId, WbsProjectDTO dto) {
        Map<String, Object> p = new HashMap<>();
        p.put("projectId",      projectId);
        p.put("projectName",    dto.getProjectName());
        p.put("location",       dto.getLocation());
        p.put("contractAmount", dto.getContractAmount());
        p.put("status",         dto.getStatus());
        p.put("description",    dto.getDescription());
        p.put("startDate",      dto.getStartDate());
        p.put("endDate",        dto.getEndDate());
        p.put("clientName",     dto.getClientName());
        p.put("managerName",    dto.getManagerName());
        wbsDAO.updateWbsProject(p);
    }

    @Override
    public void deleteProject(String projectId) {
        wbsDAO.deleteWbsProject(projectId);
    }

    // ════════════════════════════════ TASKS ═══════════════════════════════════

    @Override
    public List<WbsTaskDTO> getTasksByProject(String projectId) {
        return wbsDAO.getTasksByProject(projectId).stream()
                .map(this::rowToTaskDTO)
                .collect(Collectors.toList());
    }

    @Override
    public List<WbsTaskDTO> getAllTasks() {
        return wbsDAO.getAllTasks().stream()
                .map(this::rowToTaskDTO)
                .collect(Collectors.toList());
    }

    @Override
    public WbsTaskDTO createTask(WbsTaskDTO dto) {
        String id = UUID.randomUUID().toString();
        wbsDAO.insertTask(taskDtoToRow(id, dto));
        dto.setTaskId(id);
        return dto;
    }

    @Override
    public void updateTask(String taskId, WbsTaskDTO dto) {
        Map<String, Object> row = taskDtoToRow(taskId, dto);
        wbsDAO.updateTask(row);
    }

    @Override
    public void deleteTask(String taskId) {
        wbsDAO.deleteTask(taskId);
    }

    @Override
    public List<WbsTaskDTO> addAgentTasks(String projectId,
                                          List<Map<String, Object>> payloads,
                                          String source) {
        List<Map<String, Object>> rows = new ArrayList<>();
        List<WbsTaskDTO> result = new ArrayList<>();
        for (Map<String, Object> p : payloads) {
            String id = UUID.randomUUID().toString();
            WbsTaskDTO dto = new WbsTaskDTO();
            dto.setTaskId(id);
            dto.setWbsProjectId(projectId);
            dto.setWbsCode((String) p.getOrDefault("wbsCode", ""));
            dto.setTaskName((String) p.getOrDefault("taskName", "Auto Task"));
            dto.setStartDate((String) p.getOrDefault("startDate", null));
            dto.setEndDate((String) p.getOrDefault("endDate", null));
            dto.setDuration(toInt(p.get("duration"), 0));
            dto.setProgress(toInt(p.get("progress"), 0));
            dto.setPredecessorIds((String) p.getOrDefault("predecessorIds", ""));
            dto.setStatus((String) p.getOrDefault("status", "NOT_STARTED"));
            dto.setResponsible((String) p.getOrDefault("responsible", ""));
            dto.setNotes((String) p.getOrDefault("notes", ""));
            dto.setSource(source != null ? source : "AGENT_AUTO");
            dto.setSortOrder(toInt(p.get("sortOrder"), rows.size()));
            rows.add(taskDtoToRow(id, dto));
            result.add(dto);
        }
        if (!rows.isEmpty()) {
            wbsDAO.insertTaskBatch(rows);
        }
        return result;
    }

    // ════════════════════════════════ HELPERS ═════════════════════════════════

    private WbsProjectDTO rowToProjectDTO(Map<String, Object> r) {
        WbsProjectDTO dto = new WbsProjectDTO();
        dto.setProjectId((String) r.get("projectId"));
        dto.setProjectName((String) r.get("projectName"));
        dto.setLocation((String) r.get("location"));
        dto.setContractAmount(toLong(r.get("contractAmount")));
        dto.setStatus((String) r.get("status"));
        dto.setDescription((String) r.get("description"));
        dto.setStartDate((String) r.get("startDate"));
        dto.setEndDate((String) r.get("endDate"));
        dto.setClientName((String) r.get("clientName"));
        dto.setManagerName((String) r.get("managerName"));
        dto.setTaskCount(toInt(r.get("taskCount"), 0));
        dto.setCreatedAt((String) r.get("createdAt"));
        return dto;
    }

    private WbsTaskDTO rowToTaskDTO(Map<String, Object> r) {
        WbsTaskDTO dto = new WbsTaskDTO();
        dto.setTaskId((String) r.get("taskId"));
        dto.setWbsProjectId((String) r.get("wbsProjectId"));
        dto.setWbsCode((String) r.get("wbsCode"));
        dto.setTaskName((String) r.get("taskName"));
        dto.setStartDate((String) r.get("startDate"));
        dto.setEndDate((String) r.get("endDate"));
        dto.setDuration(toInt(r.get("duration"), 0));
        dto.setProgress(toInt(r.get("progress"), 0));
        dto.setPredecessorIds((String) r.get("predecessorIds"));
        dto.setStatus((String) r.get("status"));
        dto.setResponsible((String) r.get("responsible"));
        dto.setNotes((String) r.get("notes"));
        dto.setSource((String) r.get("source"));
        dto.setSortOrder(toInt(r.get("sortOrder"), 0));
        dto.setCreatedAt((String) r.get("createdAt"));
        return dto;
    }

    private Map<String, Object> taskDtoToRow(String id, WbsTaskDTO dto) {
        Map<String, Object> m = new HashMap<>();
        m.put("taskId",         id);
        m.put("wbsProjectId",   dto.getWbsProjectId());
        m.put("wbsCode",        dto.getWbsCode());
        m.put("taskName",       dto.getTaskName());
        m.put("startDate",      dto.getStartDate());
        m.put("endDate",        dto.getEndDate());
        m.put("duration",       dto.getDuration() != null ? dto.getDuration() : 0);
        m.put("progress",       dto.getProgress() != null ? dto.getProgress() : 0);
        m.put("predecessorIds", dto.getPredecessorIds());
        m.put("status",         dto.getStatus() != null ? dto.getStatus() : "NOT_STARTED");
        m.put("responsible",    dto.getResponsible());
        m.put("notes",          dto.getNotes());
        m.put("source",         dto.getSource() != null ? dto.getSource() : "MANUAL");
        m.put("sortOrder",      dto.getSortOrder() != null ? dto.getSortOrder() : 0);
        return m;
    }

    private Long toLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).longValue();
        try { return Long.parseLong(v.toString()); } catch (Exception e) { return null; }
    }

    private int toInt(Object v, int def) {
        if (v == null) return def;
        if (v instanceof Number) return ((Number) v).intValue();
        try { return Integer.parseInt(v.toString()); } catch (Exception e) { return def; }
    }
}
