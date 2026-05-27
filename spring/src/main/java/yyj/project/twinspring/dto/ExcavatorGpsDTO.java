package yyj.project.twinspring.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

/**
 * 굴착기 GPS / IMU 실시간 패킷 DTO
 *
 * 모션 센서(스마트폰 / IoT 장치)가 POST /api/excavator/gps 로 전송하는 데이터 구조.
 * Spring 서버는 이 패킷을 /topic/excavator WebSocket 토픽으로 브로드캐스트한다.
 *
 * 필드 설명
 *  - lat / lng       : GPS 위도·경도 (WGS84)
 *  - heading         : 진행 방향 (0° = North, 시계 방향, 0~360)
 *  - boomAngle       : 붐 각도 (°, 0~80)  ← 센서에서 직접 제공할 때
 *  - armAngle        : 암  각도 (°, -20~120)
 *  - bucketAngle     : 버킷 각도 (°, -90~30)
 *  - swingAngle      : 선회 각도 (°, 상대값)
 *  - alpha / beta / gamma : DeviceOrientation API 값 (°)
 *                      alpha = yaw (0~360), beta = pitch (-180~180), gamma = roll (-90~90)
 *  - speed           : 이동 속도 (m/s, 선택적)
 *  - timestamp       : 패킷 발생 시각 (ISO-8601 문자열, 선택적)
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ExcavatorGpsDTO {

    // ── 위치 ──────────────────────────────────────────────────────────
    private Double lat;
    private Double lng;
    private Double heading;   // 0~360°, 진북 기준 시계방향

    // ── 관절 각도 (센서가 직접 제공하는 경우) ─────────────────────────
    private Double boomAngle;
    private Double armAngle;
    private Double bucketAngle;
    private Double swingAngle;

    // ── IMU 원시 데이터 (DeviceOrientation API 또는 IMU 센서) ─────────
    private Double alpha;   // yaw   (0 ~ 360)
    private Double beta;    // pitch (-180 ~ 180)
    private Double gamma;   // roll  (-90 ~ 90)

    // ── 추가 정보 (선택) ───────────────────────────────────────────────
    private Double speed;        // m/s
    private String timestamp;    // ISO-8601
}
