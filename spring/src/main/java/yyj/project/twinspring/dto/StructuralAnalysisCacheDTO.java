package yyj.project.twinspring.dto;

import lombok.Data;
import java.time.OffsetDateTime;

@Data
public class StructuralAnalysisCacheDTO {
    private String projectId;
    private String resultJson;
    private String paramsJson;
    private OffsetDateTime analyzedAt;
}
