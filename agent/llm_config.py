# llm_config.py
from langchain_ollama import ChatOllama
from config import OLLAMA_BASE_URL, LLM_MODEL

# ChatOllama 내부적으로 httpx를 사용하며, timeout 미설정 시 기본값(30~60초)이 적용됨
# 영어/일본어 대화는 supervisor + chat 등 LLM 호출이 2회 이상 발생해 누적 타임아웃으로 504 발생
# → timeout=600 (10분)으로 명시해 long-running LLM 응답을 허용
_TIMEOUT = 600  # seconds

# 정확한 판단/파싱용 (temperature=0)
llm_precise = ChatOllama(base_url=OLLAMA_BASE_URL, model=LLM_MODEL, temperature=0, timeout=_TIMEOUT)

# 자연스러운 대화/응답 생성용 (temperature=0.7)
llm_chat = ChatOllama(base_url=OLLAMA_BASE_URL, model=LLM_MODEL, temperature=0.7, timeout=_TIMEOUT)
