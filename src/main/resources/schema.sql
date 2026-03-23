-- ================================================================
-- 센서 데이터 테이블 (DHT11 등)
-- ================================================================
CREATE TABLE IF NOT EXISTS SENSOR_DATA (
                                           id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                                           location    VARCHAR(100) NOT NULL,
    temperature DOUBLE       NOT NULL, -- 온도는 소수점이 나올 수 있으므로 DOUBLE 권장
    humidity    DOUBLE,                -- 습도 추가 (필요시)
    timestamp   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP -- 문자열 대신 실제 시간 타입 사용
    );

-- ================================================================
-- EMS(에너지 관리 시스템) 관련 테이블
-- ================================================================

-- 에너지 계측 데이터 테이블
CREATE TABLE IF NOT EXISTS ENERGY_DATA (
                                           id           BIGINT AUTO_INCREMENT PRIMARY KEY,
                                           location     VARCHAR(100)   NOT NULL,
    zone         VARCHAR(100),
    power_kw     DOUBLE         NOT NULL DEFAULT 0,
    voltage      DOUBLE                  DEFAULT 0,
    current_a    DOUBLE                  DEFAULT 0,
    power_factor DOUBLE                  DEFAULT 1,
    energy_kwh   DOUBLE                  DEFAULT 0,
    timestamp    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- EMS 알람 테이블
CREATE TABLE IF NOT EXISTS EMS_ALERT (
                                         id              BIGINT AUTO_INCREMENT PRIMARY KEY,
                                         alert_type      VARCHAR(50)    NOT NULL,
    severity        VARCHAR(20)    NOT NULL,
    message         VARCHAR(500)   NOT NULL,
    location        VARCHAR(100),
    threshold_value DOUBLE                  DEFAULT 0,
    current_value   DOUBLE                  DEFAULT 0,
    is_resolved     BOOLEAN                 DEFAULT FALSE,
    timestamp       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

-- EMS 임계값 설정 테이블
CREATE TABLE IF NOT EXISTS EMS_THRESHOLD (
                                             id              BIGINT AUTO_INCREMENT PRIMARY KEY,
                                             threshold_type  VARCHAR(50)    NOT NULL,
    location        VARCHAR(100)   NOT NULL, -- UNIQUE KEY 구성을 위해 NOT NULL 권장
    threshold_value DOUBLE         NOT NULL,
    updated_at      DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_threshold UNIQUE (threshold_type, location) -- MariaDB 표준 제약 조건 명시
    );