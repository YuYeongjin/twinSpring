FROM eclipse-temurin:17-jdk-focal

# .NET 실행 라이브러리 + Python3 설치
RUN apt-get update && apt-get install -y \
    libicu-dev \
    libssl-dev \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 파일 복사 (경로 주의!)
COPY target/*.jar app.jar
COPY target/classes/bim-api /app/bim-api
COPY src/main/resources/sensor.py /app/resources/sensor.py

# 실행
ENTRYPOINT ["java", "-jar", "/app.jar"]