package yyj.project.twinspring.serviceImpl;

import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final ObjectMapper objectMapper = new ObjectMapper();

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
            String projectId, StructuralAnalysisRequestDTO req) {

        return Mono.fromCallable(() -> {
            String codeStandard  = req.getCodeStandard();
            String structureType = req.getStructureType();

            // 1. 부재 로드
            List<Map<String, Object>> rawElements = bimDAO.getElementsByProject(projectId);
            List<BimElementDTO> elements = rawElements.stream()
                    .map(this::mapToElementDTO)
                    .collect(Collectors.toList());

            // 2. 공식 변수 effective 값 맵 (안전율·계수 등 코드기준 상수용 — 환경/하중은 req 우선)
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

            // 3. DSM 해석 수행 (사용자 환경/하중 조건 전달)
            StructuralAnalysisResultDTO result = engine.analyze(elements, varMap, req);
            result.setProjectId(projectId);

            // 4. 결과를 DB에 캐시 저장
            try {
                StructuralAnalysisCacheDTO cache = new StructuralAnalysisCacheDTO();
                cache.setProjectId(projectId);
                cache.setResultJson(objectMapper.writeValueAsString(result));
                cache.setParamsJson(objectMapper.writeValueAsString(req));
                structuralDAO.upsertAnalysisCache(cache);
            } catch (Exception e) {
                log.warn("구조해석 캐시 저장 실패 (결과는 정상): {}", e.getMessage());
            }

            return result;

        }).subscribeOn(Schedulers.boundedElastic());
    }

    // ── 마지막 캐시 조회 ─────────────────────────────────────────────────

    @Override
    public Mono<StructuralAnalysisCacheDTO> getLastCache(String projectId) {
        return Mono.fromCallable(() -> structuralDAO.getAnalysisCache(projectId))
                   .subscribeOn(Schedulers.boundedElastic());
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

