package yyj.project.twinspring.dto;

import lombok.Data;
import java.util.List;

@Data
public class StructuralFormulaDTO {
    private String formulaId;
    private String codeStandard;    // KDS | EUROCODE2
    private String structureType;   // BUILDING | BRIDGE | ALL
    private String category;        // WIND | SEISMIC | DEAD | LIVE | SNOW | TRAFFIC | COMBO | BUCKLING | SAFETY
    private String name;
    private String expression;
    private String description;
    private int sortOrder;

    private List<StructuralFormulaVariableDTO> variables;
}
