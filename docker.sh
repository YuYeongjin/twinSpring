#!/bin/bash
set -e

# 1. Spring Boot JAR 빌드
echo "===== Maven Build Start ====="
./mvnw clean package -DskipTests

# 2. twinBIM .NET 퍼블리시 (폴더명을 Docker 아키텍처 이름과 매칭)
echo "===== twinBIM dotnet publish ====="
# arm/v7 은 도커에서 'arm'으로 인식됩니다.
dotnet publish twinBIM/twinBIM.csproj -c Release -r linux-arm   --self-contained true -o twinBIM/publish-arm
dotnet publish twinBIM/twinBIM.csproj -c Release -r linux-arm64 --self-contained true -o twinBIM/publish-arm64
dotnet publish twinBIM/twinBIM.csproj -c Release -r linux-x64   --self-contained true -o twinBIM/publish-amd64

# 3. buildx 빌더 설정
docker buildx use yeongjin95 2>/dev/null || docker buildx create --name yeongjin95 --use
docker buildx inspect --bootstrap

PLATFORMS="linux/amd64,linux/arm64,linux/arm/v7"

# 4. Spring 앱 이미지
echo "===== Building twin-spring ====="
docker buildx build \
  --platform $PLATFORMS \
  --no-cache \
  -t yeongjin95/twin-spring:latest \
  -t yeongjin95/twin-spring:v1.0.1 \
  --push .

# 5. BIM API 이미지 (에뮬레이션 없이 COPY만 수행하여 매우 빠름)
echo "===== Building twin-bim ====="
docker buildx build \
  --platform $PLATFORMS \
  -t yeongjin95/twin-bim:latest \
  --push ./twinBIM

# 6. Sensor 이미지
echo "===== Building twin-sensor ====="
docker buildx build \
  --platform linux/arm64,linux/arm/v7 \
  -t yeongjin95/twin-sensor:latest \
  --push ./iot

echo "===== All images pushed successfully! ====="