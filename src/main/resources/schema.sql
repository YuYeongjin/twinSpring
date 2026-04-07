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
-- bim_element 회전 컬럼 마이그레이션 (기존 테이블에 컬럼 추가)
-- ================================================================
SET @col_rx = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bim_element' AND COLUMN_NAME = 'rotation_x');
SET @sql_rx = IF(@col_rx = 0,
    'ALTER TABLE bim_element ADD COLUMN rotation_x DOUBLE NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @sql_rx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_ry = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bim_element' AND COLUMN_NAME = 'rotation_y');
SET @sql_ry = IF(@col_ry = 0,
    'ALTER TABLE bim_element ADD COLUMN rotation_y DOUBLE NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @sql_ry; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_rz = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bim_element' AND COLUMN_NAME = 'rotation_z');
SET @sql_rz = IF(@col_rz = 0,
    'ALTER TABLE bim_element ADD COLUMN rotation_z DOUBLE NULL DEFAULT 0',
    'SELECT 1');
PREPARE stmt FROM @sql_rz; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ================================================================
-- BIM 레이어 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_layer
(
    layer_id    VARCHAR(200) NOT NULL PRIMARY KEY,
    project_id  VARCHAR(200) NOT NULL,
    layer_name  VARCHAR(200) NOT NULL DEFAULT 'layer',
    color       VARCHAR(20)  NOT NULL DEFAULT '#60a5fa',
    visible     TINYINT(1)   NOT NULL DEFAULT 1,
    element_ids TEXT         NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bim_layer_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================================
-- BIM 부재 커스텀 색상 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element_color
(
    element_id VARCHAR(200) NOT NULL PRIMARY KEY,
    project_id VARCHAR(200) NOT NULL,
    color      VARCHAR(20)  NOT NULL,
    INDEX idx_bim_color_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;