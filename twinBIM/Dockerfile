FROM debian:bookworm-slim

# Docker buildx가 자동으로 주입하는 빌드 아키텍처 변수
ARG TARGETARCH
ARG TARGETVARIANT

RUN apt-get update && apt-get install -y \
    libicu-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 세 아키텍처의 publish 결과물을 임시 경로에 모두 복사
COPY publish-arm32/ /tmp/arm32/
COPY publish-arm64/ /tmp/arm64/
COPY publish-amd64/ /tmp/amd64/

# TARGETARCH 에 따라 올바른 바이너리를 /app 으로 이동
RUN if [ "$TARGETARCH" = "arm" ]; then \
      cp -r /tmp/arm32/. /app/; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
      cp -r /tmp/arm64/. /app/; \
    else \
      cp -r /tmp/amd64/. /app/; \
    fi \
    && rm -rf /tmp/arm32 /tmp/arm64 /tmp/amd64 \
    && chmod +x /app/twinBIM

ENV ASPNETCORE_URLS=http://+:5112

EXPOSE 5112
ENTRYPOINT ["./twinBIM"]
