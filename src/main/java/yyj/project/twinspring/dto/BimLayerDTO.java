package yyj.project.twinspring.dto;

import lombok.*;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class BimLayerDTO {
    private String layerId;
    private String projectId;
    private String layerName;
    private String color;
    private Boolean visible;
    private List<String> elementIds;
    private Integer sortOrder;
}
