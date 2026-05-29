-- ================================================================
-- pgvector 확장 활성화 (RAG 벡터 검색용)
-- ================================================================
CREATE EXTENSION IF NOT EXISTS vector;

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
    zone_map_data       TEXT             NULL,
    has_random_terrain  BOOLEAN          NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기존 DB에 컬럼 누락 시 마이그레이션 (IF NOT EXISTS는 PostgreSQL 9.6+)
ALTER TABLE simulation_state ADD COLUMN IF NOT EXISTS zone_map_data      TEXT    NULL;
ALTER TABLE simulation_state ADD COLUMN IF NOT EXISTS has_random_terrain BOOLEAN NOT NULL DEFAULT FALSE;

-- ================================================================
-- 안전 현장 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS safe_project
(
    project_id   VARCHAR(64)   NOT NULL PRIMARY KEY,
    project_name VARCHAR(255)  NOT NULL,
    location     VARCHAR(512)  NULL,
    description  TEXT          NULL,
    camera_url   VARCHAR(1024) NULL,
    status       VARCHAR(32)   NOT NULL DEFAULT 'ACTIVE',
    mode         VARCHAR(16)   NOT NULL DEFAULT 'SAFETY',
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기존 safe_project 테이블에 mode 컬럼 추가 (없는 경우)
ALTER TABLE safe_project ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'SAFETY';

-- ================================================================
-- WBS 프로젝트 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS wbs_project
(
    project_id      VARCHAR(64)  NOT NULL PRIMARY KEY,
    project_name    VARCHAR(255) NOT NULL,
    location        VARCHAR(512) NULL,
    contract_amount BIGINT       NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'PLANNED',
    description     TEXT         NULL,
    start_date      DATE         NULL,
    end_date        DATE         NULL,
    client_name     VARCHAR(255) NULL,
    manager_name    VARCHAR(255) NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- WBS 태스크 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS wbs_task
(
    task_id         VARCHAR(64)  NOT NULL PRIMARY KEY,
    wbs_project_id  VARCHAR(64)  NOT NULL REFERENCES wbs_project (project_id) ON DELETE CASCADE,
    wbs_code        VARCHAR(64)  NULL,
    task_name       VARCHAR(512) NOT NULL,
    start_date      DATE         NULL,
    end_date        DATE         NULL,
    duration        INTEGER      NULL,
    progress        INTEGER      NOT NULL DEFAULT 0,
    predecessor_ids TEXT         NULL,
    status          VARCHAR(32)  NOT NULL DEFAULT 'NOT_STARTED',
    responsible     VARCHAR(255) NULL,
    notes           TEXT         NULL,
    source          VARCHAR(32)  NOT NULL DEFAULT 'MANUAL',
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wbs_task_project ON wbs_task (wbs_project_id);

-- ================================================================
-- WBS ↔ 타 프로젝트 연결 테이블 (BIM / 안전 / 시뮬레이션)
-- ================================================================
CREATE TABLE IF NOT EXISTS project_link
(
    link_id          VARCHAR(64)  NOT NULL PRIMARY KEY,
    wbs_project_id   VARCHAR(64)  NOT NULL REFERENCES wbs_project (project_id) ON DELETE CASCADE,
    linked_type      VARCHAR(32)  NOT NULL,
    linked_project_id VARCHAR(64) NOT NULL,
    note             TEXT         NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_link_wbs    ON project_link (wbs_project_id);
CREATE INDEX IF NOT EXISTS idx_project_link_linked ON project_link (linked_type, linked_project_id);
