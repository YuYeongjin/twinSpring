# llm_config.py
from langchain_ollama import ChatOllama

# 정확한 판단을 내리기 위한 Temperature 0 세팅 모델 (기존 코드)
llm_precise = ChatOllama(model="llama3.1:8b", temperature=0)

# 💡 자연스러운 대화와 문장 생성을 위한 모델 (추가!)
llm_chat = ChatOllama(model="llama3.1:8b", temperature=0.7)