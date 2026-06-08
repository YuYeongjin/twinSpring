-- ================================================================
-- TimescaleDB 확장 활성화 (시계열 데이터 최적화)
-- timescale/timescaledb-ha:pg16 이미지에서 자동 로드됨
-- ================================================================
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ================================================================
-- pgvector 확장 활성화 (RAG 벡터 검색용)
-- timescaledb-ha 이미지에 pgvector 내장
-- ================================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ================================================================
-- BIM 프로젝트 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_project
(
    project_id     TEXT NOT NULL PRIMARY KEY,
    project_name   TEXT NULL,
    structure_type TEXT NULL,
    span_count     TEXT NULL
);

-- ================================================================
-- BIM 요소 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element
(
    project_id   TEXT             NULL,
    element_id   TEXT             NOT NULL PRIMARY KEY,
    element_type TEXT             NULL,
    position_x   DOUBLE PRECISION NULL,
    position_y   DOUBLE PRECISION NULL,
    position_z   DOUBLE PRECISION NULL,
    size_x       DOUBLE PRECISION NULL,
    size_y       DOUBLE PRECISION NULL,
    size_z       DOUBLE PRECISION NULL,
    material     TEXT             NULL,
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
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    location    TEXT             NOT NULL,
    temperature DOUBLE PRECISION NOT NULL,
    humidity    DOUBLE PRECISION,
    timestamp   TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, timestamp)
);

-- ================================================================
-- sensor_data → TimescaleDB Hypertable 변환
--
-- create_hypertable: timestamp 컬럼 기준으로 7일 단위 청크 파티셔닝
--   if_not_exists   => TRUE : 이미 hypertable이면 건너뜀
--   migrate_data    => TRUE : 기존 데이터 그대로 마이그레이션
-- ================================================================
SELECT create_hypertable(
    'sensor_data',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists  => TRUE,
    migrate_data   => TRUE
);

-- ── 청크 압축 정책 (7일 이후 columnar 압축, ~93% 압축률) ──────────
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_orderby = 'timestamp DESC',
    timescaledb.compress_segmentby = 'location'
);
SELECT add_compression_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE);

-- ── 데이터 보존 정책 (90일 초과 자동 삭제) ─────────────────────────
-- 필요 시 주석 해제. 기본값은 무제한 보존.
-- SELECT add_retention_policy('sensor_data', INTERVAL '90 days', if_not_exists => TRUE);

-- ── Continuous Aggregate: 1시간 평균 (자동 갱신) ───────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_hourly_avg
    WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', timestamp)  AS bucket,
    location,
    AVG(temperature)                  AS avg_temp,
    MIN(temperature)                  AS min_temp,
    MAX(temperature)                  AS max_temp,
    AVG(humidity)                     AS avg_humidity,
    COUNT(*)                          AS sample_count
FROM sensor_data
GROUP BY bucket, location
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'sensor_hourly_avg',
    start_offset  => INTERVAL '3 days',
    end_offset    => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- ── Continuous Aggregate: 1일 평균 ────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_daily_avg
    WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', timestamp)   AS bucket,
    location,
    AVG(temperature)                  AS avg_temp,
    MIN(temperature)                  AS min_temp,
    MAX(temperature)                  AS max_temp,
    AVG(humidity)                     AS avg_humidity,
    COUNT(*)                          AS sample_count
FROM sensor_data
GROUP BY bucket, location
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'sensor_daily_avg',
    start_offset  => INTERVAL '30 days',
    end_offset    => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
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
    layer_id    TEXT        NOT NULL PRIMARY KEY,
    project_id  TEXT        NOT NULL,
    layer_name  TEXT        NOT NULL DEFAULT 'layer',
    color       TEXT        NOT NULL DEFAULT '#60a5fa',
    visible     BOOLEAN     NOT NULL DEFAULT TRUE,
    element_ids TEXT        NULL,
    sort_order  INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bim_layer_project ON bim_layer (project_id);

