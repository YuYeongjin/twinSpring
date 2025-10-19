package yyj.project.twinspring.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class BimElementDTO {
    private String elementId;
    private String projectId;
    private String elementType;
    private String material;

    private String positionData;
    private String sizeData;
}
