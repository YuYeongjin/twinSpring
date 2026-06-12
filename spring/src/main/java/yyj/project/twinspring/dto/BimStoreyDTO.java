package yyj.project.twinspring.dto;

import lombok.Data;

@Data
public class BimStoreyDTO {
    private String  storeyId;
    private String  projectId;
    private String  storeyName;
    private Double  elevation;
    private String  building;
    private Integer sortOrder;
}
