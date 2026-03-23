package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

/**
 * EMS 알람(경보) 데이터 DTO
 * 에너지 임계값 초과, 전력 품질 이상 등의 알람 정보를 담는 객체
 *
 * 알람 유형(alertType):
 *  - OVER_POWER       : 소비 전력이 임계값 초과 (과부하 위험)
 *  - LOW_POWER_FACTOR : 역률이 기준치 미만 (에너지 손실 발생)
 *  - HIGH_VOLTAGE     : 전압이 정격 범위 초과 (설비 손상 위험)
 *  - LOW_VOLTAGE      : 전압이 정격 범위 미만 (오작동 위험)
 *  - HIGH_ENERGY      : 누적 에너지가 목표 대비 초과
 *
 * 심각도(severity):
 *  - INFO     : 정보성 (조치 불필요)
 *  - WARNING  : 경고 (모니터링 강화 필요)
 *  - CRITICAL : 위험 (즉각 조치 필요)
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EmsAlertDTO {
    private Long id;
    private String alertType;      // 알람 유형
    private String severity;       // 심각도: INFO / WARNING / CRITICAL
    private String message;        // 알람 메시지 (사람이 읽는 설명)
    private String location;       // 발생 위치
    private double thresholdValue; // 설정된 임계값
    private double currentValue;   // 실제 측정값
    private boolean resolved;      // 해결 여부 (true=해결됨)
    private String timestamp;      // 알람 발생 시각
}
