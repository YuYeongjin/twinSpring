from __future__ import annotations
import logging
import psycopg2
import psycopg2.extras
import psycopg2.pool
from config.settings import VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME, VECTOR_DB_USER, VECTOR_DB_PASSWORD

logger = logging.getLogger(__name__)

# ── 연결 풀 (스레드 안전, 1~5 커넥션) ─────────────────────────────────────────
# 매 쿼리마다 새 connection을 여는 대신 풀에서 재사용
_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None or _pool.closed:
        try:
            _pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=5,
                host=VECTOR_DB_HOST,
                port=VECTOR_DB_PORT,
                dbname=VECTOR_DB_NAME,
                user=VECTOR_DB_USER,
                password=VECTOR_DB_PASSWORD,
                connect_timeout=5,
                cursor_factory=psycopg2.extras.RealDictCursor,
            )
            logger.info("[DB] 연결 풀 생성 완료 (%s:%s/%s)", VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME)
        except Exception as e:
            logger.error("[DB] 연결 풀 생성 실패: %s", e)
            raise
    return _pool


class _PooledConn:
    """with 문에서 연결 풀 커넥션을 안전하게 반납하는 컨텍스트 매니저"""

    def __init__(self):
        self._conn = None

    def __enter__(self):
        self._conn = _get_pool().getconn()
        return self._conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._conn:
            # 예외 발생 시 rollback 후 반납, 정상이면 commit
            if exc_type:
                try:
                    self._conn.rollback()
                except Exception:
                    pass
            else:
                try:
                    self._conn.commit()
                except Exception:
                    pass
            _get_pool().putconn(self._conn)
            self._conn = None
        return False  # 예외를 전파


# ── 쿼리 함수 ─────────────────────────────────────────────────────────────────
# PostgreSQL은 따옴표 없는 식별자를 소문자로 저장.
# schema.sql 의 `CREATE TABLE IF NOT EXISTS SENSOR_DATA` → 실제 이름: sensor_data


def query_sensor_data(limit: int = 10) -> list[dict]:
    """최근 센서 데이터(온도, 습도) 조회"""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT %s",
                    (limit,),
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.warning("[DB] sensor_data 조회 실패: %s", e)
        return []


def run_custom_query(sql: str, params: tuple = ()) -> list[dict]:
    """LLM이 생성한 안전한 SELECT 쿼리 실행"""
    sql_stripped = sql.strip().upper()
    if not sql_stripped.startswith("SELECT"):
        raise ValueError("SELECT 쿼리만 허용됩니다.")
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.warning("[DB] 커스텀 쿼리 실패: %s", e)
        return []


def query_bim_projects() -> list[dict]:
    """BIM 프로젝트 목록 조회"""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT project_id AS "projectId", project_name AS "projectName", '
                    'structure_type AS "structureType", span_count AS "spanCount" '
                    "FROM bim_project ORDER BY project_name ASC"
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.warning("[DB] bim_project 조회 실패: %s", e)
        return []


def query_bim_element_stats(project_id: str) -> list[dict]:
    """프로젝트 부재 타입별 통계 조회"""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT element_type AS "elementType", COUNT(*) AS "elementCount" '
                    "FROM bim_element WHERE project_id = %s "
                    'GROUP BY element_type ORDER BY "elementCount" DESC',
                    (project_id,),
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.warning("[DB] bim_element_stats 조회 실패: %s", e)
        return []


def query_bim_elements(project_id: str, limit: int = 200) -> list[dict]:
    """프로젝트 부재 목록 조회"""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT element_id AS "elementId", element_type AS "elementType", material, '
                    'position_x AS "positionX", position_y AS "positionY", position_z AS "positionZ", '
                    'size_x AS "sizeX", size_y AS "sizeY", size_z AS "sizeZ" '
                    "FROM bim_element WHERE project_id = %s "
                    'ORDER BY element_type, element_id LIMIT %s',
                    (project_id, limit),
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.warning("[DB] bim_elements 조회 실패: %s", e)
        return []


def query_bim_total_count(project_id: str) -> int:
    """프로젝트 전체 부재 수"""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS cnt FROM bim_element WHERE project_id = %s",
                    (project_id,),
                )
                row = cur.fetchone()
                return row["cnt"] if row else 0
    except Exception as e:
        logger.warning("[DB] bim_total_count 조회 실패: %s", e)
        return 0


def insert_bim_project(project_id: str, project_name: str, structure_type: str = "Building") -> None:
    """BIM 프로젝트를 PostgreSQL에 직접 저장."""
    with _PooledConn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO bim_project (project_id, project_name, structure_type) "
                "VALUES (%s, %s, %s) ON CONFLICT (project_id) DO NOTHING",
                (project_id, project_name, structure_type),
            )


def log_agent_query(session_id: str, message: str, domain: str | None = None, project_id: str | None = None) -> None:
    """사용자 질문을 agent_query_log 테이블에 저장 (실패해도 조용히 무시)."""
    try:
        with _PooledConn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO agent_query_log (session_id, message, domain, project_id) "
                    "VALUES (%s, %s, %s, %s)",
                    (session_id, message, domain, project_id),
                )
    except Exception as e:
        logger.warning("[DB] agent_query_log 저장 실패: %s", e)


# 테이블별 조회 함수 매핑
TABLE_QUERY_MAP = {
    "sensor": query_sensor_data,
}
