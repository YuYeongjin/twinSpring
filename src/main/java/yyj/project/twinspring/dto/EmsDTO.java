package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

/**
 * EMS(에너지 관리 시스템) 에너지 계측 데이터 DTO
 * MQTT 또는 REST를 통해 수신된 전력/에너지 데이터를 담는 객체
 *
 * 필드 설명:
 *  - location    : 계측 위치 (건물명 또는 구역명, 예: "B동 3층")
 *  - zone        : 세부 구역 (예: "HVAC", "조명", "콘센트")
 *  - powerKw     : 현재 소비 전력 (kW, 킬로와트)
 *  - voltage     : 전압 (V, 볼트) - 전력 품질 모니터링에 사용
 *  - currentA    : 전류 (A, 암페어)
 *  - powerFactor : 역률 (0.0 ~ 1.0) - 1에 가까울수록 효율이 높음
 *  - energyKwh   : 누적 전력량 (kWh, 킬로와트시) - 전기요금 계산에 사용
 *  - timestamp   : 데이터 수신 시각 (ISO 8601 형식)
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EmsDTO {
    private String location;
    private String zone;
    private double powerKw;
    private double voltage;
    private double currentA;
    private double powerFactor;
    private double energyKwh;
    private String timestamp;
}
