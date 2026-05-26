package yyj.project.twinspring.service;

import java.util.Map;

/**
 * 이미지에서 균열(crack)을 감지하는 서비스.
 * Python 서버 연결 → 실패 시 Spring 내장 알고리즘(폴백) 동작.
 *
 * 반환 Map 키:
 *   hasCrack   : boolean
 *   confidence : double (0.0 ~ 1.0)
 *   method     : "python" | "spring_fallback"
 *   detail     : String  — 분석 요약 (예: "dark linear regions: 3, edge density: 0.12")
 */
public interface CrackDetectionService {
    Map<String, Object> analyze(byte[] imageBytes);
}
