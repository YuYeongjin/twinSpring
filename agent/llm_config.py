# llm_config.py
from langchain_ollama import ChatOllama
from config import OLLAMA_BASE_URL, LLM_MODEL

# 정확한 판단/파싱용 (temperature=0)
llm_precise = ChatOllama(base_url=OLLAMA_BASE_URL, model=LLM_MODEL, temperature=0)

# 자연스러운 대화/응답 생성용 (temperature=0.7)
llm_chat = ChatOllama(base_url=OLLAMA_BASE_URL, model=LLM_MODEL, temperature=0.7)
