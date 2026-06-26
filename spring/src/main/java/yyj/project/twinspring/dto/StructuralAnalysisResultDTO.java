package yyj.project.twinspring.dto;

import lombok.Data;
import java.util.List;
import java.util.Map;

@Data
public class StructuralAnalysisResultDTO {
    private String projectId;
    private String codeStandard;
    private String structureType;

    /** 부재별 해석 결과 */
    private List<MemberResult> members;

    /** 전체 요약 통계 */
    private Summary summary;

    /** 적용된 하중값 (카테고리 → 값) */
    private Map<String, Double> appliedLoads;

    @Data
    public static class MemberResult {
        private String elementId;
        private String elementType;       // IfcColumn | IfcBeam | IfcMember | IfcPier
        private Double axialForce;        // kN
        private Double shearForce;        // kN
        private Double bendingMoment;     // kN·m
        private Double normalStress;      // MPa
        private Double shearStress;       // MPa
        private Double utilization;       // σ_Ed / σ_Rd (Eurocode) or σ/f_allow (KDS)
        private String status;            // Safe | Warning | Danger
        private Double safetyFactor;      // KDS용 SF
        private Double allowStress;        // MPa — 재료 기준 허용 수직응력 (표시용)
        private String dominantStressType;// AXIAL | BENDING_STRONG | BENDING_WEAK | SHEAR
        private String failureReason;     // 사람이 읽을 수 있는 원인 설명
        private String remediation;       // 보완 권고사항
    }

    @Data
    public static class Summary {
        private int totalMembers;
        private int safeCount;
        private int warningCount;
        private int dangerCount;
        private Double maxUtilization;
        private Double totalDeadLoad;  // kN
        private Double totalLiveLoad;  // kN
        private Double totalWindLoad;  // kN
        private Double totalSeismicForce; // kN
        private Double governingCombo; // 지배 하중조합 번호
    }
}
