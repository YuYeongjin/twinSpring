# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ── Layer 1: 무거운 패키지 (PyTorch / HuggingFace)
# requirements-base.txt가 바뀌지 않으면 이 레이어는 캐시 히트
COPY requirements-base.txt .
RUN pip install --no-cache-dir -r requirements-base.txt

# ── Layer 2: 앱 패키지 (LangChain / FastAPI 등)
# requirements.txt만 바뀌면 Layer 1은 캐시 유지, 여기서만 재설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Layer 3: 소스 코드 (가장 자주 바뀜)
COPY . .

EXPOSE 7070

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7070"]
