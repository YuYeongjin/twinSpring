package yyj.project.twinspring.dto;

import lombok.Data;

@Data
public class BimWbsNodeDTO {
    private String  wbsId;
    private String  projectId;
    private String  parentWbsId;
    private String  wbsCode;
    private String  wbsName;
    private String  nodeType;      // PROJECT | BUILDING | STOREY | TASK
    private String  building;
    private String  storey;
    private String  elementType;
    private Integer elementCount;
    private Integer progress;
    private Integer sortOrder;
    private Double  quantity;
    private String  unit;
    private String  formula;
    private String  reason;
    private String  standard;
}
