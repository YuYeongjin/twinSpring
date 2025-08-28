import os, re, joblib, math
from typing import Dict, Any, List, Tuple
from datetime import datetime
from dotenv import load_dotenv

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from pydantic import BaseModel

from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest

from sqlalchemy import create_engine, text

# ───────────────── env & cfg ─────────────────
load_dotenv()
DB_URL = os.getenv("DB_URL", "mysql+pymysql://root:Abcd1234@localhost:3306/dallas_wallet_v2")
ENGINE = create_engine(DB_URL)

MODEL_PATH  = os.getenv("MODEL_PATH",  "iforest_geo.pkl")
SCALER_PATH = os.getenv("SCALER_PATH", "scaler_geo.pkl")

CFG = {
    "BLOCK_CUT": float(os.getenv("BLOCK_CUT", 0.85)),
    "REVIEW_CUT": float(os.getenv("REVIEW_CUT", 0.60)),
    "IF_N_ESTIMATORS": int(os.getenv("IF_N_ESTIMATORS", 200)),
    "IF_CONTAMINATION": float(os.getenv("IF_CONTAMINATION", 0.02)),
    "IF_RANDOM_STATE": int(os.getenv("IF_RANDOM_STATE", 42)),
    "TRAIN_DAYS": int(os.getenv("TRAIN_DAYS", 30)),
}

DATE_FMT = "%Y-%m-%d_%H:%M:%S"

def parse_dt(s: str) -> datetime:
    return datetime.strptime(s, DATE_FMT)

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if None in (lat1, lon1, lat2, lon2):
        return np.nan
    # 위/경도 없으면 NaN
    if any(pd.isna([lat1, lon1, lat2, lon2])):
        return np.nan
    R = 6371.0088
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(a))

# ───────────────── SQL ─────────────────
SQL_TRAIN = text("""
SELECT
  source_account_address, target_account_address, date, amount, latitude, longitude, device_id
FROM TBL_TRANSACTION
WHERE date_dt >= DATE_SUB(NOW(), INTERVAL :days DAY)
  AND amount IS NOT NULL
""")

SQL_LAST_BY_SOURCE = text("""
SELECT date, latitude, longitude, device_id
FROM TBL_TRANSACTION
WHERE source_name = :src AND date_dt < :cur
ORDER BY date_dt DESC
LIMIT 1
""")

SQL_DEVICE_SEEN_90D = text("""
SELECT COUNT(*) AS seen
FROM TBL_TRANSACTION
WHERE source_account_address=:src AND device_id=:dev
  AND date >= DATE_SUB(:cur, INTERVAL 90 DAY)
""")

# ───────────────── feature builders ─────────────────
def build_training_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """
    입력: 최근 30일 원시 DF
    출력: 피처 DF, feature_names
    amount_num, hour, latitude, longitude,
    개인(home) 기준 거리, 직전 대비 속도, 신기기 여부(학습 시엔 0/1 가정: 직전과 다른 기기면 1)
    """
    if df.empty:
        return pd.DataFrame(), []

    # 시간/기본 피처
    df = df.sort_values(["source_account_address", "date_dt"]).copy()
    df["hour"] = df["date_dt"].dt.hour

    # 개인별(home) 평균 위치
    home = df.groupby("source_account_address")[["latitude", "longitude"]].mean().rename(
        columns={"latitude": "home_lat", "longitude": "home_lon"}
    )
    df = df.merge(home, on="source_account_address", how="left")

    # 직전 트랜잭션(동일 source) 정보
    df["prev_dt"]  = df.groupby("source_account_address")["date"].shift(1)
    df["prev_lat"] = df.groupby("source_account_address")["latitude"].shift(1)
    df["prev_lon"] = df.groupby("source_account_address")["longitude"].shift(1)
    df["prev_dev"] = df.groupby("source_account_address")["device_id"].shift(1)

    # 거리/속도
    df["dist_from_home_km"] = df.apply(
        lambda r: haversine_km(r["latitude"], r["longitude"], r["home_lat"], r["home_lon"]), axis=1
    )
    df["dist_from_last_km"] = df.apply(
        lambda r: haversine_km(r["latitude"], r["longitude"], r["prev_lat"], r["prev_lon"]), axis=1
    )
    def _speed(r):
        if pd.isna(r["prev_dt"]) or pd.isna(r["dist_from_last_km"]):
            return np.nan
        dt_h = (r["date_dt"] - r["prev_dt"]).total_seconds()/3600.0
        return r["dist_from_last_km"]/dt_h if dt_h > 0 else np.nan
    df["speed_kmh"] = df.apply(_speed, axis=1)

    # 신기기 여부(학습 시엔 직전과 다른 dev면 1, 같으면 0; None은 0 처리)
    df["is_new_device"] = np.where(
        (df["device_id"].notna()) & (df["prev_dev"].notna()) & (df["device_id"] != df["prev_dev"]), 1.0, 0.0
    )

    feats = df[[
        "amount", "hour", "latitude", "longitude",
        "dist_from_home_km", "speed_kmh", "is_new_device"
    ]].copy()

    feats = feats.replace([np.inf, -np.inf], np.nan).dropna()
    feature_names = list(feats.columns)
    return feats, feature_names

