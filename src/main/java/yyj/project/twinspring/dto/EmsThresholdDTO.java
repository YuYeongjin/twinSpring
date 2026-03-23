package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

/**
 * EMS 알람 임계값 설정 DTO
 * 각 위치별, 항목별 알람 기준값을 저장하는 객체
 *
 * 임계값 유형(thresholdType):
 *  - MAX_POWER_KW        : 최대 허용 전력 (kW)
 *  - MIN_POWER_FACTOR    : 최소 허용 역률
 *  - MAX_VOLTAGE         : 최대 허용 전압 (V)
 *  - MIN_VOLTAGE         : 최소 허용 전압 (V)
 *  - DAILY_ENERGY_KWH    : 일일 에너지 목표치 (kWh)
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EmsThresholdDTO {
    private Long id;
    private String thresholdType;   // 임계값 유형
    private String location;        // 적용 위치 (null이면 전체 적용)
    private double thresholdValue;  // 임계값
    private String updatedAt;       // 마지막 수정 시각
}
