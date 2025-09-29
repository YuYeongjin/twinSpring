import RPi.GPIO as GPIO
import time

# BCM 모드로 설정
GPIO.setmode(GPIO.BCM)

# 핀 번호 설정
PIR_PIN = 6     # PIR 센서 출력
LED_PIN = 23    # 빨간 LED

# 핀 입출력 모드 지정
GPIO.setup(PIR_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

GPIO.setup(LED_PIN, GPIO.OUT)

print("PIR 센서 예열 중... 20초 정도 기다리세요.")
GPIO.output(LED_PIN, False)  # LED 끄기
time.sleep(20)
print("동작 시작!")

try:
    while True:
        if GPIO.input(PIR_PIN):   # 움직임 감지
            val = GPIO.input(PIR_PIN)
            GPIO.output(LED_PIN, True)
            print("PIR 출력:", val)
            print("움직임 감지 →LED ON")
            time.sleep(1)
            GPIO.output(LED_PIN, False)
        else:
            GPIO.output(LED_PIN, False)
            print("움직임 없음 →LED OFF")
            time.sleep(1)

        time.sleep(1)

except KeyboardInterrupt:
    print("종료합니다.")
    GPIO.cleanup()
