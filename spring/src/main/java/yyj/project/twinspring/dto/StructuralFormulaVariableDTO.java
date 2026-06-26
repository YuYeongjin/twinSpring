package yyj.project.twinspring.dto;

import lombok.Data;

@Data
public class StructuralFormulaVariableDTO {
    private Long varId;
    private String formulaId;
    private String varName;
    private String varLabel;
    private Double defaultValue;
    private Double minValue;
    private Double maxValue;
    private String unit;
    private String description;
    private Boolean isEditable;

    /** 프로젝트 오버라이드가 적용된 실제 사용 값 (없으면 defaultValue) */
    private Double effectiveValue;
}
