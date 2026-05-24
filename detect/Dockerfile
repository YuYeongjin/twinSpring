# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ── Layer 1: OS 패키지 (변경 거의 없음)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Layer 2: 무거운 패키지 (PyTorch / OpenCV)
# requirements-base.txt가 바뀌지 않으면 이 레이어는 캐시 히트
COPY requirements-base.txt .
RUN pip install --no-cache-dir -r requirements-base.txt

# ── Layer 3: 가벼운 앱 패키지 (Flask 등)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Layer 4: YOLO 모델 다운로드 (소스 코드와 분리)
# detect.py가 바뀌어도 이 레이어는 캐시 유지 → 모델 재다운로드 없음
RUN curl -L -o yolov8n.pt https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt

# ── Layer 5: 소스 코드 (가장 자주 바뀜)
COPY detect.py .

EXPOSE 5001

CMD ["python", "detect.py"]
