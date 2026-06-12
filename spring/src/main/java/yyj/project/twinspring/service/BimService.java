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
}
