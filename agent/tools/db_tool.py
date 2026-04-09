import pymysql
from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD


def get_connection():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        db=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def query_sensor_data(limit: int = 10) -> list[dict]:
    """최근 센서 데이터(온도, 습도) 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM SENSOR_DATA ORDER BY timestamp DESC LIMIT %s", (limit,)
            )
            return cur.fetchall()


def query_energy_data(limit: int = 10) -> list[dict]:
    """최근 에너지 데이터 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM ENERGY_DATA ORDER BY timestamp DESC LIMIT %s", (limit,)
            )
            return cur.fetchall()


def query_ems_alerts(limit: int = 10) -> list[dict]:
    """EMS 알림 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM EMS_ALERT ORDER BY created_at DESC LIMIT %s", (limit,)
            )
            return cur.fetchall()


def query_ems_thresholds() -> list[dict]:
    """EMS 임계값 설정 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM EMS_THRESHOLD")
            return cur.fetchall()


def run_custom_query(sql: str, params: tuple = ()) -> list[dict]:
    """LLM이 생성한 안전한 SELECT 쿼리 실행"""
    sql_stripped = sql.strip().upper()
    if not sql_stripped.startswith("SELECT"):
        raise ValueError("SELECT 쿼리만 허용됩니다.")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def query_bim_projects() -> list[dict]:
    """BIM 프로젝트 목록 조회"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT project_id AS projectId, project_name AS projectName, "
                "structure_type AS structureType, span_count AS spanCount "
                "FROM bim_project ORDER BY project_name ASC"
            )
            return cur.fetchall()


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
            return cur.fetchall()


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
            return cur.fetchall()


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
    "energy": query_energy_data,
    "alert": query_ems_alerts,
    "threshold": query_ems_thresholds,
}
