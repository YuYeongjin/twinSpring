package yyj.project.twinspring.service;


import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MultipartFile;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.BimElementColorDTO;
import yyj.project.twinspring.dto.BimElementDTO;
import yyj.project.twinspring.dto.BimLayerDTO;
import yyj.project.twinspring.dto.BimLineDTO;
import yyj.project.twinspring.dto.BimProjectDTO;
import yyj.project.twinspring.dto.BimStoreyDTO;
import yyj.project.twinspring.dto.BimWbsNodeDTO;

import java.io.InputStream;
import java.util.List;
import java.util.Map;

public interface BimService {

    Mono<String> getModelData(String projectId);

    Mono<List<BimProjectDTO>> getProjectList();

    ResponseEntity<Mono<List<BimElementDTO>>> getModelElements(String projectId);

    ResponseEntity<Mono<Void>> deleteProject(String projectId);

    ResponseEntity<Mono<Void>> updateElement(BimElementDTO element);

    Mono<ResponseEntity<Void>> newProject(String category);

    Mono<BimProjectDTO> createProject(BimProjectDTO project);

    ResponseEntity<Mono<List<BimElementDTO>>> getProject(String projectId);

    /** 단일 부재 신규 생성 (C# POST /api/bim/element 호출) */
    Mono<BimElementDTO> createElement(BimElementDTO element);

    /** 특정 좌표에 부재 생성 (elementType·projectId·좌표 지정, 크기는 타입별 기본값 적용) */
    Mono<BimElementDTO> createElementAt(String projectId, String elementType, String material,
                                        double x, double y, double z);

    /** 복합 구조물 배치 생성 (교각·골조 등 다수 부재 일괄 생성) */
    Mono<List<BimElementDTO>> createElements(List<BimElementDTO> elements);

    /** 단일 부재 삭제 (C# DELETE /api/bim/element/{elementId} 호출) */
    ResponseEntity<Mono<Void>> deleteElement(String elementId);

    // ── 레이어 (로컬 MariaDB) ──────────────────────────────────────
    List<BimLayerDTO> getLayersByProject(String projectId);
    BimLayerDTO createLayer(BimLayerDTO layer);
    void createLayersBatch(List<BimLayerDTO> layers);
    BimLayerDTO updateLayer(BimLayerDTO layer);
    void deleteLayer(String layerId);

    // ── 부재 커스텀 색상 (로컬 MariaDB) ───────────────────────────
    List<BimElementColorDTO> getColorsByProject(String projectId);
    void upsertColor(BimElementColorDTO colorDTO);
    void deleteColor(String elementId);

    // ── 선 (로컬 MariaDB) ──────────────────────────────────────────
    List<BimLineDTO> getLinesByProject(String projectId);
    BimLineDTO createLine(BimLineDTO line);
    /** 다수 선 일괄 삽입 — 도면 사진 변환 등 대량 삽입에 사용 */
    List<BimLineDTO> createLinesBatch(List<BimLineDTO> lines);
    BimLineDTO updateLine(BimLineDTO line);
    void deleteLine(String lineId);
    void deleteLinesByProject(String projectId);

    // ── 프로젝트 이름 수정 ─────────────────────────────────────────
    Mono<BimProjectDTO> renameProject(String projectId, String newName);

    // ── BIM 통계 / 내보내기 ────────────────────────────────────────
    List<BimProjectDTO> getBimProjectsFromDb();
    List<Map<String, Object>> getBimElementStats(String projectId);
    String exportBimElementsCsv(String projectId);

    // ── 구조 분석 (C# 서버 프록시) ────────────────────────────────
    Mono<Map<String, Object>> getStructuralAnalysis(String projectId);

    // ── 층(BuildingStorey) ──────────────────────────────────────────
    List<BimStoreyDTO> getStoreysByProject(String projectId);
    void saveStoreys(List<BimStoreyDTO> storeys);
    void deleteStoreysByProject(String projectId);

    // ── WBS 노드 ────────────────────────────────────────────────────
    List<BimWbsNodeDTO> getWbsByProject(String projectId);
    void saveWbsNodes(List<BimWbsNodeDTO> nodes);
    void updateWbsProgress(String wbsId, int progress);
    void deleteWbsByProject(String projectId);

    // ── WBS 진척도 요약 (통합관제 시각화용) ────────────────────────
    Map<String, Object> getWbsProgressSummary(String projectId);

