CREATE TABLE IF NOT EXISTS SENSOR_DATA (
                             id IDENTITY PRIMARY KEY,
                             location VARCHAR(100) NOT NULL,
                             temperature INT NOT NULL,
                             timestamp VARCHAR(50) NOT NULL
);

-- ================================================================
-- EMS(에너지 관리 시스템) 관련 테이블
-- ================================================================

-- 에너지 계측 데이터 테이블
-- MQTT 또는 REST API로 수신된 실시간 전력/에너지 데이터 저장
-- 전압, 전류, 역률, 누적 전력량(kWh) 포함
CREATE TABLE IF NOT EXISTS ENERGY_DATA (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    location     VARCHAR(100)   NOT NULL,           -- 계측 위치 (예: "B동 3층")
    zone         VARCHAR(100),                       -- 세부 구역 (예: "HVAC", "조명", "콘센트")
    power_kw     DOUBLE         NOT NULL DEFAULT 0, -- 현재 소비 전력 (kW)
    voltage      DOUBLE                  DEFAULT 0, -- 전압 (V)
    current_a    DOUBLE                  DEFAULT 0, -- 전류 (A)
    power_factor DOUBLE                  DEFAULT 1, -- 역률 (0.0 ~ 1.0)
    energy_kwh   DOUBLE                  DEFAULT 0, -- 누적 전력량 (kWh)
    timestamp    VARCHAR(50)    NOT NULL             -- 계측 시각
);

-- EMS 알람 테이블
-- 임계값 초과, 전력 품질 이상 등 발생 시 알람 이력을 저장
-- 심각도(severity): INFO / WARNING / CRITICAL
CREATE TABLE IF NOT EXISTS EMS_ALERT (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_type      VARCHAR(50)    NOT NULL,         -- 알람 유형 (OVER_POWER, LOW_POWER_FACTOR 등)
    severity        VARCHAR(20)    NOT NULL,         -- 심각도
    message         VARCHAR(500)   NOT NULL,         -- 알람 메시지
    location        VARCHAR(100),                    -- 발생 위치
    threshold_value DOUBLE                  DEFAULT 0, -- 설정된 임계값
    current_value   DOUBLE                  DEFAULT 0, -- 실제 측정값
    is_resolved     BOOLEAN                 DEFAULT FALSE, -- 해결 여부
    timestamp       VARCHAR(50)    NOT NULL          -- 알람 발생 시각
);

-- EMS 임계값 설정 테이블
-- 위치별, 항목별 알람 기준값 저장
-- UNIQUE KEY로 동일 (type, location) 조합은 하나만 유지 (UPSERT 지원)
CREATE TABLE IF NOT EXISTS EMS_THRESHOLD (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    threshold_type  VARCHAR(50)    NOT NULL,         -- 임계값 유형 (MAX_POWER_KW, MIN_POWER_FACTOR 등)
    location        VARCHAR(100),                    -- 적용 위치 (NULL이면 전체 적용)
    threshold_value DOUBLE         NOT NULL,         -- 임계값
    updated_at      VARCHAR(50),                     -- 마지막 수정 시각
    UNIQUE KEY uq_threshold (threshold_type, location) -- 동일 유형+위치 중복 방지
);
