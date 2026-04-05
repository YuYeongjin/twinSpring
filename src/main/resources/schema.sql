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
    FOREIGN KEY (project_id) REFERENCES bim_project (project_id),
    -- [수정] MySQL 5.7 호환을 위해 테이블 생성 시점에 인덱스 추가
    INDEX idx_project_id (project_id)
    );

-- [삭제] 아래 줄은 MySQL 5.7에서 문법 오류를 발생시키므로 삭제합니다.
-- CREATE INDEX IF NOT EXISTS project_id ON bim_element (project_id);

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
    timestamp       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    );

-- 기존 EMS_ALERT 테이블에 created_at 컬럼이 없는 경우 추가 (마이그레이션)
SET @exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'EMS_ALERT'
      AND COLUMN_NAME  = 'created_at'
);
SET @sql = IF(@exists = 0,
    'ALTER TABLE EMS_ALERT ADD COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================================
-- BIM 레이어 테이블 (Spring 로컬 저장 — C# 서버와 무관)
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_layer
(
    layer_id    VARCHAR(200) NOT NULL PRIMARY KEY,
    project_id  VARCHAR(200) NOT NULL,
    layer_name  VARCHAR(200) NOT NULL DEFAULT '레이어',
    color       VARCHAR(20)  NOT NULL DEFAULT '#60a5fa',
    visible     TINYINT(1)   NOT NULL DEFAULT 1,
    element_ids TEXT         NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bim_layer_project (project_id)
);

-- ================================================================
-- BIM 부재 커스텀 색상 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element_color
(
    element_id VARCHAR(200) NOT NULL PRIMARY KEY,
    project_id VARCHAR(200) NOT NULL,
    color      VARCHAR(20)  NOT NULL,
    INDEX idx_bim_color_project (project_id)
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