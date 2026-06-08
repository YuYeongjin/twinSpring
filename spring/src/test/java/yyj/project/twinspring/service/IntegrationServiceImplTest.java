package yyj.project.twinspring.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import yyj.project.twinspring.dao.IntegrationDAO;
import yyj.project.twinspring.dto.IntegrationProjectDTO;
import yyj.project.twinspring.serviceImpl.IntegrationServiceImpl;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("통합관제 서비스 단위 테스트")
class IntegrationServiceImplTest {

    @Mock
    private IntegrationDAO integrationDAO;

    @InjectMocks
    private IntegrationServiceImpl integrationService;

    private Map<String, Object> buildRow(String projectId, String projectName,
                                         String bimProjectId, String simConfig) {
        Map<String, Object> row = new HashMap<>();
        row.put("projectId", projectId);
        row.put("projectName", projectName);
        row.put("wbsProjectId", null);
        row.put("bimProjectId", bimProjectId);
        row.put("description", "테스트 설명");
        row.put("simConfig", simConfig);
        row.put("status", "ACTIVE");
        row.put("createdAt", "2026-06-08T00:00:00Z");
        return row;
    }

    // =========================================================================
    // 카테고리 1 : BIM 프로젝트 연결 & 시뮬레이션(장비작업/안전감지) 설정
    // =========================================================================

    @Nested
    @DisplayName("[카테고리 1] BIM 연결 & simConfig 업데이트")
    class BimAndSimConfigTests {

        @Test
        @DisplayName("1-1. BIM 프로젝트 ID가 연결된 통합관제 프로젝트를 정상 생성한다")
        void createProject_withBimId_success() {
            // given
            String bimId = "bim-site-001";
            Map<String, String> body = Map.of(
                    "projectName", "스마트건설 현장 A동",
                    "bimProjectId", bimId,
                    "description", "BIM 기반 현장 관제"
            );
            Map<String, Object> savedRow = buildRow("uuid-generated", "스마트건설 현장 A동", bimId, null);

            doNothing().when(integrationDAO).insertIntegrationProject(any());
            when(integrationDAO.getIntegrationProjectById(anyString())).thenReturn(savedRow);

            // when
            IntegrationProjectDTO result = integrationService.createIntegrationProject(body);

            // then
            assertThat(result).isNotNull();
            assertThat(result.getBimProjectId()).isEqualTo(bimId);
            assertThat(result.getProjectName()).isEqualTo("스마트건설 현장 A동");
            assertThat(result.getStatus()).isEqualTo("ACTIVE");
            verify(integrationDAO).insertIntegrationProject(any());
        }

        @Test
        @DisplayName("1-2. 장비작업 및 안전감지 구역이 포함된 simConfig를 정상 업데이트한다")
        void updateSimConfig_withEquipmentAndHazardZone_success() {
            // given
            String projectId = "proj-001";
            String simConfig = """
                    {
                      "workers": [{"id":"w1","name":"작업자1","zone":"A"}],
                      "equipment": [{"id":"e1","type":"굴삭기","status":"active"}],
                      "hazardZones": [{"id":"hz1","label":"추락위험구역","radius":5.0}]
                    }
                    """;
            doNothing().when(integrationDAO).updateSimConfig(any());

            // when
            integrationService.updateSimConfig(projectId, simConfig);

            // then: DAO에 전달된 파라미터가 projectId와 simConfig를 모두 포함하는지 검증
            verify(integrationDAO).updateSimConfig(argThat(params ->
                    projectId.equals(params.get("projectId")) &&
                    simConfig.equals(params.get("simConfig"))
            ));
        }

        @Test
        @DisplayName("1-3. BIM 연결 프로젝트를 ID로 단건 조회 시 안전감지 simConfig가 정확히 반환된다")
        void getProject_withBimLinked_returnsCorrectSimConfig() {
            // given
            String projectId = "proj-bim-999";
            String bimId = "bim-tower-02";
            String simConfig = "{\"hazardZones\":[{\"id\":\"hz2\",\"label\":\"크레인 반경\",\"radius\":15.0}]}";
            Map<String, Object> row = buildRow(projectId, "타워크레인 관제", bimId, simConfig);

            when(integrationDAO.getIntegrationProjectById(projectId)).thenReturn(row);

            // when
            IntegrationProjectDTO dto = integrationService.getIntegrationProject(projectId);

            // then
            assertThat(dto.getBimProjectId()).isEqualTo(bimId);
            assertThat(dto.getSimConfig()).contains("크레인 반경");
            assertThat(dto.getSimConfig()).contains("15.0");
        }

