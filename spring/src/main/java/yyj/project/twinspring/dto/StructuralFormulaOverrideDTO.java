package yyj.project.twinspring.dto;

import lombok.Data;

@Data
public class StructuralFormulaOverrideDTO {
    private Long overrideId;
    private String projectId;
    private String formulaId;
    private String varName;
    private Double customValue;
}