def build_infer_features(payload: dict) -> Dict[str, Any]:
    #단건 추론용 피처 구성
    src = payload.get("source_account_address")
    cur_dt = parse_dt(payload["date"]) if "date" not in payload else payload["date"]

    # 기본 수치
    amt = float(str(payload.get("amount", payload.get("amount"))).replace(",", ""))
    hour = cur_dt.hour
    lat = payload.get("latitude"); lon = payload.get("longitude")
    lat = float(lat) if lat is not None else np.nan
    lon = float(lon) if lon is not None else np.nan

    # home(개인 평균 위치) 계산용: 최근 30일 평균
    with ENGINE.connect() as conn:
        home_sql = text("""
          SELECT AVG(latitude) AS home_lat, AVG(longitude) AS home_lon
          FROM TBL_TRANSACTION
          WHERE source_account_address=:src AND date >= DATE_SUB(:cur, INTERVAL 30 DAY)
        """)
        home = conn.execute(home_sql, {"src": src, "cur": cur_dt}).mappings().first() if src else None

        last = conn.execute(SQL_LAST_BY_SOURCE, {"src": src, "cur": cur_dt}).mappings().first() if src else None

        is_new_device = 0.0
        if payload.get("device_id"):
            seen = conn.execute(SQL_DEVICE_SEEN_90D, {
                "src": src, "dev": payload["device_id"], "cur": cur_dt
            }).mappings().first()
            # 90일 내 first-seen이면 1
            is_new_device = 0.0 if (seen and int(seen["seen"]) > 0) else 1.0

    home_lat = home and home["home_lat"]
    home_lon = home and home["home_lon"]
    dist_home = haversine_km(lat, lon, home_lat, home_lon) if (home_lat and home_lon) else np.nan

    if last:
        dist_last = haversine_km(lat, lon, float(last["latitude"] or 0), float(last["longitude"] or 0))
        dt_h = (cur_dt - last["date"]).total_seconds()/3600.0 if last["date"] else np.nan
        speed = (dist_last/dt_h) if (dt_h and dt_h > 0) else np.nan
    else:
        dist_last, speed = np.nan, np.nan

    return {
        "amount": amt,
        "hour": hour,
        "latitude": lat,
        "longitude": lon,
        "dist_from_home_km": dist_home,
        "speed_kmh": speed,
        "is_new_device": float(is_new_device),
        "debug": {
            "home_lat": home_lat, "home_lon": home_lon,
            "last": last
        }
    }

# ───────────────── Flask ─────────────────
app = Flask(__name__)

class TxReq(BaseModel):
    date: str
    amount: float | str
    source_name: str | None = None
    target_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    device_id: str | None = None

@app.route("/train", methods=["POST"])
def train():
    body = request.get_json(force=True) or {}
    days = int(body.get("days", CFG["TRAIN_DAYS"]))
    contamination = float(body.get("contamination", CFG["IF_CONTAMINATION"]))

    with ENGINE.connect() as conn:
        rows = conn.execute(SQL_TRAIN, {"days": days}).mappings().all()
    if not rows:
        return jsonify({"ok": False, "msg": "학습 데이터가 없습니다."}), 400

    df = pd.DataFrame(rows)
    # 필수: datetime 변환
    df["date"] = pd.to_datetime(df["date"])
    feats, feature_names = build_training_features(df)
    if feats.empty or len(feats) < 50:
        return jsonify({"ok": False, "msg": f"학습 데이터 부족({len(feats)} rows)."}), 400

    scaler = StandardScaler()
    X = scaler.fit_transform(feats.values.astype(float))

    model = IsolationForest(
        n_estimators=CFG["IF_N_ESTIMATORS"],
        contamination=contamination,
        random_state=CFG["IF_RANDOM_STATE"]
    ).fit(X)

    joblib.dump({"model": model, "feature_names": feature_names}, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)

    return jsonify({"ok": True, "n_samples": len(X), "feature_names": feature_names, "contamination": contamination})

def _load_model():
    if not (os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH)):
        return None, None, None
    bundle = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    return bundle["model"], scaler, bundle["feature_names"]

@app.route("/agent", methods=["POST"])
def agent():
    try:
        model, scaler, feat_names = _load_model()
        if model is None:
            return jsonify({
                "decision": "review", "risk_score": 0.6,
                "rule_hits": ["ML model not trained"],
                "reasons": ["모델이 아직 학습되지 않았습니다. /train 호출 후 사용하세요."],
                "evidence": {}
            }), 400

        payload = request.get_json(force=True) or {}
        TxReq(**payload)  # 필수필드 검증

        # 단건 피처 구성
        feats = build_infer_features(payload)
        vec = np.array([[feats[k] for k in feat_names]], dtype=float)
        X = scaler.transform(vec)

        df_score = float(model.decision_function(X)[0])  # 높을수록 정상(대략 0 기준)
        is_anom  = df_score < 0.0
        risk_est = max(0.0, min(1.0, -df_score))         # 위험도 매핑

        if   risk_est >= CFG["BLOCK_CUT"]:  decision = "block"
        elif risk_est >= CFG["REVIEW_CUT"]: decision = "review"
        else:                                decision = "approve"

        return jsonify({
            "decision":  decision,
            "risk_score": round(risk_est, 3),
            "rule_hits": ["ML:IsolationForest"] if is_anom else [],
            "reasons":   [f"IF decision_function={df_score:.3f} (0 미만≈이상치)"],
            "evidence":  {
                "features": {k: (None if (isinstance(feats[k], float) and np.isnan(feats[k])) else feats[k]) for k in feat_names},
                "cuts": {"REVIEW_CUT": CFG["REVIEW_CUT"], "BLOCK_CUT": CFG["BLOCK_CUT"]},
                "debug": feats.get("debug")
            }
        })
    except Exception as e:
        return jsonify({
            "decision": "review", "risk_score": 0.6,
            "rule_hits": [], "reasons": [f"시스템 오류: {str(e)}"], "evidence": {}
        }), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005)
