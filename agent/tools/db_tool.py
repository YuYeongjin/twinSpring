import psycopg2
import psycopg2.extras
from config import VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME, VECTOR_DB_USER, VECTOR_DB_PASSWORD


def get_connection():
    return psycopg2.connect(
        host=VECTOR_DB_HOST,
        port=VECTOR_DB_PORT,
        dbname=VECTOR_DB_NAME,
        user=VECTOR_DB_USER,
        password=VECTOR_DB_PASSWORD,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def query_sensor_data(limit: int = 10) -> list[dict]:
    """최근 센서 데이터(온도, 습도) 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT * FROM "SENSOR_DATA" ORDER BY timestamp DESC LIMIT %s', (limit,)
            )
            return [dict(row) for row in cur.fetchall()]


def run_custom_query(sql: str, params: tuple = ()) -> list[dict]:
    """LLM이 생성한 안전한 SELECT 쿼리 실행"""
    sql_stripped = sql.strip().upper()
    if not sql_stripped.startswith("SELECT"):
        raise ValueError("SELECT 쿼리만 허용됩니다.")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]


def query_bim_projects() -> list[dict]:
    """BIM 프로젝트 목록 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT project_id AS projectId, project_name AS projectName, "
                "structure_type AS structureType, span_count AS spanCount "
                "FROM bim_project ORDER BY project_name ASC"
            )
            return [dict(row) for row in cur.fetchall()]


def query_bim_element_stats(project_id: str) -> list[dict]:
    """프로젝트 부재 타입별 통계 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT element_type AS elementType, COUNT(*) AS elementCount "
                "FROM bim_element WHERE project_id = %s "
                "GROUP BY element_type ORDER BY elementCount DESC",
                (project_id,),
            )
            return [dict(row) for row in cur.fetchall()]


def query_bim_elements(project_id: str, limit: int = 200) -> list[dict]:
    """프로젝트 부재 목록 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT element_id AS elementId, element_type AS elementType, material, "
                "position_x AS positionX, position_y AS positionY, position_z AS positionZ, "
                "size_x AS sizeX, size_y AS sizeY, size_z AS sizeZ "
                "FROM bim_element WHERE project_id = %s "
                "ORDER BY element_type, element_id LIMIT %s",
                (project_id, limit),
            )
            return [dict(row) for row in cur.fetchall()]


def query_bim_total_count(project_id: str) -> int:
    """프로젝트 전체 부재 수"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM bim_element WHERE project_id = %s",
                (project_id,),
            )
            row = cur.fetchone()
            return row["cnt"] if row else 0


# 테이블별 조회 함수 매핑
TABLE_QUERY_MAP = {
    "sensor": query_sensor_data,
}
