-- ================================================================
-- BIM 프로젝트 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_project
(
    project_id     VARCHAR(200) NOT NULL PRIMARY KEY,
    project_name   VARCHAR(200) NULL,
    structure_type VARCHAR(500) NULL,
    span_count     VARCHAR(200) NULL
);

-- ================================================================
-- BIM 요소 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element
(
    project_id   VARCHAR(200) NULL,
    element_id   VARCHAR(200) NOT NULL PRIMARY KEY,
    element_type VARCHAR(500) NULL,
    position_x   DOUBLE       NULL,
    position_y   DOUBLE       NULL,
    position_z   DOUBLE       NULL,
    size_x       DOUBLE       NULL,
    size_y       DOUBLE       NULL,
    size_z       DOUBLE       NULL,
    material     VARCHAR(255) NULL,
    CONSTRAINT bim_element_ibfk_1
        FOREIGN KEY (project_id) REFERENCES bim_project (project_id)
);

CREATE INDEX IF NOT EXISTS project_id ON bim_element (project_id);

-- ================================================================
-- 센서 데이터 테이블 (DHT11 등)
-- ================================================================
CREATE TABLE IF NOT EXISTS SENSOR_DATA
(
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    location    VARCHAR(100) NOT NULL,
    temperature DOUBLE       NOT NULL,
    humidity    DOUBLE,
    timestamp   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

-- ================================================================
-- EMS(에너지 관리 시스템) 관련 테이블
-- ================================================================

-- 에너지 계측 데이터 테이블
CREATE TABLE IF NOT EXISTS ENERGY_DATA
(
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    location     VARCHAR(100) NOT NULL,
    zone         VARCHAR(100),
    power_kw     DOUBLE       NOT NULL DEFAULT 0,
    voltage      DOUBLE                DEFAULT 0,
    current_a    DOUBLE                DEFAULT 0,
    power_factor DOUBLE                DEFAULT 1,
    energy_kwh   DOUBLE                DEFAULT 0,
    timestamp    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

-- EMS 알람 테이블
CREATE TABLE IF NOT EXISTS EMS_ALERT
(
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_type      VARCHAR(50)  NOT NULL,
    severity        VARCHAR(20)  NOT NULL,
    message         VARCHAR(500) NOT NULL,
    location        VARCHAR(100),
    threshold_value DOUBLE                DEFAULT 0,
    current_value   DOUBLE                DEFAULT 0,
    is_resolved     BOOLEAN               DEFAULT FALSE,
    timestamp       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

-- EMS 임계값 설정 테이블
CREATE TABLE IF NOT EXISTS EMS_THRESHOLD
(
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    threshold_type  VARCHAR(50)  NOT NULL,
    location        VARCHAR(100) NOT NULL,
    threshold_value DOUBLE       NOT NULL,
    updated_at      DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_threshold UNIQUE (threshold_type, location)
);