    // ── 부재 ↔ WBS 매핑 ────────────────────────────────────────────
    List<Map<String, Object>> getElementWbsMappings(String projectId);
    void saveElementWbsMappings(List<Map<String, Object>> mappings);
    List<String> getElementIdsByWbs(String wbsId);
    String getWbsIdByElement(String elementId);

    // ── IFC 원본 파일 Object Storage 연동 ──────────────────────────

    /**
     * IFC 원본 파일을 Object Storage에 업로드하고 bim_project에 storage_key를 저장한다.
     * 파싱 성공 후 비동기로 호출되므로 예외 발생 시 프로젝트 생성 흐름에 영향을 주지 않는다.
     *
     * @param projectId 대상 프로젝트 ID
     * @param file      업로드할 MultipartFile (원본 IFC)
     * @return 저장된 storage key
     */
    String uploadIfcFile(String projectId, MultipartFile file);

    /**
     * Object Storage에서 IFC 원본 파일 스트림을 반환한다.
     * 호출자가 스트림을 닫아야 한다.
     *
     * @param projectId 대상 프로젝트 ID
     * @return IFC 파일 InputStream
     */
    InputStream downloadIfcFile(String projectId);

    /**
     * 프로젝트의 storage_key 조회 (삭제 연동 및 재분석 진입점용)
     *
     * @param projectId 대상 프로젝트 ID
     * @return storage key (없으면 null)
     */
    String getStorageKey(String projectId);

    /**
     * IFC 파일을 Python 변환 서비스로 전송해 GLB로 변환하고
     * GLB는 Minio에, 부재/층 정보는 DB에 저장한다.
     */
    Mono<Map<String, Object>> convertAndStoreIfc(String projectId, MultipartFile file);

    /** GLB 파일을 Minio에 업로드하고 glb_storage_key를 DB에 저장한다. */
    String uploadGlbFile(String projectId, byte[] glbBytes);

    /** Minio에서 GLB 파일 스트림을 반환한다. */
    InputStream downloadGlbFile(String projectId);

    /** GLB storage key 조회 (없으면 null). */
    String getGlbStorageKey(String projectId);

    /**
     * 프로젝트 전체 부재를 지정 오프셋만큼 일괄 이동합니다.
     * C# 서버에 부재 수만큼 PUT 요청을 병렬로 전송합니다.
     *
     * @param projectId 대상 프로젝트 ID
     * @param deltaX    X축 이동량 (미터, 음수 가능)
     * @param deltaY    Y축 이동량 (미터, 음수 가능)
     * @param deltaZ    Z축 이동량 (미터, 음수 가능)
     * @return {success, updated, projectId, deltaX, deltaY, deltaZ}
     */
    Mono<Map<String, Object>> translateProjectElements(String projectId, double deltaX, double deltaY, double deltaZ);

    /**
     * 선택된 부재들만 지정 오프셋만큼 이동합니다.
     *
     * @param projectId  대상 프로젝트 ID
     * @param elementIds 이동할 부재 ID 목록
     * @param deltaX     X축 이동량 (미터)
     * @param deltaY     Y축 이동량 (미터)
     * @param deltaZ     Z축 이동량 (미터)
     * @return {success, updated, skipped, projectId, deltaX, deltaY, deltaZ}
     */
    Mono<Map<String, Object>> translateSelectedElements(String projectId, List<String> elementIds,
                                                        double deltaX, double deltaY, double deltaZ);

    /**
     * 부재 통합 변환 (이동·회전·크기 동시 적용).
     * elementIds 가 null 이면 프로젝트 전체, 비어있지 않으면 해당 부재만 처리합니다.
     *
     * @param projectId  대상 프로젝트 ID
     * @param elementIds 대상 부재 ID 목록 (null = 전체)
     * @param dPosX/Y/Z  위치 오프셋 (미터)
     * @param dRotX/Y/Z  회전 오프셋 (도, degrees)
     * @param sclX/Y/Z   크기 배율 (1.0 = 변화 없음, 2.0 = 2배)
     */
    Mono<Map<String, Object>> transformElements(
            String projectId, List<String> elementIds,
            double dPosX, double dPosY, double dPosZ,
            double dRotX, double dRotY, double dRotZ,
            double sclX,  double sclY,  double sclZ);

    // ── Ollama 층 이름 정규화 ───────────────────────────────────────
    /** IFC 층 이름 목록을 Ollama 3B 모델로 정규화한다. (예: "Story 1" → "1F") */
    Map<String, String> normalizeStoreyNames(List<String> names);
}
