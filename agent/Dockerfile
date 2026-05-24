# 1. 파이썬 경량 베이스 이미지 사용
FROM python:3.11-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 파이썬 컨테이너 최적화 환경 변수 설정
# (파이썬 로그가 버퍼에 쌓이지 않고 도커 로그에 즉시 출력되도록 함)
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# 4. OS 레벨 필수 패키지가 있다면 설치 (보통 생략 가능하지만, 컴파일이 필요한 파이썬 패키지가 있을 경우)
# RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*

# 5. 의존성 파일 복사 및 파이썬 패키지 설치 (여기서 대형 패키지들 캐싱 처리됨)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 6. 소스 코드 전체 복사 (자주 바뀌는 코드는 아래 배치)
COPY . .

# 7. 포트 노출
EXPOSE 7070

# 8. 애플리케이션 실행 명령어
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7070"]