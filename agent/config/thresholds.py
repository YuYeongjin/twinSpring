"""
센서 알람 임계값 런타임 저장소

- 초기값: config/settings.py (환경변수 또는 기본값)
- 런타임 변경: server.py PUT /admin/sensor-thresholds 경유 update() 호출
- 읽기: sensor.py 에서 get() 호출 (요청마다 최신값 반영)
"""
from config.settings import SENSOR_TEMP_HIGH, SENSOR_TEMP_LOW, SENSOR_HUM_HIGH, SENSOR_HUM_LOW

_store: dict[str, float] = {
    "temp_high": SENSOR_TEMP_HIGH,
    "temp_low":  SENSOR_TEMP_LOW,
    "hum_high":  SENSOR_HUM_HIGH,
    "hum_low":   SENSOR_HUM_LOW,
}


def get() -> dict[str, float]:
    return _store


def update(data: dict) -> dict[str, float]:
    for key in ("temp_high", "temp_low", "hum_high", "hum_low"):
        if key in data:
            _store[key] = float(data[key])
    return _store
