# llm_config.py
from langchain_ollama import ChatOllama
from config.settings import OLLAMA_BASE_URL, LLM_MODEL

_TIMEOUT = 600  # seconds

ROUTER_MODEL    = "llama3.2:1b"   # 빠른 도메인 분류 전용
RESPONDER_MODEL = LLM_MODEL       # qwen2.5:3b — 최종 응답 생성

# 라우터 — llama3.2:1b (temperature=0, 분류 전용)
llm_router = ChatOllama(
    base_url=OLLAMA_BASE_URL, model=ROUTER_MODEL,
    temperature=0, timeout=_TIMEOUT,
)

# 응답 생성 — qwen2.5:3b (temperature=0.7)
llm_responder = ChatOllama(
    base_url=OLLAMA_BASE_URL, model=RESPONDER_MODEL,
    temperature=0.7, timeout=_TIMEOUT,
)

# 하위호환 alias
llm_precise = ChatOllama(
    base_url=OLLAMA_BASE_URL, model=RESPONDER_MODEL,
    temperature=0, timeout=_TIMEOUT,
)
llm_chat = llm_responder
