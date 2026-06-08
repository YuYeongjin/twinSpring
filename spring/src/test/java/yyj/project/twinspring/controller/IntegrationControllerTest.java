package yyj.project.twinspring.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import yyj.project.twinspring.dto.IntegrationProjectDTO;
import yyj.project.twinspring.service.IntegrationService;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(IntegrationController.class)
@DisplayName("통합관제 REST API 컨트롤러 테스트")
class IntegrationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private IntegrationService integrationService;

    @Autowired
    private ObjectMapper objectMapper;

    private IntegrationProjectDTO buildDTO(String id, String name, String bimId, String simConfig) {
        IntegrationProjectDTO dto = new IntegrationProjectDTO();
        dto.setProjectId(id);
        dto.setProjectName(name);
        dto.setBimProjectId(bimId);
        dto.setSimConfig(simConfig);
        dto.setStatus("ACTIVE");
        return dto;
    }

    // =========================================================================
    // 카테고리 1 : 프로젝트 생성 / 조회 API
    // =========================================================================

    @Nested
    @DisplayName("[카테고리 1] 프로젝트 생성 / 조회 API")
    class CreateAndReadApiTests {

        @Test
        @DisplayName("1-1. POST /project - BIM 연결 프로젝트 생성 성공 시 201 응답")
        void createProject_withBimId_returns201() throws Exception {
            // given
            Map<String, String> body = Map.of(
                    "projectName", "신축 아파트 현장",
                    "bimProjectId", "bim-apt-101"
            );
            IntegrationProjectDTO created = buildDTO("new-id", "신축 아파트 현장", "bim-apt-101", null);
            when(integrationService.createIntegrationProject(any())).thenReturn(created);

            // when & then
            mockMvc.perform(post("/api/integration/project")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andDo(print())
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.projectId").value("new-id"))
                    .andExpect(jsonPath("$.bimProjectId").value("bim-apt-101"))
                    .andExpect(jsonPath("$.projectName").value("신축 아파트 현장"))
                    .andExpect(jsonPath("$.status").value("ACTIVE"));
        }

        @Test
        @DisplayName("1-2. POST /project - projectName 누락 시 400 응답, 서비스 미호출")
        void createProject_missingName_returns400() throws Exception {
            // given: projectName 없이 bimProjectId만 포함
            Map<String, String> body = Map.of("bimProjectId", "bim-apt-101");

            // when & then
            mockMvc.perform(post("/api/integration/project")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andExpect(status().isBadRequest());

            verify(integrationService, never()).createIntegrationProject(any());
        }

        @Test
        @DisplayName("1-3. GET /projects - 전체 BIM 연결 프로젝트 목록 조회 시 200 응답")
        void getAllProjects_returns200WithList() throws Exception {
            // given
            List<IntegrationProjectDTO> list = List.of(
                    buildDTO("p1", "현장A", "bim-01", null),
                    buildDTO("p2", "현장B", "bim-02", null)
            );
            when(integrationService.getIntegrationProjects()).thenReturn(list);

            // when & then
            mockMvc.perform(get("/api/integration/projects"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.length()").value(2))
                    .andExpect(jsonPath("$[0].bimProjectId").value("bim-01"))
                    .andExpect(jsonPath("$[1].bimProjectId").value("bim-02"));
        }

        @Test
        @DisplayName("1-4. GET /project/{id} - 존재하지 않는 ID 조회 시 404 응답")
        void getProject_notFound_returns404() throws Exception {
            // given
            when(integrationService.getIntegrationProject("ghost")).thenReturn(null);

            // when & then
            mockMvc.perform(get("/api/integration/project/ghost"))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("1-5. GET /projects?wbsProjectId=xxx - WBS 기반 필터링 조회 시 200 응답")
        void getProjectsByWbs_returns200() throws Exception {
            // given
            List<IntegrationProjectDTO> list = List.of(
                    buildDTO("p1", "3공구 현장", "bim-03", null)
            );
            when(integrationService.getIntegrationProjectsByWbs("wbs-phase-3")).thenReturn(list);

            // when & then
            mockMvc.perform(get("/api/integration/projects")
                            .param("wbsProjectId", "wbs-phase-3"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.length()").value(1))
                    .andExpect(jsonPath("$[0].projectName").value("3공구 현장"));

            // WBS 필터 호출 검증
            verify(integrationService).getIntegrationProjectsByWbs("wbs-phase-3");
            verify(integrationService, never()).getIntegrationProjects();
        }
    }

    // =========================================================================
    // 카테고리 2 : 장비작업 / 안전감지 시뮬레이션 설정 API
    // =========================================================================

    @Nested
    @DisplayName("[카테고리 2] 장비작업 / 안전감지 simConfig API")
    class SimConfigApiTests {

        @Test
        @DisplayName("2-1. PUT /project/{id}/sim-config - 굴삭기 및 추락위험 구역 설정 업데이트 시 200 응답")
        void updateSimConfig_withEquipmentAndHazard_returns200() throws Exception {
            // given
            String simConfig = """
                    {
                      "equipment": [{"id":"e1","type":"굴삭기","status":"active"}],
                      "hazardZones": [{"id":"hz1","label":"추락위험","radius":5.0}]
                    }
                    """;
            Map<String, String> body = Map.of("simConfig", simConfig);
            doNothing().when(integrationService).updateSimConfig(anyString(), anyString());

            // when & then
            mockMvc.perform(put("/api/integration/project/proj-001/sim-config")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andExpect(status().isOk());

            verify(integrationService).updateSimConfig(eq("proj-001"), anyString());
        }

        @Test
        @DisplayName("2-2. PUT /sim-config - simConfig 키 누락 시 400 응답")
        void updateSimConfig_missingKey_returns400() throws Exception {
            // given: simConfig 키 없이 잘못된 키 전송
            Map<String, String> body = Map.of("wrongKey", "value");

            // when & then
            mockMvc.perform(put("/api/integration/project/proj-001/sim-config")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andExpect(status().isBadRequest());

            verify(integrationService, never()).updateSimConfig(any(), any());
        }

        @Test
        @DisplayName("2-3. PUT /project/{id} - 안전감지 설정이 포함된 프로젝트 정보 업데이트 시 200 응답")
        void updateProject_withSafetyConfig_returns200() throws Exception {
            // given
            Map<String, String> body = Map.of(
                    "projectName", "안전감지 고도화 현장",
                    "bimProjectId", "bim-safety-01",
                    "status", "ACTIVE"
            );
            IntegrationProjectDTO updated = buildDTO("proj-s1", "안전감지 고도화 현장", "bim-safety-01", null);
            when(integrationService.updateIntegrationProject(eq("proj-s1"), any())).thenReturn(updated);

            // when & then
            mockMvc.perform(put("/api/integration/project/proj-s1")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.projectName").value("안전감지 고도화 현장"))
                    .andExpect(jsonPath("$.bimProjectId").value("bim-safety-01"));
        }

        @Test
        @DisplayName("2-4. DELETE /project/{id} - 통합관제 프로젝트 삭제 시 204 응답")
        void deleteProject_returns204() throws Exception {
            // given
            doNothing().when(integrationService).deleteIntegrationProject("to-delete");

            // when & then
            mockMvc.perform(delete("/api/integration/project/to-delete"))
                    .andExpect(status().isNoContent());

            verify(integrationService).deleteIntegrationProject("to-delete");
        }
    }
}
