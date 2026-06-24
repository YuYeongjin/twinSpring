package yyj.project.twinspring.service;

import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.*;

import java.util.List;

public interface StructuralService {

    /** 코드기준 + 구조물 유형별 공식 목록 (변수 포함) */
    Mono<List<StructuralFormulaDTO>> getFormulas(String codeStandard, String structureType, String projectId);

    /** 프로젝트 변수 오버라이드 저장 */
    Mono<Void> upsertOverride(StructuralFormulaOverrideDTO override);

    /** 단일 오버라이드 삭제 */
    Mono<Void> deleteOverride(String projectId, String formulaId, String varName);

    /** 프로젝트 전체 오버라이드 초기화 */
    Mono<Void> resetOverrides(String projectId);

    /** DSM 구조해석 수행 */
    Mono<StructuralAnalysisResultDTO> analyze(String projectId, String codeStandard, String structureType);
}
