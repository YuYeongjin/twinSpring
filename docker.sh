#!/bin/bash
set -e

# 0. 도커 로그인 확인 (필수: sensor 이미지 pull denied 해결용)
echo "===== Docker Login Check ====="
docker login

# 1. Spring Boot JAR 빌드 (Maven)
echo "===== Maven Build Start ====="
./mvnw clean package -DskipTests

# 2. twinBIM .NET 퍼블리시 (3개 아키텍처 모두)
echo "===== twinBIM dotnet publish ====="
dotnet publish twinBIM/twinBIM.csproj -c Release -r linux-arm   --self-contained true -o twinBIM/publish-arm32
dotnet publish twinBIM/twinBIM.csproj -c Release -r linux-arm64 --self-contained true -o twinBIM/publish-arm64
dotnet publish twinBIM/twinBIM.csproj -c Release -r linux-x64   --self-contained true -o twinBIM/publish-amd64

# 3. buildx 빌더 설정
docker buildx use yeongjin95 2>/dev/null || docker buildx create --name yeongjin95 --use
docker buildx inspect --bootstrap

PLATFORMS="linux/amd64,linux/arm64,linux/arm/v7"

# 4. Spring 앱 이미지 (Java - 모든 플랫폼)
echo "===== Building twin-spring ====="
docker buildx build \
  --platform $PLATFORMS \
  -t yeongjin95/twin-spring:latest \
  --push .

# 5. BIM API 이미지 (아키텍처별 바이너리 선택 → twinBIM/Dockerfile 참고)
echo "===== Building twin-bim ====="
docker buildx build \
  --platform $PLATFORMS \
  -t yeongjin95/twin-bim:latest \
  --push ./twinBIM

# 6. Sensor 이미지 (GPIO 하드웨어 - Pi 전용)
echo "===== Building twin-sensor ====="
docker buildx build \
  --platform linux/arm64,linux/arm/v7 \
  -t yeongjin95/twin-sensor:latest \
  --push ./iot

echo "===== All images pushed successfully! ====="
