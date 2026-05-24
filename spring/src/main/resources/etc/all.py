import time
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import adafruit_dht
import board
import paho.mqtt.client as mqtt
import RPi.GPIO as GPIO

# ========== MQTT 설정 ==========
MQTT_BROKER = "10.132.50.15"
MQTT_PORT = 1883
MQTT_TOPIC = "test/topic"

client = mqtt.Client(protocol=mqtt.MQTTv311)
client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_start()

# ========== DHT11 (온습도) ==========
dht = adafruit_dht.DHT11(board.D17)

# ========== PIR (인체감지) ==========
PIR_PIN = 6
LED_PIN = 23
GPIO.setmode(GPIO.BCM)
GPIO.setup(PIR_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
GPIO.setup(LED_PIN, GPIO.OUT)
GPIO.output(LED_PIN, False)

# ========== HC-SR04 (초음파) ==========
TRIG = 18
ECHO = 24
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

def get_distance():
    GPIO.output(TRIG, False)
    time.sleep(0.000002)
    GPIO.output(TRIG, True)
    time.sleep(0.00001)  # 10µs
    GPIO.output(TRIG, False)

    pulse_start = time.time()
    timeout = pulse_start + 0.04
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if time.time() > timeout:
            return None

    pulse_end = time.time()
    timeout = pulse_end + 0.04
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if time.time() > timeout:
            return None

    distance = (pulse_end - pulse_start) * 17150
    return round(distance, 2)

# ========== 메인 루프 ==========
print("PIR 센서 예열 중... 20초 기다리세요.")
time.sleep(20)
print("센서 통합 실행 시작!")

try:
    while True:
        payload = {
            "timestamp": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(),
            "location": "bridgeA"
        }

        # --- 온습도 ---
        try:
            temperature = dht.temperature
            humidity = dht.humidity
            if temperature is not None and humidity is not None:
                payload["temperature"] = round(float(temperature), 2)
                payload["humidity"] = round(float(humidity), 2)
            else:
                payload["temperature"] = None
                payload["humidity"] = None
        except RuntimeError as e:
            print("DHT11 읽기 실패:", e)

        # --- PIR ---
        pir_val = GPIO.input(PIR_PIN)
        if pir_val == 1:
            GPIO.output(LED_PIN, True)
            payload["motion"] = True
        else:
            GPIO.output(LED_PIN, False)
            payload["motion"] = False

        # --- 거리 ---
        dist = get_distance()
        payload["distance_cm"] = dist if dist is not None else None

        # --- 출력 & MQTT 발행 ---
        print("센서 데이터:", payload)
        client.publish(MQTT_TOPIC, json.dumps(payload, ensure_ascii=False))

        time.sleep(2)

except KeyboardInterrupt:
    print("종료합니다.")

finally:
    client.loop_stop()
    client.disconnect()
    GPIO.cleanup()
