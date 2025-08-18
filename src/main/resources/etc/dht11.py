import time
import json
from datetime import datetime

import adafruit_dht
import board
import paho.mqtt.client as mqtt

MQTT_BROKER = "192.168.45.195"
MQTT_PORT = 1883
MQTT_TOPIC = "test/topic"

dht = adafruit_dht.DHT11(board.D17)

client = mqtt.Client()
client.connect(MQTT_BROKER, MQTT_PORT, 60)

try:
    while True:
        try:
            temperature = dht.temperature
            humidity = dht.humidity
            payload = {
                "temperature": round(float(temperature), 2),
                "humidity": round(float(humidity), 2),
                "timestamp": datetime.now().isoformat(),
                "location": "bridgeA"
            }
            client.publish(MQTT_TOPIC, json.dumps(payload, ensure_ascii=False))
            print(f"Sent → {payload}")
        except RuntimeError as e:
            print(f"읽기/전송 실패: {e}")
        time.sleep(2)
except KeyboardInterrupt:
    print("종료합니다.")
finally:
    client.disconnect()