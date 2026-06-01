import os
from dotenv import load_dotenv

load_dotenv()

# LLM (Ollama)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")

# Database (PostgreSQL)
# VECTOR_DB_* 우선, 없으면 docker-compose 호환 DB_* 사용, 최종 로컬 기본값
VECTOR_DB_HOST     = os.getenv("VECTOR_DB_HOST")     or os.getenv("DB_HOST",     "localhost")
VECTOR_DB_PORT     = int(os.getenv("VECTOR_DB_PORT") or os.getenv("DB_PORT",     "5432"))
VECTOR_DB_NAME     = os.getenv("VECTOR_DB_NAME")     or os.getenv("DB_NAME",     "digital_twin")
VECTOR_DB_USER     = os.getenv("VECTOR_DB_USER")     or os.getenv("DB_USER",     "postgres")
VECTOR_DB_PASSWORD = os.getenv("VECTOR_DB_PASSWORD") or os.getenv("DB_PASSWORD", "Abcd1234")

# InfluxDB (IoT 시계열 데이터)
INFLUX_URL = os.getenv("INFLUX_URL", "http://localhost:8086")
INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", "twinspring-influx-admin-token")
INFLUX_ORG = os.getenv("INFLUX_ORG", "twinspring")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "iot_data")

# RAG (pgvector — PostgreSQL vector extension)
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")

def get_pgvector_connection() -> str:
    """psycopg v3 연결 문자열 반환 (langchain-postgres>=0.0.12 는 psycopg v3 필요)"""
    return (
        f"postgresql+psycopg://{VECTOR_DB_USER}:{VECTOR_DB_PASSWORD}"
        f"@{VECTOR_DB_HOST}:{VECTOR_DB_PORT}/{VECTOR_DB_NAME}"
    )

# Spring Boot
SPRING_BASE_URL = os.getenv("SPRING_BASE_URL", "http://localhost:8080")