-- ================================================================
-- BIM 부재 커스텀 색상 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element_color
(
    element_id TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL,
    color      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bim_color_project ON bim_element_color (project_id);

-- ================================================================
-- BIM 선 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_line
(
    line_id      TEXT             NOT NULL PRIMARY KEY,
    project_id   TEXT             NOT NULL,
    start_x      DOUBLE PRECISION NOT NULL DEFAULT 0,
    start_y      DOUBLE PRECISION NOT NULL DEFAULT 0,
    start_z      DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_x        DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_y        DOUBLE PRECISION NOT NULL DEFAULT 0,
    end_z        DOUBLE PRECISION NOT NULL DEFAULT 0,
    color        TEXT             NOT NULL DEFAULT '#60a5fa',
    line_width   DOUBLE PRECISION NOT NULL DEFAULT 2,
    points_json  TEXT             NULL,
    closed       BOOLEAN          NOT NULL DEFAULT FALSE,
    shape_height DOUBLE PRECISION NOT NULL DEFAULT 0,
    line_type    TEXT             NOT NULL DEFAULT 'line',
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
ALTER TABLE bim_line ADD COLUMN IF NOT EXISTS line_type    TEXT             NOT NULL DEFAULT 'line';

-- ================================================================
-- 시뮬레이션 프로젝트 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS simulation_project
(
    project_id   TEXT        NOT NULL PRIMARY KEY,
    project_name TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- 시뮬레이션 상태 테이블 (지형 + 장비 선택 포함)
-- ================================================================
CREATE TABLE IF NOT EXISTS simulation_state
(
    excavator_id        TEXT             NOT NULL PRIMARY KEY,
    position_x          DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_y          DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_z          DOUBLE PRECISION NOT NULL DEFAULT 0,
    body_rotation       DOUBLE PRECISION NOT NULL DEFAULT 0,
    swing_angle         DOUBLE PRECISION NOT NULL DEFAULT 0,
    boom_angle          DOUBLE PRECISION NOT NULL DEFAULT 35,
    arm_angle           DOUBLE PRECISION NOT NULL DEFAULT 60,
    bucket_angle        DOUBLE PRECISION NOT NULL DEFAULT -25,
    operation_mode      TEXT             NOT NULL DEFAULT 'IDLE',
    soil_in_bucket      DOUBLE PRECISION NOT NULL DEFAULT 0,
    selected_machine_id TEXT             NOT NULL DEFAULT '0.6W',
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
    project_id   TEXT        NOT NULL PRIMARY KEY,
    project_name TEXT        NOT NULL,
    location     TEXT        NULL,
    description  TEXT        NULL,
    camera_url   TEXT        NULL,
    status       TEXT        NOT NULL DEFAULT 'ACTIVE',
    mode         TEXT        NOT NULL DEFAULT 'SAFETY',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기존 safe_project 테이블에 mode 컬럼 추가 (없는 경우)
ALTER TABLE safe_project ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'SAFETY';

-- ================================================================
-- WBS 프로젝트 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS wbs_project
(
    project_id      TEXT        NOT NULL PRIMARY KEY,
    project_name    TEXT        NOT NULL,
    location        TEXT        NULL,
    contract_amount BIGINT      NULL,
    status          TEXT        NOT NULL DEFAULT 'PLANNED',
    description     TEXT        NULL,
    start_date      DATE        NULL,
    end_date        DATE        NULL,
    client_name     TEXT        NULL,
    manager_name    TEXT        NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- WBS 태스크 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS wbs_task
(
    task_id        TEXT        NOT NULL PRIMARY KEY,
    wbs_project_id TEXT        NOT NULL REFERENCES wbs_project (project_id) ON DELETE CASCADE,
    wbs_code       TEXT        NULL,
    task_name      TEXT        NOT NULL,
    start_date     DATE        NULL,
    end_date       DATE        NULL,
    duration       INTEGER     NULL,
    progress       INTEGER     NOT NULL DEFAULT 0,
    predecessor_ids TEXT       NULL,
    status         TEXT        NOT NULL DEFAULT 'NOT_STARTED',
    responsible    TEXT        NULL,
    notes          TEXT        NULL,
    source         TEXT        NOT NULL DEFAULT 'MANUAL',
    sort_order     INTEGER     NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wbs_task_project ON wbs_task (wbs_project_id);

-- ================================================================
-- WBS ↔ 타 프로젝트 연결 테이블 (BIM / 안전 / 시뮬레이션)
-- ================================================================
CREATE TABLE IF NOT EXISTS project_link
(
    link_id           TEXT        NOT NULL PRIMARY KEY,
    wbs_project_id    TEXT        NOT NULL REFERENCES wbs_project (project_id) ON DELETE CASCADE,
    linked_type       TEXT        NOT NULL,
    linked_project_id TEXT        NOT NULL,
    note              TEXT        NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_link_wbs    ON project_link (wbs_project_id);
CREATE INDEX IF NOT EXISTS idx_project_link_linked ON project_link (linked_type, linked_project_id);

-- ================================================================
-- 모니터링 카메라 테이블 (프로젝트당 다중 카메라)
-- RTSP(rtsp://), HTTP 스냅샷(http://), MJPEG 스트림 URL 모두 지원
-- ================================================================
CREATE TABLE IF NOT EXISTS monitoring_camera
(
    camera_id   TEXT        NOT NULL PRIMARY KEY,
    project_id  TEXT        NOT NULL,
    camera_name TEXT        NOT NULL DEFAULT '카메라',
    camera_url  TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order  INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monitoring_camera_project ON monitoring_camera (project_id);

-- ================================================================
-- 모니터링 스케줄 설정 테이블 (프로젝트별 상시 촬영 설정)
-- ================================================================
CREATE TABLE IF NOT EXISTS monitoring_schedule
(
    schedule_id          TEXT        NOT NULL PRIMARY KEY,
    project_id           TEXT        NOT NULL,
    enabled              BOOLEAN     NOT NULL DEFAULT FALSE,
    capture_interval_sec INT         NOT NULL DEFAULT 1800,
    retention_sec        INT         NOT NULL DEFAULT 3600,
    last_captured_at     TIMESTAMPTZ NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_monitoring_schedule_project ON monitoring_schedule (project_id);

-- ================================================================
-- 모니터링 스냅샷 테이블 (캡처된 이미지)
-- SAFETY 모드: is_problem=true 인 것만 저장, 프로젝트당 최대 10개 (순환)
-- CRACK  모드: 모든 캡처 저장, expires_at 이후 스케줄러가 자동 삭제
-- ================================================================
CREATE TABLE IF NOT EXISTS monitoring_snapshot
(
    snapshot_id    TEXT        NOT NULL PRIMARY KEY,
    project_id     TEXT        NOT NULL,
    schedule_id    TEXT        NOT NULL,
    mode           TEXT        NOT NULL,
    image_data     BYTEA       NULL,
    is_problem     BOOLEAN     NOT NULL DEFAULT FALSE,
    detection_json TEXT        NULL,
    captured_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at     TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_monitoring_snapshot_project ON monitoring_snapshot (project_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_snapshot_expires ON monitoring_snapshot (expires_at);

-- monitoring_snapshot 에 카메라 참조 컬럼 추가 (기존 행은 NULL 허용)
ALTER TABLE monitoring_snapshot ADD COLUMN IF NOT EXISTS camera_id   TEXT NULL;
ALTER TABLE monitoring_snapshot ADD COLUMN IF NOT EXISTS camera_name TEXT NULL;

-- ================================================================
-- 대화 히스토리 테이블 (채팅 세션 대화 내역 영구 보존)
-- ================================================================
CREATE TABLE IF NOT EXISTS chat_history
(
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id TEXT        NOT NULL,
    role       TEXT        NOT NULL,
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_history_time    ON chat_history (created_at DESC);

-- ================================================================
-- 사용자 설정 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS user_settings
(
    setting_key   TEXT        NOT NULL PRIMARY KEY,
    setting_value TEXT        NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 기본 설정값 삽입 (없으면)
INSERT INTO user_settings (setting_key, setting_value)
  VALUES ('chat_history_retention_days', '30')
  ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO user_settings (setting_key, setting_value)
  VALUES ('weather_lat', '37.5665')
  ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO user_settings (setting_key, setting_value)
  VALUES ('weather_lon', '126.9780')
  ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO user_settings (setting_key, setting_value)
  VALUES ('weather_city', '')
  ON CONFLICT (setting_key) DO NOTHING;

-- ================================================================
-- 진도 분석 로그 테이블 (PROGRESS 모드 양방향 동기화)
-- ================================================================
CREATE TABLE IF NOT EXISTS progress_analysis_log
(
    analysis_id    TEXT             NOT NULL PRIMARY KEY,
    snapshot_id    TEXT             NOT NULL,
    wbs_task_id    TEXT             NOT NULL,
    wbs_project_id TEXT             NOT NULL,
    before_progress INTEGER         NOT NULL DEFAULT 0,
    after_progress  INTEGER         NOT NULL DEFAULT 0,
    confidence      DOUBLE PRECISION NOT NULL DEFAULT 0,
    analysis_notes  TEXT,
    rag_evidence    TEXT,
    analyzed_at     TIMESTAMPTZ      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_progress_analysis_task    ON progress_analysis_log (wbs_task_id);
CREATE INDEX IF NOT EXISTS idx_progress_analysis_project ON progress_analysis_log (wbs_project_id);
CREATE INDEX IF NOT EXISTS idx_progress_analysis_time    ON progress_analysis_log (analyzed_at DESC);

-- safe_project 에 PROGRESS 모드 지원 (기존 CHECK 없으면 그냥 사용)
ALTER TABLE monitoring_snapshot ADD COLUMN IF NOT EXISTS analysis_id TEXT NULL;

-- ================================================================
-- Safe 프로젝트 ↔ IoT 센서 매핑 테이블
-- sensor_location: sensor_data.location 값 (예: "bridgeA")
-- ================================================================
CREATE TABLE IF NOT EXISTS safe_iot_mapping
(
    mapping_id      TEXT        NOT NULL PRIMARY KEY,
    project_id      TEXT        NOT NULL REFERENCES safe_project (project_id) ON DELETE CASCADE,
    sensor_location TEXT        NOT NULL,
    sensor_alias    TEXT        NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, sensor_location)
);
CREATE INDEX IF NOT EXISTS idx_safe_iot_mapping_project ON safe_iot_mapping (project_id);

-- ================================================================
-- 에이전트 질문 이력 테이블 (절대 삭제 불가 — immutable audit log)
-- ================================================================
CREATE TABLE IF NOT EXISTS agent_query_log
(
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id TEXT        NOT NULL,
    message    TEXT        NOT NULL,
    domain     TEXT        NULL,
    project_id TEXT        NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_query_log_session ON agent_query_log (session_id);
CREATE INDEX IF NOT EXISTS idx_agent_query_log_time    ON agent_query_log (created_at DESC);

-- ================================================================
-- 통합관제 프로젝트 테이블
-- WBS 하나에 여러 Integration 프로젝트가 연결될 수 있음
-- sim_config : JSON (작업자/장비/위험구역 설정)
-- ================================================================
CREATE TABLE IF NOT EXISTS integration_project
(
    project_id     TEXT        NOT NULL PRIMARY KEY,
    project_name   TEXT        NOT NULL,
    wbs_project_id TEXT        NULL,    -- WBS 연결 (nullable)
    bim_project_id TEXT        NULL,    -- BIM 연결 (nullable)
    description    TEXT        NULL,
    sim_config     TEXT        NULL,    -- JSON 시뮬레이션 설정
    status         TEXT        NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- DELETE를 시도하면 예외 발생 (행 단위)
-- ※ Spring Boot ScriptUtils는 $$ dollar-quote를 파싱하지 못하므로 단일 따옴표 + '' 이스케이프 사용
CREATE OR REPLACE FUNCTION _prevent_agent_query_log_delete()
    RETURNS TRIGGER LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''에이전트 질문 이력(agent_query_log)은 삭제할 수 없습니다.''; END;';

DROP TRIGGER IF EXISTS trg_no_delete_agent_query_log ON agent_query_log;
CREATE TRIGGER trg_no_delete_agent_query_log
    BEFORE DELETE ON agent_query_log
    FOR EACH ROW EXECUTE FUNCTION _prevent_agent_query_log_delete();

-- TRUNCATE도 차단
CREATE OR REPLACE FUNCTION _prevent_agent_query_log_truncate()
    RETURNS TRIGGER LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''에이전트 질문 이력(agent_query_log)은 TRUNCATE할 수 없습니다.''; END;';

DROP TRIGGER IF EXISTS trg_no_truncate_agent_query_log ON agent_query_log;
CREATE TRIGGER trg_no_truncate_agent_query_log
    BEFORE TRUNCATE ON agent_query_log
    FOR EACH STATEMENT EXECUTE FUNCTION _prevent_agent_query_log_truncate();
