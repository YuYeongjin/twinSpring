import json
import random
import datetime
import time
import subprocess

count = 0
while count < 20:
    # 1. 랜덤 JSON 생성
    payload = {
        "location": "bridgeA",
        "temperature": random.randint(10, 40),
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    }

    # 2. data.json 파일로 저장
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"✅ [{count+1}] 생성된 payload:", payload)

    # 3. mosquitto_pub 실행 (-f data.json)
    subprocess.run([
        "mosquitto_pub", "-h", "localhost", "-t", "test/topic", "-f", "data.json"
    ])

    # 4. 3초 대기
    time.sleep(3)
    count += 1
