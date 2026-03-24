# 1. 최신 안정 버전인 Bookworm 기반 이미지로 변경
FROM python:3.9-slim-bookworm


# 2. 필수 시스템 패키지 설치
# Bookworm은 최신 레포지토리를 사용하므로 에러 없이 설치됩니다.
RUN apt-get update && apt-get install -y \
    libgpiod2 \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. 의존성 라이브러리 설치
RUN pip install --no-cache-dir \
    adafruit-circuitpython-dht \
    paho-mqtt \
    RPi.GPIO \
    board

# 4. 소스 코드 복사
COPY sensor.py .

# 5. 실행
CMD ["python", "sensor.py"]