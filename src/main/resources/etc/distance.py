import RPi.GPIO as GPIO
import time

# 핀 번호 (BCM 모드)
TRIG = 18   # 초음파 발사
ECHO = 24   # 초음파 수신

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)
GPIO.setup(TRIG, GPIO.OUT)
GPIO.setup(ECHO, GPIO.IN)

def get_distance():
    # TRIG를 LOW로 초기화
    GPIO.output(TRIG, False)
    time.sleep(0.000002)

    # TRIG에 10us 펄스 주기
    GPIO.output(TRIG, True)
    time.sleep(0.00001)   # 10 마이크로초
    GPIO.output(TRIG, False)

    # ECHO 핀 HIGH 대기 (타임아웃 추가)
    pulse_start = time.time()
    timeout = pulse_start + 0.04  # 40ms
    while GPIO.input(ECHO) == 0:
        pulse_start = time.time()
        if pulse_start > timeout:
            return None

    # ECHO 핀 LOW 대기
    pulse_end = time.time()
    timeout = pulse_end + 0.04
    while GPIO.input(ECHO) == 1:
        pulse_end = time.time()
        if pulse_end > timeout:
            return None

    pulse_duration = pulse_end - pulse_start
    distance = pulse_duration * 17150  # cm 계산
    return round(distance, 2)

try:
    print("HC-SR04 테스트 시작")
    while True:
        dist = get_distance()
        if dist is not None:
            print(f"거리: {dist} cm")
        else:
            print("측정 실패")
        time.sleep(1)

except KeyboardInterrupt:
    print("종료합니다.")
    GPIO.cleanup()