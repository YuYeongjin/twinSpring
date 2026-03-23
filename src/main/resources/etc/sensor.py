import time
import json
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import adafruit_dht
import board
import paho.mqtt.client as mqtt

# ── MQTT 설정 ──────────────────────────────────────────────────────────────
MQTT_BROKER = "localhost"   # Spring 서버 IP로 변경 (예: "192.168.1.100")
MQTT_PORT   = 1883
MQTT_TOPIC  = "test/topic"

# ── DHT11 설정 ────────────────────────────────────────────────────────────
SENSOR_PIN     = board.D17  # GPIO 17번 핀
READ_INTERVAL  = 2          # 읽기 주기 (초) — DHT11은 최소 2초 필요
LOCATION       = "bridgeA"  # Spring으로 전송할 위치 식별자
MAX_FAIL_COUNT = 5          # 연속 실패 이 횟수 초과 시 센서 재초기화

# ── DHT11 초기화 ───────────────────────────────────────────────────────────
# use_pulseio=False: RPi4 신커널 호환 핵심 설정
# 하드웨어 PulseIO 대신 소프트웨어 타이밍(비트뱅)을 사용합니다.
def create_sensor():
    return adafruit_dht.DHT11(SENSOR_PIN, use_pulseio=False)

dht = create_sensor()

# ── MQTT 연결 콜백 ────────────────────────────────────────────────────────
def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print(f"[MQTT] 브로커 연결 성공 ({MQTT_BROKER}:{MQTT_PORT})")
    else:
        print(f"[MQTT] 연결 실패 - reason_code: {reason_code}")

def on_disconnect(client, userdata, flags, reason_code, properties):
    print(f"[MQTT] 연결 끊김 - reason_code: {reason_code}")

# ── MQTT 클라이언트 설정 ──────────────────────────────────────────────────
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect    = on_connect
client.on_disconnect = on_disconnect

try:
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
except Exception as e:
    print(f"[MQTT] 브로커 연결 실패: {e}")
    print(f"       → MQTT 브로커가 {MQTT_BROKER}:{MQTT_PORT} 에서 실행 중인지 확인하세요.")
    sys.exit(1)

client.loop_start()

# ── 메인 루프 ─────────────────────────────────────────────────────────────
fail_count = 0

print(f"[DHT11] 센서 읽기 시작 (핀: GPIO17, 주기: {READ_INTERVAL}초)")

try:
    while True:
        try:
            temperature = dht.temperature
            humidity    = dht.humidity

            # 센서가 None을 반환하는 경우 방어 처리
            if temperature is None or humidity is None:
                raise RuntimeError("센서 반환값이 None입니다.")

            payload = {
                "temperature": round(float(temperature), 2),
                "humidity":    round(float(humidity), 2),
                "timestamp":   datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
                "location":    LOCATION,
            }

            result = client.publish(MQTT_TOPIC, json.dumps(payload, ensure_ascii=False))

            # MQTT 발행 성공 여부 확인
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                print(f"[OK] 전송 → {payload}")
            else:
                print(f"[WARN] MQTT 발행 실패 rc={result.rc}")

            fail_count = 0  # 성공 시 실패 카운터 초기화

        except RuntimeError as e:
            fail_count += 1
            print(f"[WARN] 읽기 실패 ({fail_count}/{MAX_FAIL_COUNT}): {e}")

            # 연속 실패가 MAX_FAIL_COUNT를 초과하면 센서 재초기화
            # GPIO가 이전 실행에서 잠긴 경우 해소
            if fail_count >= MAX_FAIL_COUNT:
                print("[INFO] 센서 재초기화 중...")
                try:
                    dht.exit()          # 기존 GPIO 리소스 해제
                except Exception:
                    pass
                time.sleep(2)
                dht = create_sensor()  # 새 인스턴스 생성
                fail_count = 0
                print("[INFO] 센서 재초기화 완료")

        time.sleep(READ_INTERVAL)

except KeyboardInterrupt:
    print("\n[DHT11] 종료합니다.")

finally:
    # GPIO 리소스 및 MQTT 연결 정리
    try:
        dht.exit()
    except Exception:
        pass
    client.loop_stop()
    client.disconnect()
    print("[DHT11] 리소스 해제 완료")