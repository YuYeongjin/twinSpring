#!/bin/bash
./mvnw clean package -DskipTests

# 1. buildx 빌더 확인 및 생성
if ! docker buildx inspect yeongjin95 > /dev/null 2>&1; then
    echo "Creating new buildx builder..."
    docker buildx create --name yeongjin95 --use
else
    docker buildx use yeongjin95
fi

# 2. 빌더 시작
docker buildx inspect --bootstrap

# 3. 멀티 플랫폼 빌드 (32비트 armv7용) 및 푸시
echo "Starting build for linux/arm/v7..."
docker buildx build --platform linux/arm/v7 \
  -t yeongjin95/twin-spring:latest \
  --push .

# 4. 결과 확인
if [ $? -eq 0 ]; then
    echo "Successfully pushed to Docker Hub (32-bit)!"
else
    echo "Build failed. Please check the logs."
    exit 1
fi