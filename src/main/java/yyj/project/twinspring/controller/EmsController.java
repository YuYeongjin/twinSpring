package yyj.project.twinspring.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import yyj.project.twinspring.dto.EmsAlertDTO;
import yyj.project.twinspring.dto.EmsDTO;
import yyj.project.twinspring.dto.EmsThresholdDTO;
import yyj.project.twinspring.service.EmsService;

import java.util.List;
import java.util.Map;

/**
 * EMS(에너지 관리 시스템) REST API 컨트롤러
 *
 * API 엔드포인트 목록:
 *  GET  /api/ems/summary       - EMS 대시보드 전체 요약
 *  GET  /api/ems/latest        - 최신 에너지 계측 데이터
 *  GET  /api/ems/logs          - 에너지 계측 이력 (최근 100건)
 *  GET  /api/ems/zone          - 구역별 에너지 소비 현황
 *  GET  /api/ems/trend/hourly  - 시간별 에너지 추이 (24시간)
 *  GET  /api/ems/trend/daily   - 일별 에너지 요약 (30일)
 *  GET  /api/ems/cost          - 에너지 비용 계산
 *  POST /api/ems/data          - 에너지 데이터 직접 입력 (REST 방식)
 *  GET  /api/ems/alerts        - 미해결 알람 목록
 *  GET  /api/ems/alerts/history- 알람 이력
 *  PUT  /api/ems/alerts/{id}/resolve - 알람 해결 처리
 *  POST /api/ems/threshold     - 임계값 설정
 *  GET  /api/ems/threshold     - 임계값 조회
 */
@RestController
@RequestMapping("/api/ems")
public class EmsController {

    private final EmsService emsService;

    public EmsController(EmsService emsService) {
        this.emsService = emsService;
    }

    /**
     * EMS 대시보드 메인 요약 데이터
     * 현재 전력, 누적 kWh, 예상 요금, 알람 수, 구역별 현황을 한 번에 반환
     */
    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> getSummary() {
        return ResponseEntity.ok(emsService.getEmsSummary());
    }

    /**
     * 최신 에너지 계측 데이터 반환
     * 현재 전력(kW), 전압, 전류, 역률, 누적 전력량(kWh) 포함
     */
    @GetMapping("/latest")
    public ResponseEntity<EmsDTO> getLatest() {
        return ResponseEntity.ok(emsService.getLatestEnergyData());
    }

    /**
     * 에너지 계측 이력 반환 (최근 100건)
     * 시계열 차트 렌더링에 사용
     */
    @GetMapping("/logs")
    public ResponseEntity<List<Map<String, Object>>> getLogs() {
        return ResponseEntity.ok(emsService.getEnergyLogs());
    }

    /**
     * 구역별 에너지 소비 현황
     * 파이 차트 또는 막대 차트로 각 구역(HVAC, 조명, 콘센트 등)의 소비량 비교
     */
    @GetMapping("/zone")
    public ResponseEntity<List<Map<String, Object>>> getZoneData() {
        return ResponseEntity.ok(emsService.getEnergyByZone());
    }

    /**
     * 시간별 에너지 추이 (최근 24시간)
     * 시간대별 피크 전력 분석에 사용
     */
    @GetMapping("/trend/hourly")
    public ResponseEntity<List<Map<String, Object>>> getHourlyTrend() {
        return ResponseEntity.ok(emsService.getHourlyTrend());
    }

    /**
     * 일별 에너지 요약 (최근 30일)
     * 월간 에너지 소비 패턴 분석 및 절감 목표 대비 현황 파악에 사용
     */
    @GetMapping("/trend/daily")
    public ResponseEntity<List<Map<String, Object>>> getDailyTrend() {
        return ResponseEntity.ok(emsService.getDailySummary());
    }

    /**
     * 에너지 비용 계산
     * @param kwh 전력량 (kWh) - 쿼리 파라미터로 전달
     * @return 예상 전기요금 (원)
     */
    @GetMapping("/cost")
    public ResponseEntity<Map<String, Object>> calculateCost(@RequestParam double kwh) {
        double cost = emsService.calculateEnergyCost(kwh);
        return ResponseEntity.ok(Map.of(
                "energyKwh", kwh,
                "estimatedCostKrw", cost,
                "ratePerKwh", 115.0
        ));
    }

    /**
     * REST 방식으로 에너지 데이터 직접 입력
     * MQTT 없이 테스트하거나, HTTP API를 통한 데이터 수집 시 사용
     */
    @PostMapping("/data")
    public ResponseEntity<String> receiveEnergyData(@RequestBody EmsDTO data) {
        emsService.handleEnergyData(data);
        return ResponseEntity.ok("에너지 데이터 처리 완료");
    }

    /**
     * 미해결 알람 목록 조회
     * 대시보드 알람 패널에 표시 (CRITICAL → WARNING → INFO 순 정렬)
     */
    @GetMapping("/alerts")
    public ResponseEntity<List<EmsAlertDTO>> getActiveAlerts() {
        return ResponseEntity.ok(emsService.getActiveAlerts());
    }

    /**
     * 알람 이력 조회 (최근 50건)
     * 과거 알람 분석 및 재발 방지 검토에 사용
     */
    @GetMapping("/alerts/history")
    public ResponseEntity<List<EmsAlertDTO>> getAlertHistory() {
        return ResponseEntity.ok(emsService.getAlertHistory());
    }

    /**
     * 알람 해결 처리
     * 담당자가 조치 완료 후 알람을 닫을 때 호출
     * @param id 해결할 알람 ID
     */
    @PutMapping("/alerts/{id}/resolve")
    public ResponseEntity<String> resolveAlert(@PathVariable Long id) {
        emsService.resolveAlert(id);
        return ResponseEntity.ok("알람 해결 처리 완료 (id=" + id + ")");
    }

    /**
     * 알람 임계값 설정
     * 위치별, 항목별 알람 기준값을 설정 또는 변경
     * Body 예시: {"thresholdType": "MAX_POWER_KW", "location": "B동", "thresholdValue": 30.0}
     */
    @PostMapping("/threshold")
    public ResponseEntity<String> setThreshold(@RequestBody EmsThresholdDTO threshold) {
        emsService.setThreshold(threshold);
        return ResponseEntity.ok("임계값 설정 완료");
    }

    /**
     * 임계값 목록 조회
     * 현재 설정된 모든 알람 임계값 반환
     */
    @GetMapping("/threshold")
    public ResponseEntity<List<EmsThresholdDTO>> getThresholds() {
        return ResponseEntity.ok(emsService.getAllThresholds());
    }
}
