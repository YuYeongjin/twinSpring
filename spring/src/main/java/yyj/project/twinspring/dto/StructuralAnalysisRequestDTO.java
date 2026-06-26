package yyj.project.twinspring.dto;

import lombok.Data;

/**
 * 사용자가 설정한 환경 조건 및 하중 조건을 DSM 해석 엔진에 전달하는 요청 DTO.
 * 사이드바 슬라이더/입력값이 그대로 매핑됨.
 */
@Data
public class StructuralAnalysisRequestDTO {

    // ── 코드기준 & 구조물 유형 ──────────────────────────────────────────
    private String codeStandard  = "KDS";       // KDS | EUROCODE2
    private String structureType = "BUILDING";  // BUILDING | BRIDGE

    // ── 환경 조건 ──────────────────────────────────────────────────────
    private double windSpeed    = 30.0;   // m/s   — 설계풍속
    private int    seismicZone  = 2;      // 1~4   — 지진구역 (프론트 SEISMIC_ZONES 인덱스)
    private double snowLoad     = 0.5;    // kN/m² — 적설하중
    private double tempMin      = -10.0;  // °C    — 최저 설계온도 (현재 DSM 미반영, 정보 목적)
    private double tempMax      =  35.0;  // °C    — 최고 설계온도

    // ── 하중 조건 ──────────────────────────────────────────────────────
    private double deadLoad     =  5.0;   // kN/m² — 슈퍼임포즈드 고정하중 (마감재 등)
    private double liveLoad     =  2.5;   // kN/m² — 활하중
    private double tributaryArea= 16.0;   // m²    — 지배 면적 (기둥 간격²)
    private int    numFloors    =  3;     // 층수
}