        @Test
        @DisplayName("1-4. 존재하지 않는 프로젝트 ID 조회 시 null을 반환한다")
        void getProject_notFound_returnsNull() {
            // given
            when(integrationDAO.getIntegrationProjectById("ghost-id")).thenReturn(null);

            // when
            IntegrationProjectDTO result = integrationService.getIntegrationProject("ghost-id");

            // then
            assertThat(result).isNull();
        }
    }

    // =========================================================================
    // 카테고리 2 : WBS 연동 & 프로젝트 목록 관리
    // =========================================================================

    @Nested
    @DisplayName("[카테고리 2] WBS 연동 & 프로젝트 목록 관리")
    class WbsAndListTests {

        @Test
        @DisplayName("2-1. WBS 프로젝트 ID로 필터링된 통합관제 프로젝트 목록을 반환한다")
        void getProjectsByWbs_returnsFilteredList() {
            // given
            String wbsId = "wbs-phase-3";
            List<Map<String, Object>> rows = List.of(
                    buildRow("p1", "3공구 현장관제", "bim-01", null),
                    buildRow("p2", "3공구 안전감지", "bim-02", null)
            );
            when(integrationDAO.getIntegrationProjectsByWbs(wbsId)).thenReturn(rows);

            // when
            List<IntegrationProjectDTO> result = integrationService.getIntegrationProjectsByWbs(wbsId);

            // then
            assertThat(result).hasSize(2);
            assertThat(result)
                    .extracting(IntegrationProjectDTO::getBimProjectId)
                    .containsExactly("bim-01", "bim-02");
        }

        @Test
        @DisplayName("2-2. 전체 프로젝트 목록 조회 시 모든 ACTIVE 프로젝트가 반환된다")
        void getAllProjects_returnsAllActive() {
            // given
            List<Map<String, Object>> rows = List.of(
                    buildRow("p1", "현장A", "bim-a", null),
                    buildRow("p2", "현장B", "bim-b", null),
                    buildRow("p3", "현장C - BIM 미연결", null, null)
            );
            when(integrationDAO.getAllIntegrationProjects()).thenReturn(rows);

            // when
            List<IntegrationProjectDTO> result = integrationService.getIntegrationProjects();

            // then
            assertThat(result).hasSize(3);
            assertThat(result)
                    .filteredOn(dto -> dto.getBimProjectId() == null)
                    .hasSize(1);
        }

        @Test
        @DisplayName("2-3. 프로젝트 정보 업데이트 후 최신 DTO가 반환된다")
        void updateProject_returnsUpdatedDTO() {
            // given
            String projectId = "proj-update-001";
            Map<String, String> body = Map.of(
                    "projectName", "업데이트된 현장",
                    "bimProjectId", "bim-updated",
                    "status", "ACTIVE"
            );
            Map<String, Object> updatedRow = buildRow(projectId, "업데이트된 현장", "bim-updated", null);

            doNothing().when(integrationDAO).updateIntegrationProject(any());
            when(integrationDAO.getIntegrationProjectById(projectId)).thenReturn(updatedRow);

            // when
            IntegrationProjectDTO result = integrationService.updateIntegrationProject(projectId, body);

            // then
            assertThat(result.getProjectName()).isEqualTo("업데이트된 현장");
            assertThat(result.getBimProjectId()).isEqualTo("bim-updated");
            verify(integrationDAO).updateIntegrationProject(any());
        }

        @Test
        @DisplayName("2-4. 프로젝트 삭제 시 DAO의 delete 메서드가 정확히 1회 호출된다")
        void deleteProject_callsDAOOnce() {
            // given
            String projectId = "to-delete-001";
            doNothing().when(integrationDAO).deleteIntegrationProject(projectId);

            // when
            integrationService.deleteIntegrationProject(projectId);

            // then
            verify(integrationDAO, times(1)).deleteIntegrationProject(projectId);
            verifyNoMoreInteractions(integrationDAO);
        }
    }
}
