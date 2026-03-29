FROM debian:bookworm-slim

# Docker buildx가 자동으로 주입하는 변수
ARG TARGETARCH

# 런타임 필수 패키지 설치
RUN apt-get update && apt-get install -y \
    libicu-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# [핵심 수정] 아키텍처별로 폴더명을 맞춰서 필요한 것만 복사 (에뮬레이션 불필요)
# TARGETARCH는 amd64, arm64, arm 등으로 들어옵니다.
COPY publish-${TARGETARCH}/ .

# 실행 권한 부여 (바이너리 이름이 twinBIM이라고 가정)
RUN chmod +x ./twinBIM

ENV ASPNETCORE_URLS=http://+:5112
EXPOSE 5112

ENTRYPOINT ["./twinBIM"]