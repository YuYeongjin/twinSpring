package yyj.project.twinspring.dao;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import yyj.project.twinspring.dto.StructuralFormulaDTO;
import yyj.project.twinspring.dto.StructuralFormulaVariableDTO;
import yyj.project.twinspring.dto.StructuralFormulaOverrideDTO;

import java.util.List;

@Mapper
public interface StructuralDAO {

    // ── 공식 조회 ───────────────────────────────────────────────────────
    List<StructuralFormulaDTO> getFormulas(
            @Param("codeStandard")  String codeStandard,
            @Param("structureType") String structureType
    );

    StructuralFormulaDTO getFormulaById(@Param("formulaId") String formulaId);

    // ── 변수 조회 ───────────────────────────────────────────────────────
    List<StructuralFormulaVariableDTO> getVariablesByFormula(@Param("formulaId") String formulaId);

    // ── 프로젝트 오버라이드 ──────────────────────────────────────────────
    List<StructuralFormulaOverrideDTO> getOverridesByProject(@Param("projectId") String projectId);

    StructuralFormulaOverrideDTO getOverride(
            @Param("projectId")  String projectId,
            @Param("formulaId")  String formulaId,
            @Param("varName")    String varName
    );

    void upsertOverride(StructuralFormulaOverrideDTO override);

    void deleteOverride(
            @Param("projectId")  String projectId,
            @Param("formulaId")  String formulaId,
            @Param("varName")    String varName
    );

    void deleteAllOverridesByProject(@Param("projectId") String projectId);
}
