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
    project_id   VARCHAR(200)     NULL,
    element_id   VARCHAR(200)     NOT NULL PRIMARY KEY,
    element_type VARCHAR(500)     NULL,
    position_x   DOUBLE PRECISION NULL,
    position_y   DOUBLE PRECISION NULL,
    position_z   DOUBLE PRECISION NULL,
    size_x       DOUBLE PRECISION NULL,
    size_y       DOUBLE PRECISION NULL,
    size_z       DOUBLE PRECISION NULL,
    material     VARCHAR(255)     NULL,
    CONSTRAINT bim_element_ibfk_1
        FOREIGN KEY (project_id) REFERENCES bim_project (project_id)
);
CREATE INDEX IF NOT EXISTS idx_project_id ON bim_element (project_id);

-- ================================================================
-- 센서 데이터 테이블 (DHT11 등)
-- ※ PostgreSQL은 따옴표 없는 식별자를 소문자로 저장 → 실제 테이블명: sensor_data
-- ================================================================
CREATE TABLE IF NOT EXISTS sensor_data
(
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    location    VARCHAR(100) NOT NULL,
    temperature DOUBLE PRECISION NOT NULL,
    humidity    DOUBLE PRECISION,
    timestamp   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- bim_element 회전 컬럼 마이그레이션 (기존 테이블에 컬럼 추가)
-- ================================================================
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS rotation_x DOUBLE PRECISION DEFAULT 0;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS rotation_y DOUBLE PRECISION DEFAULT 0;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS rotation_z DOUBLE PRECISION DEFAULT 0;

-- ================================================================
-- BIM 레이어 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_layer
(
    layer_id    VARCHAR(200) NOT NULL PRIMARY KEY,
    project_id  VARCHAR(200) NOT NULL,
    layer_name  VARCHAR(200) NOT NULL DEFAULT 'layer',
    color       VARCHAR(20)  NOT NULL DEFAULT '#60a5fa',
    visible     BOOLEAN      NOT NULL DEFAULT TRUE,
    element_ids TEXT         NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bim_layer_project ON bim_layer (project_id);

-- ================================================================
-- BIM 부재 커스텀 색상 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element_color
(
    element_id VARCHAR(200) NOT NULL PRIMARY KEY,
    project_id VARCHAR(200) NOT NULL,
    color      VARCHAR(20)  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bim_color_project ON bim_element_color (project_id);

-- ================================================================
-- BIM 선 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_line
(
    line_id      VARCHAR(64)      NOT NULL PRIMARY KEY,
    project_id   VARCHAR(64)      NOT NULL,
    start_x      DOUBLE PRECISION NOT NULL DEFAULT 0,
    start_y      DOUBLE PRECISION NOT NULL DEFAULT 0,
    start_z      DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_x        DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_y        DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_z        DOUBLE PRECISION NOT NULL DEFAULT 0,
    color        VARCHAR(20)      NOT NULL DEFAULT '#60a5fa',
    line_width   DOUBLE PRECISION NOT NULL DEFAULT 2,
    points_json  TEXT             NULL,
    closed       BOOLEAN          NOT NULL DEFAULT FALSE,
    shape_height DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bim_line_project ON bim_line (project_id);

-- ================================================================
-- bim_line 컬럼 마이그레이션 (기존 테이블에 컬럼 추가)
-- points_json / closed / shape_height 가 없는 기존 DB 대응
-- ================================================================
ALTER TABLE bim_line ADD COLUMN IF NOT EXISTS points_json  TEXT;
ALTER TABLE bim_line ADD COLUMN IF NOT EXISTS closed       BOOLEAN          NOT NULL DEFAULT FALSE;
ALTER TABLE bim_line ADD COLUMN IF NOT EXISTS shape_height DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ================================================================
-- 시뮬레이션 프로젝트 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS simulation_project
(
    project_id   VARCHAR(64)  NOT NULL PRIMARY KEY,
    project_name VARCHAR(200) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- 시뮬레이션 상태 테이블 (지형 + 장비 선택 포함)
-- ================================================================
CREATE TABLE IF NOT EXISTS simulation_state
(
    excavator_id        VARCHAR(64)      NOT NULL PRIMARY KEY,
    position_x          DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_y          DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_z          DOUBLE PRECISION NOT NULL DEFAULT 0,
    body_rotation       DOUBLE PRECISION NOT NULL DEFAULT 0,
    swing_angle         DOUBLE PRECISION NOT NULL DEFAULT 0,
    boom_angle          DOUBLE PRECISION NOT NULL DEFAULT 35,
    arm_angle           DOUBLE PRECISION NOT NULL DEFAULT 60,
    bucket_angle        DOUBLE PRECISION NOT NULL DEFAULT -25,
    operation_mode      VARCHAR(20)      NOT NULL DEFAULT 'IDLE',
    soil_in_bucket      DOUBLE PRECISION NOT NULL DEFAULT 0,
    selected_machine_id VARCHAR(20)      NOT NULL DEFAULT '0.6W',
    height_map_data     TEXT             NULL,
    updated_at          TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
