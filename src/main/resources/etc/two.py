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

# ========== PIR (인체 감지) ==========
PIR_PIN = 6
LED_PIN = 23
GPIO.setmode(GPIO.BCM)
GPIO.setup(PIR_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
GPIO.setup(LED_PIN, GPIO.OUT)
GPIO.output(LED_PIN, False)

# ========== 메인 루프 ==========
print("PIR 센서 예열 중... 20초 기다리세요.")
time.sleep(20)
print("센서 실행 시작!")

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
