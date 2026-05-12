import threading
import RPi.GPIO as GPIO
from flask import Flask, jsonify

app = Flask(__name__)

LED_PIN = 23
AUTO_OFF_SECONDS = 30

GPIO.setmode(GPIO.BCM)
GPIO.setup(LED_PIN, GPIO.OUT)
GPIO.output(LED_PIN, False)

_led_state = False
_auto_off_timer: threading.Timer | None = None


def _do_auto_off():
    global _led_state
    GPIO.output(LED_PIN, False)
    _led_state = False


@app.route("/led/on", methods=["POST"])
def led_on():
    global _led_state, _auto_off_timer
    if _auto_off_timer:
        _auto_off_timer.cancel()
    GPIO.output(LED_PIN, True)
    _led_state = True
    _auto_off_timer = threading.Timer(AUTO_OFF_SECONDS, _do_auto_off)
    _auto_off_timer.start()
    return jsonify({"status": "on", "auto_off_in": AUTO_OFF_SECONDS})


@app.route("/led/off", methods=["POST"])
def led_off():
    global _led_state, _auto_off_timer
    if _auto_off_timer:
        _auto_off_timer.cancel()
        _auto_off_timer = None
    GPIO.output(LED_PIN, False)
    _led_state = False
    return jsonify({"status": "off"})


@app.route("/led/status", methods=["GET"])
def led_status():
    return jsonify({"led": "on" if _led_state else "off"})


if __name__ == "__main__":
    try:
        app.run(host="0.0.0.0", port=5000, debug=False)
    finally:
        GPIO.cleanup()
