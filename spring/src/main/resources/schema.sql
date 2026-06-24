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
ALTER TABLE bim_layer ADD COLUMN IF NOT EXISTS parent_layer_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_bim_layer_parent ON bim_layer (parent_layer_id);

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

-- WBS 태스크 계층 구조 (세부 공정 지원)
ALTER TABLE wbs_task ADD COLUMN IF NOT EXISTS parent_task_id TEXT NULL;

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

-- ================================================================
-- 통합관제 일일 작업 일보 (daily report snapshot)
-- ================================================================
CREATE TABLE IF NOT EXISTS integration_daily_report
(
    id               BIGSERIAL    PRIMARY KEY,
    project_id       VARCHAR(100) NOT NULL,
    report_date      DATE         NOT NULL,
    site_name        VARCHAR(255),
    location_str     VARCHAR(500),
    worker_count     INTEGER      DEFAULT 0,
    equip_count      INTEGER      DEFAULT 0,
    overall_progress NUMERIC(5,2) DEFAULT 0,
    task_snapshot    TEXT,   -- WBS 태스크 JSON 배열
    equip_snapshot   TEXT,   -- 장비 JSON 배열
    worker_snapshot  TEXT,   -- 작업자 JSON 배열
    danger_snapshot  TEXT,   -- 위험구역 JSON 배열
    created_at       TIMESTAMP    DEFAULT NOW(),
    updated_at       TIMESTAMP    DEFAULT NOW(),
    CONSTRAINT uq_daily_report UNIQUE (project_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_report_project_date
    ON integration_daily_report (project_id, report_date DESC);

-- ================================================================
-- 현장 카메라 테이블
-- 물리 좌표(현장 원점 기준 미터)로 카메라 위치를 등록
-- CV 서버가 이 파라미터를 사용해 픽셀 → 물리 좌표 변환
-- ================================================================
CREATE TABLE IF NOT EXISTS site_camera
(
    camera_id    TEXT        NOT NULL PRIMARY KEY,
    project_id   TEXT        NOT NULL,   -- integration_project 참조
    name         TEXT        NOT NULL,
    url          TEXT        NOT NULL,   -- RTSP/HTTP 스트림 URL
    world_x      DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 현장 원점 기준 X (m)
    world_y      DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 설치 높이 (m)
    world_z      DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 현장 원점 기준 Z (m)
    yaw          DOUBLE PRECISION NOT NULL DEFAULT 0,  -- 수평 회전각 (도, 0=+Z방향)
    fov_h        DOUBLE PRECISION NOT NULL DEFAULT 90, -- 수평 FOV (도)
    active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_camera_project ON site_camera (project_id);

-- ================================================================
-- 현장 원점 설정 (integration_project 확장)
-- ref_lat / ref_lng: GPS ↔ 물리 좌표 변환 기준점
-- ================================================================
ALTER TABLE integration_project ADD COLUMN IF NOT EXISTS ref_lat DOUBLE PRECISION NULL;
ALTER TABLE integration_project ADD COLUMN IF NOT EXISTS ref_lng DOUBLE PRECISION NULL;

-- ================================================================
-- bim_project Object Storage 연동 컬럼 (IFC 원본 파일 영구 보관)
-- storage_key      : MinIO/S3 오브젝트 키 (예: projects/{id}/original.ifc)
-- original_filename: 사용자가 업로드한 원본 파일명
-- uploaded_at      : 업로드 완료 시각
-- ================================================================
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS storage_key       TEXT        NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS original_filename TEXT        NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS uploaded_at       TIMESTAMPTZ NULL;

-- ================================================================
-- bim_project geoOrigin 마이그레이션 (IFC → GIS 연동용)
-- geo_latitude / geo_longitude / geo_elevation : IfcSite 위경도 (없으면 NULL)
-- ifc_offset_x/y/z : Three.js 원점 정규화 오프셋 (역산용)
-- ifc_scale        : IFC 단위 스케일 (mm→m 등)
-- ================================================================
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS geo_latitude  DOUBLE PRECISION NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS geo_elevation DOUBLE PRECISION NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS ifc_offset_x  DOUBLE PRECISION NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS ifc_offset_y  DOUBLE PRECISION NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS ifc_offset_z  DOUBLE PRECISION NULL;
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS ifc_scale     DOUBLE PRECISION NOT NULL DEFAULT 1;

-- ================================================================
-- bim_element IFC 원본 좌표 마이그레이션 (GIS 역산 / AI Agent 위치 추적용)
-- ifc_world_x/y/z : IFC Z-up 좌표계 기준 부재 중심 (정규화 전 원본)
-- ================================================================
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS ifc_world_x   DOUBLE PRECISION NULL;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS ifc_world_y   DOUBLE PRECISION NULL;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS ifc_world_z   DOUBLE PRECISION NULL;

-- ================================================================
-- bim_element IFC 구조 분석 컬럼 (GlobalId, Name, 층, 동)
-- ================================================================
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS global_id  TEXT NULL;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS ifc_name   TEXT NULL;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS storey     TEXT NULL;
ALTER TABLE bim_element ADD COLUMN IF NOT EXISTS building   TEXT NULL;

-- ================================================================
-- BIM 층(BuildingStorey) 테이블
-- IFC IfcBuildingStorey 계층 구조를 프로젝트별로 저장
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_storey
(
    storey_id    TEXT        NOT NULL PRIMARY KEY,
    project_id   TEXT        NOT NULL REFERENCES bim_project (project_id) ON DELETE CASCADE,
    storey_name  TEXT        NOT NULL,
    elevation    DOUBLE PRECISION NULL,
    building     TEXT        NULL,
    sort_order   INT         NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bim_storey_project ON bim_storey (project_id);

-- ================================================================
-- BIM WBS 노드 테이블 (IFC 구조 기반 자동 생성)
-- 계층: 프로젝트 → 동 → 층 → 공종
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_wbs_node
(
    wbs_id        TEXT        NOT NULL PRIMARY KEY,
    project_id    TEXT        NOT NULL REFERENCES bim_project (project_id) ON DELETE CASCADE,
    parent_wbs_id TEXT        NULL,
    wbs_code      TEXT        NULL,
    wbs_name      TEXT        NOT NULL,
    node_type     TEXT        NOT NULL DEFAULT 'TASK',  -- PROJECT|BUILDING|STOREY|TASK
    building      TEXT        NULL,
    storey        TEXT        NULL,
    element_type  TEXT        NULL,  -- IfcWall / IfcColumn / ...
    element_count INT         NOT NULL DEFAULT 0,
    progress      INT         NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    sort_order    INT         NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bim_wbs_project    ON bim_wbs_node (project_id);
CREATE INDEX IF NOT EXISTS idx_bim_wbs_parent     ON bim_wbs_node (parent_wbs_id);

-- ================================================================
-- bim_wbs_node 수량 산출 컬럼 (공사 단계 기반 WBS 확장)
-- quantity : 산출 수량 (철근 kg, 거푸집 m², 콘크리트 m³, 양생 일)
-- unit     : 단위 문자열
-- formula  : 계산식 설명 (UI hover 표시)
-- reason   : 시방서 근거 (KDS/AIJ/ACI 조항)
-- standard : 적용 기준 (KDS | AIJ | ACI)
-- ================================================================
ALTER TABLE bim_wbs_node ADD COLUMN IF NOT EXISTS quantity  DOUBLE PRECISION NULL;
ALTER TABLE bim_wbs_node ADD COLUMN IF NOT EXISTS unit      TEXT             NULL;
ALTER TABLE bim_wbs_node ADD COLUMN IF NOT EXISTS formula   TEXT             NULL;
ALTER TABLE bim_wbs_node ADD COLUMN IF NOT EXISTS reason    TEXT             NULL;
ALTER TABLE bim_wbs_node ADD COLUMN IF NOT EXISTS standard  TEXT             NOT NULL DEFAULT 'KDS';

-- ================================================================
-- BIM 부재 ↔ WBS 양방향 매핑 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS bim_element_wbs
(
    element_id TEXT NOT NULL,
    wbs_id     TEXT NOT NULL REFERENCES bim_wbs_node (wbs_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    PRIMARY KEY (element_id, wbs_id)
);
CREATE INDEX IF NOT EXISTS idx_bim_element_wbs_element ON bim_element_wbs (element_id);
CREATE INDEX IF NOT EXISTS idx_bim_element_wbs_wbs     ON bim_element_wbs (wbs_id);
CREATE INDEX IF NOT EXISTS idx_bim_element_wbs_project ON bim_element_wbs (project_id);

-- ================================================================
-- bim_project GLB 파일 저장 컬럼 (서버 사이드 IFC → GLB 변환 결과)
-- glb_storage_key : MinIO/S3 오브젝트 키 (예: projects/{id}/model.glb)
-- ================================================================
ALTER TABLE bim_project ADD COLUMN IF NOT EXISTS glb_storage_key TEXT NULL;

-- ================================================================
-- 구조해석 공식 마스터 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS structural_formula (
    formula_id     TEXT        NOT NULL PRIMARY KEY,
    code_standard  TEXT        NOT NULL, -- 'KDS' | 'EUROCODE2'
    structure_type TEXT        NOT NULL, -- 'BUILDING' | 'BRIDGE' | 'ALL'
    category       TEXT        NOT NULL, -- 'WIND'|'SEISMIC'|'DEAD'|'LIVE'|'SNOW'|'TRAFFIC'|'COMBO'|'BUCKLING'|'SAFETY'
    name           TEXT        NOT NULL,
    expression     TEXT        NOT NULL, -- 수식 문자열 (표시용)
    description    TEXT        NULL,
    sort_order     INT         NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- 공식 변수 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS structural_formula_variable (
    var_id        BIGSERIAL   PRIMARY KEY,
    formula_id    TEXT        NOT NULL REFERENCES structural_formula(formula_id) ON DELETE CASCADE,
    var_name      TEXT        NOT NULL,
    var_label     TEXT        NULL,
    default_value DOUBLE PRECISION NOT NULL,
    min_value     DOUBLE PRECISION NULL,
    max_value     DOUBLE PRECISION NULL,
    unit          TEXT        NULL,
    description   TEXT        NULL,
    is_editable   BOOLEAN     NOT NULL DEFAULT TRUE,
    UNIQUE (formula_id, var_name)
);
CREATE INDEX IF NOT EXISTS idx_sfv_formula ON structural_formula_variable(formula_id);

-- ================================================================
-- 프로젝트별 변수 오버라이드 테이블
-- ================================================================
CREATE TABLE IF NOT EXISTS structural_formula_override (
    override_id  BIGSERIAL   PRIMARY KEY,
    project_id   TEXT        NOT NULL,
    formula_id   TEXT        NOT NULL REFERENCES structural_formula(formula_id) ON DELETE CASCADE,
    var_name     TEXT        NOT NULL,
    custom_value DOUBLE PRECISION NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, formula_id, var_name)
);
CREATE INDEX IF NOT EXISTS idx_sfo_project ON structural_formula_override(project_id);

-- ================================================================
-- 기본 공식 데이터 삽입 (KDS / Eurocode2 × Building / Bridge)
-- ================================================================
INSERT INTO structural_formula (formula_id, code_standard, structure_type, category, name, expression, description, sort_order) VALUES

-- ── KDS · BUILDING ────────────────────────────────────────────────
('KDS_BLDG_WIND',    'KDS','BUILDING','WIND',    '풍하중 (KDS 41 10 15)',
 'q_w = 0.6125 × V₀² / 1000 × K_d × K_zt × C_f × G',
 '기본풍속도 V₀에서 설계풍압 산출. 높이 보정: h_f = ((z+H)/10+1)^0.25', 10),

('KDS_BLDG_SEISMIC', 'KDS','BUILDING','SEISMIC', '등가정적 지진력 (KDS 41 17 00)',
 'V = C_s × W,  C_s = S_DS / (R / I_e)',
 '밑면전단력을 층 높이 비례 역삼각형 분포로 배분', 20),

('KDS_BLDG_DEAD',    'KDS','BUILDING','DEAD',    '고정하중',
 'W_self = γ_c × sX × sY × sZ',
 '부재 자중 산출. 콘크리트 단위중량 γ_c = 24 kN/m³', 30),

('KDS_BLDG_LIVE',    'KDS','BUILDING','LIVE',    '활하중 (KDS 41 10 05)',
 'q_L  [kN/m²]',
 '사무실 2.5, 주거 2.0, 주차 5.0 kN/m²', 40),

('KDS_BLDG_SNOW',    'KDS','BUILDING','SNOW',    '적설하중 (KDS 41 12 00)',
 'S = C_b × C_e × C_t × I_s × S_g',
 '지붕 형상계수 C_b=0.8 기준', 50),

('KDS_BLDG_COMBO',   'KDS','BUILDING','COMBO',   '하중조합 (KDS 41 10 15 LRFD)',
 '①1.4D  ②1.2D+1.6L  ③1.2D+1.0W+L  ④1.2D+1.0E+L  ⑤0.9D+1.0W',
 'LRFD 설계하중 조합. 지배 조합 자동 선택', 60),

('KDS_BLDG_BUCKLING','KDS','BUILDING','BUCKLING','좌굴 검토 (KDS 14 20 22)',
 'N_cr = π² × E × I / (k × L)²,   λ = L_e / r',
 '세장비 λ > 200 이면 Danger 판정', 70),

('KDS_BLDG_SAFETY',  'KDS','BUILDING','SAFETY',  '안전율 기준',
 'SF = f_allow / σ_max',
 'SF ≥ SF_safe → Safe,  SF ≥ SF_warn → Warning,  그 외 Danger', 80),

-- ── KDS · BRIDGE ──────────────────────────────────────────────────
('KDS_BRDG_TRAFFIC', 'KDS','BRIDGE',  'TRAFFIC', '차량하중 (KDS 24 10 11 DB-24)',
 'P_truck = 240 kN (표준트럭),  w_lane = 12.7 kN/m (등분포)',
 'DB-24 표준트럭: 전륜 24kN, 후륜 96kN×2; 차로 수 보정', 10),

('KDS_BRDG_WIND',    'KDS','BRIDGE',  'WIND',    '교량 풍하중 (KDS 24 12 21)',
 'q_w = 0.6125 × V₀² / 1000 × C_f',
 '교량은 기본풍속 V₀=40 m/s 기준', 20),

('KDS_BRDG_DEAD',    'KDS','BRIDGE',  'DEAD',    '교량 고정하중',
 'W_self = γ × sX × sY × sZ',
 '콘크리트 24, 강 78.5 kN/m³', 30),

('KDS_BRDG_COMBO',   'KDS','BRIDGE',  'COMBO',   '교량 하중조합',
 '①1.25D+1.75(L+I)  ②1.25D+1.35W  ③1.25D+1.0E',
 'AASHTO LRFD 기반 KDS 교량 하중조합', 40),

-- ── EUROCODE2 · BUILDING ──────────────────────────────────────────
('EC2_BLDG_WIND',    'EUROCODE2','BUILDING','WIND',    '풍하중 (EN 1991-1-4)',
 'w_p = q_p(z) × C_pe,  q_p(z) = c_e(z) × q_b,  q_b = 0.5 × ρ × v_b²',
 '기본풍속 v_b에서 최대 속도압 q_p 산출', 10),

('EC2_BLDG_SEISMIC', 'EUROCODE2','BUILDING','SEISMIC', '지진하중 (EN 1998-1)',
 'F_b = S_d(T₁) × m × λ,  S_d = a_g × S × 2.5 / q_f',
 '응답스펙트럼 설계가속도. λ=0.85 (2층 이상)', 20),

('EC2_BLDG_DEAD',    'EUROCODE2','BUILDING','DEAD',    '영구하중 (EN 1991-1-1)',
 'G_k = γ × V  [kN]',
 'γ_conc=25, γ_steel=78.5 kN/m³', 30),

('EC2_BLDG_LIVE',    'EUROCODE2','BUILDING','LIVE',    '변동하중 (EN 1991-1-1)',
 'q_k  [kN/m²]',
 'Category A(주거)=2.0, B(사무)=3.0, C(집회)=3.0-5.0', 40),

('EC2_BLDG_SNOW',    'EUROCODE2','BUILDING','SNOW',    '설하중 (EN 1991-1-3)',
 's = μ_i × C_e × C_t × s_k',
 '지붕형상계수 μ_i=0.8 (경사 ≤ 30°)', 50),

('EC2_BLDG_COMBO',   'EUROCODE2','BUILDING','COMBO',   '하중조합 (EN 1990 STR)',
 '①1.35G_k+1.5Q_k  ②1.35G_k+1.5Q_k+0.9W_k  ③1.0G_k+1.0Q_k+1.0A_Ed',
 'STR 한계상태 설계 조합', 60),

('EC2_BLDG_BUCKLING','EUROCODE2','BUILDING','BUCKLING','좌굴 검토 (EN 1992-1-1)',
 'N_cr = π² × E × I / L₀²,   λ = √(A·f_ck / N_Ed) × L₀/i',
 '한계 세장비 λ_lim = 20·A·B·C / √n', 70),

('EC2_BLDG_SAFETY',  'EUROCODE2','BUILDING','SAFETY',  '안전율 기준 (EN 1990)',
 'U = σ_Ed / σ_Rd  (≤ 1.0)',
 'U ≤ U_safe → Safe,  U ≤ U_warn → Warning,  그 외 Danger', 80),

-- ── EUROCODE2 · BRIDGE ────────────────────────────────────────────
('EC2_BRDG_TRAFFIC', 'EUROCODE2','BRIDGE',  'TRAFFIC', '교통하중 LM1 (EN 1991-2)',
 'Q_1k = 300 kN (탠덤축),  q_1k = 9 kN/m² (등분포)',
 '1차로: Q1k=300kN, q1k=9kN/m². 차로 보정계수 α_Q, α_q 적용', 10),

('EC2_BRDG_WIND',    'EUROCODE2','BRIDGE',  'WIND',    '교량 풍하중 (EN 1991-1-4)',
 'F_w = 0.5 × ρ × v_b² × C_f × A_ref',
 '기준면적 A_ref = 교량 폭 × 높이', 20),

('EC2_BRDG_DEAD',    'EUROCODE2','BRIDGE',  'DEAD',    '교량 영구하중',
 'G_k = γ × V  [kN]',
 'γ_conc=25 kN/m³', 30),

('EC2_BRDG_COMBO',   'EUROCODE2','BRIDGE',  'COMBO',   '교량 하중조합 (EN 1990 Annex A2)',
 '①1.35G_k+1.35·gr1a  ②1.35G_k+1.5·W_k  ③1.0G_k+1.0·A_Ed',
 'gr1a: LM1 기본 차량군', 40)

ON CONFLICT (formula_id) DO NOTHING;

-- ================================================================
-- 공식 변수 기본값 삽입
-- ================================================================
INSERT INTO structural_formula_variable
    (formula_id, var_name, var_label, default_value, min_value, max_value, unit, description, is_editable)
VALUES
-- KDS_BLDG_WIND
('KDS_BLDG_WIND','V0',  '기본풍속도 V₀', 30,  20,  80,  'm/s',   'KDS 지역별 기본풍속도',      TRUE),
('KDS_BLDG_WIND','Kd',  '풍향계수 K_d',  0.85, 0.85,1.0, '',     '방향성 계수 (일반 0.85)',    FALSE),
('KDS_BLDG_WIND','Kzt', '지형계수 K_zt', 1.0,  1.0, 1.5, '',     '지형요인 (평지=1.0)',        TRUE),
('KDS_BLDG_WIND','Cf',  '형상계수 C_f',  1.3,  0.8, 2.0, '',     '부재 공기력 계수',           TRUE),
('KDS_BLDG_WIND','G',   '돌풍계수 G',    1.5,  1.0, 2.0, '',     '돌풍응답계수',               TRUE),
-- KDS_BLDG_SEISMIC
('KDS_BLDG_SEISMIC','SDS', '단주기 설계스펙트럼가속도 S_DS', 0.22, 0.04, 3.0, 'g', 'KDS 지역 스펙트럼 가속도', TRUE),
('KDS_BLDG_SEISMIC','R',   '반응수정계수 R',   5.0, 1.0, 8.0, '',   '구조 시스템별 계수', TRUE),
('KDS_BLDG_SEISMIC','Ie',  '중요도계수 I_e',   1.0, 1.0, 1.5, '',   '건축물 중요도 등급', TRUE),
-- KDS_BLDG_DEAD
('KDS_BLDG_DEAD','gamma_c','콘크리트 단위중량 γ_c', 24, 20, 30, 'kN/m³', '',TRUE),
('KDS_BLDG_DEAD','gamma_s','강재 단위중량 γ_s',     78.5,75,85,'kN/m³','',TRUE),
-- KDS_BLDG_LIVE
('KDS_BLDG_LIVE','qL', '바닥 활하중 q_L', 2.5, 0.5, 10.0, 'kN/m²', '사무실=2.5, 주거=2.0', TRUE),
-- KDS_BLDG_SNOW
('KDS_BLDG_SNOW','Sg',   '지상 설계적설하중 S_g', 0.5, 0.0, 3.0, 'kN/m²','지역별 기준 지상설하중', TRUE),
('KDS_BLDG_SNOW','Cb',   '지붕형상계수 C_b',       0.8, 0.5, 1.0, '','경사 ≤30° 기본값 0.8', FALSE),
('KDS_BLDG_SNOW','Ce',   '노출계수 C_e',            1.0, 0.7, 1.2, '','풍속 노출 조건', TRUE),
-- KDS_BLDG_COMBO
('KDS_BLDG_COMBO','gammaD','고정하중 계수 γ_D', 1.2, 1.0, 1.4, '', 'LRFD 고정하중 계수',  FALSE),
('KDS_BLDG_COMBO','gammaL','활하중 계수 γ_L',  1.6, 1.0, 2.0, '', 'LRFD 활하중 계수',    FALSE),
('KDS_BLDG_COMBO','gammaW','풍하중 계수 γ_W',  1.0, 0.9, 1.3, '', 'LRFD 풍하중 계수',    FALSE),
('KDS_BLDG_COMBO','gammaE','지진하중 계수 γ_E',1.0, 1.0, 1.0, '', 'LRFD 지진하중 계수',  FALSE),
-- KDS_BLDG_BUCKLING
('KDS_BLDG_BUCKLING','k',       '유효좌굴길이계수 k',   1.0, 0.5, 2.0,'',     '양단힌지=1.0, 고정-자유=2.0', TRUE),
('KDS_BLDG_BUCKLING','lambda_lim','한계세장비 λ_lim', 200, 100, 300,'',     '이 값 초과 시 세장 기둥',     TRUE),
-- KDS_BLDG_SAFETY
('KDS_BLDG_SAFETY','SF_safe', '안전 기준 SF', 2.0, 1.5, 5.0,'','SF ≥ 이 값이면 Safe',   TRUE),
('KDS_BLDG_SAFETY','SF_warn', '경고 기준 SF', 1.0, 0.8, 2.0,'','SF ≥ 이 값이면 Warning', TRUE),
-- KDS_BRDG_TRAFFIC
('KDS_BRDG_TRAFFIC','P_truck',   '표준트럭 총중량 P',  240, 100,500, 'kN','DB-24=240kN', TRUE),
('KDS_BRDG_TRAFFIC','w_lane',    '차로 등분포하중 w',  12.7, 5, 25, 'kN/m','DB-24=12.7kN/m', TRUE),
('KDS_BRDG_TRAFFIC','num_lanes', '설계차로수',          2, 1, 8,   '',    '',TRUE),
-- KDS_BRDG_WIND
('KDS_BRDG_WIND','V0', '기본풍속도 V₀', 40, 30, 80,'m/s','교량 기본풍속 40m/s', TRUE),
('KDS_BRDG_WIND','Cf', '형상계수 C_f',  1.3, 0.8,2.0,'',  '교량 단면 형상계수', TRUE),
-- KDS_BRDG_DEAD
('KDS_BRDG_DEAD','gamma_c','콘크리트 단위중량', 24,  20,30,'kN/m³','',TRUE),
('KDS_BRDG_DEAD','gamma_s','강재 단위중량',     78.5,75,85,'kN/m³','',TRUE),
-- KDS_BRDG_COMBO
('KDS_BRDG_COMBO','gammaD','고정하중 계수 γ_D', 1.25,1.0,1.5,'','AASHTO LRFD', FALSE),
('KDS_BRDG_COMBO','gammaL','활하중 계수 γ_L',  1.75,1.0,2.0,'','충격 포함',   FALSE),
-- EC2_BLDG_WIND
('EC2_BLDG_WIND','vb',  '기본풍속 v_b',      28, 15, 60, 'm/s',   'EN 1991-1-4 국가부록',      TRUE),
('EC2_BLDG_WIND','rho', '공기밀도 ρ',         1.25,1.1,1.4,'kg/m³','표준대기 1.25 kg/m³',       FALSE),
('EC2_BLDG_WIND','Cf',  '힘 계수 C_f',        1.3, 0.8,2.0,'',     '단면 형상별 계수',           TRUE),
('EC2_BLDG_WIND','Ce',  '노출계수 C_e(z)',     2.5, 1.0,4.0,'',     '높이·지형 복합 계수 (z=10m)', TRUE),
-- EC2_BLDG_SEISMIC
('EC2_BLDG_SEISMIC','ag',     '설계지반가속도 a_g', 0.1, 0.04,0.5,'g',  'EN 1998-1 지역계수', TRUE),
('EC2_BLDG_SEISMIC','S',      '지반증폭계수 S',     1.5, 1.0, 2.0,'',   '지반 유형별 (A=1.0, D=1.8)', TRUE),
('EC2_BLDG_SEISMIC','q_f',    '거동계수 q',          3.9, 1.0, 6.0,'',   'DCM 연성 시스템', TRUE),
('EC2_BLDG_SEISMIC','lambda_s','보정계수 λ',         0.85,0.85,1.0,'',   '2층 이상 =0.85', FALSE),
-- EC2_BLDG_DEAD
('EC2_BLDG_DEAD','gamma_c','콘크리트 γ', 25,  22,30,'kN/m³','EN 1991-1-1: 25 kN/m³', TRUE),
('EC2_BLDG_DEAD','gamma_s','강재 γ',     78.5,75,85,'kN/m³','',TRUE),
-- EC2_BLDG_LIVE
('EC2_BLDG_LIVE','qk','설계 활하중 q_k', 3.0, 0.5,10.0,'kN/m²','Category B 사무실 3.0', TRUE),
-- EC2_BLDG_SNOW
('EC2_BLDG_SNOW','sk',   '지상설하중 특성값 s_k', 0.5, 0.0, 3.0,'kN/m²','국가부록 지도값', TRUE),
('EC2_BLDG_SNOW','mu_i', '지붕형상계수 μ_i',       0.8, 0.5, 1.0,'',     '경사 ≤30°', FALSE),
('EC2_BLDG_SNOW','Ce_s', '노출계수 C_e',            1.0, 0.7, 1.2,'','',TRUE),
-- EC2_BLDG_COMBO
('EC2_BLDG_COMBO','gammaG','영구하중 계수 γ_G', 1.35,1.0,1.5,'','STR/GEO 불리 측',FALSE),
('EC2_BLDG_COMBO','gammaQ','변동하중 계수 γ_Q', 1.5, 1.0,2.0,'','변동하중 증폭',   FALSE),
('EC2_BLDG_COMBO','psi0',  '조합값 계수 ψ₀',   0.7, 0.5,1.0,'','동시재하 감소',   FALSE),
-- EC2_BLDG_BUCKLING
('EC2_BLDG_BUCKLING','lambda_lim','한계세장비 λ_lim', 46, 20, 100,'','EN 1992-1-1: 20ABC/√n', TRUE),
('EC2_BLDG_BUCKLING','k',          '유효길이계수 k',    1.0, 0.5,2.0,'','골조 횡구속 여부',      TRUE),
-- EC2_BLDG_SAFETY
('EC2_BLDG_SAFETY','U_safe','활용률 안전 상한 U_safe', 0.7, 0.5,0.9,'','σ_Ed/σ_Rd ≤ 이 값 → Safe',   TRUE),
('EC2_BLDG_SAFETY','U_warn','활용률 경고 상한 U_warn', 1.0, 0.9,1.1,'','σ_Ed/σ_Rd ≤ 이 값 → Warning', TRUE),
-- EC2_BRDG_TRAFFIC
('EC2_BRDG_TRAFFIC','Q1k',       '탠덤축중 Q_1k',      300, 100,500,'kN',    'LM1 1차로 탠덤 300kN', TRUE),
('EC2_BRDG_TRAFFIC','q1k',       '등분포하중 q_1k',    9,   3,  20, 'kN/m²', 'LM1 1차로 9kN/m²',     TRUE),
('EC2_BRDG_TRAFFIC','alpha_Q',   '탠덤 보정계수 α_Q',  0.8, 0.5,1.0,'',      '국가부록 값',           TRUE),
('EC2_BRDG_TRAFFIC','lane_width','차로폭',              3.0, 2.5,4.0,'m',     '',                      FALSE),
-- EC2_BRDG_WIND
('EC2_BRDG_WIND','vb',   '기본풍속 v_b', 35, 20,60,'m/s','교량 기준풍속',    TRUE),
('EC2_BRDG_WIND','rho',  '공기밀도 ρ',   1.25,1.1,1.4,'kg/m³','',           FALSE),
('EC2_BRDG_WIND','Cf',   '힘 계수 C_f',  1.3, 0.8,2.0,'',   '교량 단면 계수', TRUE),
-- EC2_BRDG_DEAD
('EC2_BRDG_DEAD','gamma_c','콘크리트 γ', 25,  22,30,'kN/m³','',TRUE),
-- EC2_BRDG_COMBO
('EC2_BRDG_COMBO','gammaG','영구하중 계수 γ_G',  1.35,1.0,1.5,'','', FALSE),
('EC2_BRDG_COMBO','gammaQ','교통하중 계수 γ_gr', 1.35,1.0,1.5,'','gr1a 차량군', FALSE)

ON CONFLICT (formula_id, var_name) DO NOTHING;
