package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import yyj.project.twinspring.dto.*;
import yyj.project.twinspring.service.StructuralService;

import java.util.List;

@RestController
@RequestMapping("/api/structural")
public class StructuralController {

    private final StructuralService structuralService;

    public StructuralController(StructuralService structuralService) {
        this.structuralService = structuralService;
    }

    /**
     * GET /api/structural/formulas?codeStandard=KDS&structureType=BUILDING&projectId=xxx
     * 공식 목록 + 변수 (effectiveValue 포함)
     */
    @GetMapping("/formulas")
    public Mono<ResponseEntity<List<StructuralFormulaDTO>>> getFormulas(
            @RequestParam String codeStandard,
            @RequestParam String structureType,
            @RequestParam(required = false) String projectId) {

        return structuralService
                .getFormulas(codeStandard, structureType, projectId)
                .map(ResponseEntity::ok);
    }

    /**
     * PUT /api/structural/overrides
     * Body: { projectId, formulaId, varName, customValue }
     */
    @PutMapping("/overrides")
    public Mono<ResponseEntity<Void>> upsertOverride(
            @RequestBody StructuralFormulaOverrideDTO override) {

        return structuralService.upsertOverride(override)
                .then(Mono.just(ResponseEntity.<Void>ok().build()));
    }

    /**
     * DELETE /api/structural/overrides/{projectId}/{formulaId}/{varName}
     */
    @DeleteMapping("/overrides/{projectId}/{formulaId}/{varName}")
    public Mono<ResponseEntity<Void>> deleteOverride(
            @PathVariable String projectId,
            @PathVariable String formulaId,
            @PathVariable String varName) {

        return structuralService.deleteOverride(projectId, formulaId, varName)
                .then(Mono.just(ResponseEntity.<Void>noContent().build()));
    }

    /**
     * DELETE /api/structural/overrides/{projectId}
     * 프로젝트의 모든 오버라이드 초기화
     */
    @DeleteMapping("/overrides/{projectId}")
    public Mono<ResponseEntity<Void>> resetOverrides(@PathVariable String projectId) {
        return structuralService.resetOverrides(projectId)
                .then(Mono.just(ResponseEntity.<Void>noContent().build()));
    }

    /**
     * POST /api/structural/analyze/{projectId}?codeStandard=KDS&structureType=BUILDING
     * DSM 구조해석 수행
     */
    @PostMapping("/analyze/{projectId}")
    public Mono<ResponseEntity<StructuralAnalysisResultDTO>> analyze(
            @PathVariable String projectId,
            @RequestParam(defaultValue = "KDS")      String codeStandard,
            @RequestParam(defaultValue = "BUILDING") String structureType) {

        return structuralService.analyze(projectId, codeStandard, structureType)
                .map(ResponseEntity::ok);
    }
}
