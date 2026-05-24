import os
from dotenv import load_dotenv

load_dotenv()

# LLM (Ollama)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")

# Database (PostgreSQL + pgvector)
VECTOR_DB_HOST = os.getenv("VECTOR_DB_HOST", "localhost")
VECTOR_DB_PORT = int(os.getenv("VECTOR_DB_PORT", "5432"))
VECTOR_DB_NAME = os.getenv("VECTOR_DB_NAME", "digital_twin")
VECTOR_DB_USER = os.getenv("VECTOR_DB_USER", "postgres")
VECTOR_DB_PASSWORD = os.getenv("VECTOR_DB_PASSWORD", "Abcd1234")

# InfluxDB (IoT 시계열 데이터)
INFLUX_URL = os.getenv("INFLUX_URL", "http://localhost:8086")
INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", "twinspring-influx-admin-token")
INFLUX_ORG = os.getenv("INFLUX_ORG", "twinspring")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "iot_data")

# RAG (ChromaDB - 로컬 개발용, K8s에서는 pgvector로 대체 가능)
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "twin_docs")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")

# Spring Boot
SPRING_BASE_URL = os.getenv("SPRING_BASE_URL", "http://localhost:8080")
