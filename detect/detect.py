import os
import cv2
import tempfile
import requests
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

SPRING_URL = os.getenv("SPRING_URL", "http://localhost:8080")
MODEL_PATH = os.getenv("YOLO_MODEL", "yolov8n.pt")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

_model = None


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        print(f"[Detect] YOLO 모델 로딩: {MODEL_PATH}")
        _model = YOLO(MODEL_PATH)
    return _model


def run_on_image(model, path: str) -> list:
    results = model(path, verbose=False)
    dets = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls)
            dets.append({
                "class": model.names[cls_id],
                "confidence": round(float(box.conf), 3),
                "bbox": [round(v) for v in box.xyxy[0].tolist()],
            })
    return dets


def run_on_video(model, path: str, sample_every: int = 30) -> list:
    """sample_every 프레임마다 탐지, 최대 5개 샘플 수집"""
    cap = cv2.VideoCapture(path)
    dets, frame_no, samples = [], 0, 0
    while cap.isOpened() and samples < 5:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_no % sample_every == 0:
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
                cv2.imwrite(f.name, frame)
                tmp = f.name
            dets.extend(run_on_image(model, tmp))
            os.unlink(tmp)
            samples += 1
        frame_no += 1
    cap.release()
    # 동일 클래스 중복 제거
    seen, unique = set(), []
    for d in dets:
        if d["class"] not in seen:
            seen.add(d["class"])
            unique.append(d)
    return unique


@app.route("/status", methods=["GET"])
def status():
    return jsonify({"status": "ok", "model": MODEL_PATH, "spring": SPRING_URL})


@app.route("/detect", methods=["POST"])
def detect():
    if "file" not in request.files:
        return jsonify({"error": "파일이 없습니다 (form-key: file)"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "파일명이 없습니다"}), 400

    ext = Path(file.filename).suffix.lower()
    if ext not in IMAGE_EXTS | VIDEO_EXTS:
        return jsonify({"error": f"지원하지 않는 확장자: {ext}"}), 400

    is_video = ext in VIDEO_EXTS

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        model = get_model()
        detections = run_on_video(model, tmp_path) if is_video else run_on_image(model, tmp_path)

        payload = {"filename": file.filename, "detections": detections}

        try:
            resp = requests.post(f"{SPRING_URL}/api/detection", json=payload, timeout=5)
            print(f"[Detect] Spring send -> {resp.status_code}")
        except Exception as e:
            print(f"[Warn] Spring 전송 실패: {e}")

        return jsonify({
            "detections": detections,
            "count": len(detections),
            "source": "video" if is_video else "image",
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    print(f"[Detect] server start - port 5001 / Spring: {SPRING_URL}")
    app.run(host="0.0.0.0", port=5001, debug=False)
