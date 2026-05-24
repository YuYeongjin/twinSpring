# 1. 파이썬 경량 베이스 이미지 사용
FROM python:3.11-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 컨테이너 최적화 환경 변수 설정
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 4. OpenCV 및 Ultralytics(YOLO) 구동을 위한 필수 OS 라이브러리 설치 (에러 방지 필수)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 5. 의존성 패키지 캐싱 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. 추론 스크립트 및 가중치 파일(YOLOv8n) 복사
COPY detect.py .
COPY yolov8n.pt .

# 7. 포트 노출 (객체 탐지 API 서버 포트)
EXPOSE 5001

# 8. 애플리케이션 실행
CMD ["python", "detect.py"]