package yyj.project.twinspring.serviceImpl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import yyj.project.twinspring.dao.BimDAO;
import yyj.project.twinspring.dao.StructuralDAO;
import yyj.project.twinspring.dto.*;
import yyj.project.twinspring.service.StructuralService;
import yyj.project.twinspring.structural.StructuralAnalysisEngine;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class StructuralServiceImpl implements StructuralService {

    private static final Logger log = LoggerFactory.getLogger(StructuralServiceImpl.class);

    private final StructuralDAO structuralDAO;
    private final BimDAO        bimDAO;
    private final StructuralAnalysisEngine engine = new StructuralAnalysisEngine();

    public StructuralServiceImpl(StructuralDAO structuralDAO, BimDAO bimDAO) {
        this.structuralDAO = structuralDAO;
        this.bimDAO        = bimDAO;
    }

    // ── 공식 목록 (오버라이드 effective_value 반영) ───────────────────

    @Override
    public Mono<List<StructuralFormulaDTO>> getFormulas(
            String codeStandard, String structureType, String projectId) {

        return Mono.fromCallable(() -> {
            List<StructuralFormulaDTO> formulas =
                    structuralDAO.getFormulas(codeStandard, structureType);

            // 오버라이드 맵 구성
            Map<String, Map<String, Double>> overrideMap = new HashMap<>();
            if (projectId != null && !projectId.isBlank()) {
                for (StructuralFormulaOverrideDTO ov : structuralDAO.getOverridesByProject(projectId)) {
                    overrideMap
                            .computeIfAbsent(ov.getFormulaId(), k -> new HashMap<>())
                            .put(ov.getVarName(), ov.getCustomValue());
                }
            }

            // effectiveValue 적용
            for (StructuralFormulaDTO formula : formulas) {
                if (formula.getVariables() == null) continue;
                Map<String, Double> fOverride = overrideMap.getOrDefault(formula.getFormulaId(), Map.of());
                for (StructuralFormulaVariableDTO v : formula.getVariables()) {
                    if (fOverride.containsKey(v.getVarName())) {
                        v.setEffectiveValue(fOverride.get(v.getVarName()));
                    } else {
                        v.setEffectiveValue(v.getDefaultValue());
                    }
                }
            }
            return formulas;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    // ── 오버라이드 저장 ──────────────────────────────────────────────

    @Override
    public Mono<Void> upsertOverride(StructuralFormulaOverrideDTO override) {
        return Mono.fromRunnable(() -> structuralDAO.upsertOverride(override))
                   .subscribeOn(Schedulers.boundedElastic())
                   .then();
    }

    @Override
    public Mono<Void> deleteOverride(String projectId, String formulaId, String varName) {
        return Mono.fromRunnable(() -> structuralDAO.deleteOverride(projectId, formulaId, varName))
                   .subscribeOn(Schedulers.boundedElastic())
                   .then();
    }

    @Override
    public Mono<Void> resetOverrides(String projectId) {
        return Mono.fromRunnable(() -> structuralDAO.deleteAllOverridesByProject(projectId))
                   .subscribeOn(Schedulers.boundedElastic())
                   .then();
    }

    // ── DSM 구조해석 ─────────────────────────────────────────────────

    @Override
    public Mono<StructuralAnalysisResultDTO> analyze(
            String projectId, String codeStandard, String structureType) {

        return Mono.fromCallable(() -> {
            // 1. 부재 로드
            List<Map<String, Object>> rawElements = bimDAO.getElementsByProject(projectId);
            List<BimElementDTO> elements = rawElements.stream()
                    .map(this::mapToElementDTO)
                    .collect(Collectors.toList());

            // 2. 공식 변수 effective 값 맵 구성
            List<StructuralFormulaDTO> formulas =
                    structuralDAO.getFormulas(codeStandard, structureType);

            Map<String, Map<String, Double>> overrideMap = new HashMap<>();
            for (StructuralFormulaOverrideDTO ov : structuralDAO.getOverridesByProject(projectId)) {
                overrideMap.computeIfAbsent(ov.getFormulaId(), k -> new HashMap<>())
                           .put(ov.getVarName(), ov.getCustomValue());
            }

            Map<String, Map<String, Double>> varMap = new HashMap<>();
            for (StructuralFormulaDTO f : formulas) {
                Map<String, Double> vars = new HashMap<>();
                if (f.getVariables() != null) {
                    Map<String, Double> fOv = overrideMap.getOrDefault(f.getFormulaId(), Map.of());
                    for (StructuralFormulaVariableDTO v : f.getVariables()) {
                        vars.put(v.getVarName(),
                                fOv.getOrDefault(v.getVarName(), v.getDefaultValue()));
                    }
                }
                varMap.put(f.getFormulaId(), vars);
            }

            // 3. 해석 수행
            StructuralAnalysisResultDTO result =
                    engine.analyze(elements, varMap, codeStandard, structureType);
            result.setProjectId(projectId);
            return result;

        }).subscribeOn(Schedulers.boundedElastic());
    }

    // ── 내부 변환 ────────────────────────────────────────────────────

    private BimElementDTO mapToElementDTO(Map<String, Object> row) {
        BimElementDTO e = new BimElementDTO();
        e.setElementId  (str(row, "elementId"));
        e.setProjectId  (str(row, "projectId"));
        e.setElementType(str(row, "elementType"));
        e.setMaterial   (str(row, "material"));
        e.setPositionX  (dbl(row, "positionX"));
        e.setPositionY  (dbl(row, "positionY"));
        e.setPositionZ  (dbl(row, "positionZ"));
        e.setSizeX      (dbl(row, "sizeX"));
        e.setSizeY      (dbl(row, "sizeY"));
        e.setSizeZ      (dbl(row, "sizeZ"));
        return e;
    }

    private String str(Map<String, Object> row, String key) {
        Object v = row.get(key);
        return v == null ? null : v.toString();
    }

    private Double dbl(Map<String, Object> row, String key) {
        Object v = row.get(key);
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(v.toString()); } catch (Exception e) { return null; }
    }
}
