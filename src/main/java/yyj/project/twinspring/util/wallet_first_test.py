import os, re, joblib, math
from typing import Dict, Any, List, Tuple
from datetime import datetime
from dotenv import load_dotenv

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from pydantic import BaseModel, ValidationError

from sklearn.ensemble import IsolationForest

from sqlalchemy import create_engine, text


# ───────────────── env & cfg ─────────────────
load_dotenv()
DB_URL = os.getenv("DB_URL", "mysql+pymysql://root:Abcd1234@localhost:3306/dallas_wallet_v2")
ENGINE = create_engine(DB_URL)

MODEL_PATH  = os.getenv("MODEL_PATH",  "iforest_geo.pkl")

CFG = {
    "BLOCK_CUT": float(os.getenv("BLOCK_CUT", 0.90)),
    "REVIEW_CUT": float(os.getenv("REVIEW_CUT", 0.80)),
    "IF_N_ESTIMATORS": int(os.getenv("IF_N_ESTIMATORS", 200)),
    "IF_CONTAMINATION": float(os.getenv("IF_CONTAMINATION", 0.02)),
    "IF_RANDOM_STATE": int(os.getenv("IF_RANDOM_STATE", 42)),
    "TRAIN_DAYS": int(os.getenv("TRAIN_DAYS", 30)),
}

DATE_FMT = "%Y-%m-%d_%H:%M:%S"


# ───────────────── Safe casters (tuple/list/None 방어) ─────────────────
def _safe_to_str(x) -> str:
    """문자열 연산 전: tuple/list면 첫 원소, None은 빈문자, 나머지는 str로 강제."""
    if x is None:
        return ""
    if isinstance(x, (list, tuple)):
        if not x:  # 빈 컨테이너
            return ""
        return _safe_to_str(x[0])
    return str(x)

def parse_dt(s: str) -> datetime:
    return datetime.strptime(s, DATE_FMT)
def normalize_parse_series(series: pd.Series) -> pd.Series:
    def _clean_dt(x):
        s = _safe_to_str(x).strip()      # tuple/list/None 방어
        # 마이크로초 제거
        if "." in s:
            # 끝에 .숫자들만 날림
            import re
            s = re.sub(r"\.\d+$", "", s)
        # 구분자 통일: T 또는 공백 → 언더스코어
        s1 = s.replace("T", " ").replace(" ", "_")
        # 1차: 지정 포맷 시도
        try:
            return datetime.strptime(s1, DATE_FMT)
        except Exception:
            # 2차: 폴백 파서 (언더스코어를 공백으로)
            s2 = s.replace("_", " ")
            dt = pd.to_datetime(s2, errors="coerce")
            return dt.to_pydatetime() if pd.notna(dt) else pd.NaT

    return series.apply(_clean_dt)


def _to_amount(x):
    s = _safe_to_str(x)              # tuple/list/None 방어 → 문자열
    s = s.replace(",", "").strip()   # 문자열에서만 치환
    try:
        return float(s) if s != "" else np.nan
    except Exception:
        return np.nan

def _to_coord(x):
    s = _safe_to_str(x).strip()
    try:
        return float(s) if s != "" else np.nan
    except Exception:
        return np.nan



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
  source_account_address, target_account_address, date, amount, nx, ny, device_info
FROM TBL_TRANSACTION
WHERE date >= DATE_SUB(NOW(), INTERVAL :days DAY)
  AND amount IS NOT NULL
""")

SQL_LAST_BY_SOURCE = text("""
SELECT date, nx, ny, device_info
FROM TBL_TRANSACTION
WHERE source_account_address = :src AND date < :cur
ORDER BY date DESC
LIMIT 1
""")

SQL_DEVICE_SEEN_90D = text("""
SELECT COUNT(*) AS seen
FROM TBL_TRANSACTION
WHERE source_account_address=:src AND device_info=:dev
  AND date >= DATE_SUB(:cur, INTERVAL 90 DAY)
""")

# ───────────────── feature builders ─────────────────

FEATURES = [
    "amount",
    "avgAmount",
    "avgAmountStd",
    "hour",
    "hour_sin",
    "hour_cos",
    "hour_z",
    "nx",
    "ny",
    "dist_from_home_km",
    "speed_kmh",
    "is_new_device",
]

def build_training_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[str]]:
    """
    데이터 전처리과정 
    기간 30일, 이상 거래 감지 세기 2%
    """
    if df.empty:
        return pd.DataFrame(), []

    # 금액
    df["amount"] = df["amount"].apply(_to_amount)

    # 평균 금액의 표준편차
    totalAmount  = df.groupby("source_account_address")["amount"].transform('mean')
    df["avgAmount"] = df["amount"]/totalAmount

    userStdAmount = df.groupby('source_account_address')['amount'].transform('std')
    df['avgAmountStd'] = (df['amount'] - totalAmount) / userStdAmount.replace(0, 1)

    # 위도, 경도
    df["nx"] = df["nx"].apply(_to_coord)
    df["ny"] = df["ny"].apply(_to_coord)

    # 날짜/시간
    df["date"] = normalize_parse_series(df["date"])
    df = df[df["date"].notna()].copy()
    df = df.sort_values(["source_account_address", "date"]).copy()

    # 정수 hour (0~23)
    df["hour"] = df["date"].dt.hour

    # 원형 인코딩: hour → (sin, cos)
    # rad = 2π * hour/24
    TWO_PI = 2 * math.pi
    df["hour_rad"] = df["hour"] * (TWO_PI / 24.0)
    df["hour_sin"] = np.sin(df["hour_rad"])
    df["hour_cos"] = np.cos(df["hour_rad"])

    # per-user 원형 평균(μ): μ = atan2(mean_sin, mean_cos)
    # per-user 결과 길이 R = sqrt(mean_sin^2 + mean_cos^2)
    # 원형 표준편차 σ_circ ≈ sqrt(-2 * ln(R))  (R∈(0,1], R=1이면 분산 0)
    grp = df.groupby("source_account_address", group_keys=False)

    mean_sin = grp["hour_sin"].transform("mean")
    mean_cos = grp["hour_cos"].transform("mean")
    R = np.sqrt(mean_sin**2 + mean_cos**2).clip(1e-12, 1.0)  # 안전 clip

    mu = np.arctan2(mean_sin, mean_cos)  # 개인 원형평균(라디안)
    # 각 샘플과 개인 평균의 최소 각도차(원형 거리) Δθ ∈ [-π, π]
    ang = df["hour_rad"]
    diff = (ang - mu + math.pi) % (TWO_PI) - math.pi  # wrap to [-π, π]

    circ_std = np.sqrt(-2.0 * np.log(R))  # 원형 표준편차
    df["hour_z"] = diff / (circ_std + 1e-6)  # 0 분모 방지

    ##

    # 개인별(home) 평균 위치
    home = df.groupby("source_account_address")[["nx", "ny"]].mean().rename(
        columns={"nx": "home_lat", "ny": "home_lon"}
    )
    df = df.merge(home, on="source_account_address", how="left")

    # 직전 트랜잭션(동일 source) 정보
    df["prev_dt"]  = df.groupby("source_account_address")["date"].shift(1)
    df["prev_lat"] = df.groupby("source_account_address")["nx"].shift(1)
    df["prev_lon"] = df.groupby("source_account_address")["ny"].shift(1)
    df["prev_dev"] = df.groupby("source_account_address")["device_info"].shift(1)

    # 거리/속도
    df["dist_from_home_km"] = df.apply(
        lambda r: haversine_km(r["nx"], r["ny"], r["home_lat"], r["home_lon"]), axis=1
    )
    df["dist_from_last_km"] = df.apply(
        lambda r: haversine_km(r["nx"], r["ny"], r["prev_lat"], r["prev_lon"]), axis=1
    )
    def _speed(r):
        if pd.isna(r["prev_dt"]) or pd.isna(r["dist_from_last_km"]):
            return np.nan
        dt_h = (r["date"] - r["prev_dt"]).total_seconds()/3600.0
        return r["dist_from_last_km"]/dt_h if dt_h > 0 else np.nan
    df["speed_kmh"] = df.apply(_speed, axis=1)

    # 새로운 기기 여부(직전과 다른 기기면 1, 같으면 0)
    df["is_new_device"] = np.where(
        (df["device_info"].notna()) & (df["prev_dev"].notna()) & (df["device_info"] != df["prev_dev"]), 1.0, 0.0
    )

    feats = df[[
        "amount", "avgAmount","avgAmountStd","hour","hour_sin","hour_cos","hour_z", "nx", "ny",
        "dist_from_home_km", "speed_kmh", "is_new_device"
    ]].copy()

    feats = feats.replace([np.inf, -np.inf], np.nan)
    feature_names = list(feats.columns)
    print("@@@@@@@@@@@@@@@@")
    print(feats)
    print("@@@@@@@@@@@@@@@@")
    print(feature_names)
    print("@@@@@@@@@@@@@@@@")

    return feats, feature_names

def build_infer_features(payload: dict) -> Dict[str, Any]:
    #단건 추론용 피처 구성
    src = payload.get("source_account_address")

    raw_dt = payload.get("date")
    cur_dt = parse_dt(raw_dt) if isinstance(raw_dt, str) else raw_dt
    if not isinstance(cur_dt, datetime):
        raise ValueError("date must be a string or datetime")

    # 기본 수치
    amt = payload.get("amount")
    amt = float(str(amt).replace(",", "")) if amt is not None else np.nan

    hour = cur_dt.hour
    lat = payload.get("nx")
    lon = payload.get("ny")
    lat = float(lat) if lat is not None else np.nan
    lon = float(lon) if lon is not None else np.nan

    # home(개인 평균 위치) 계산용: 최근 30일 평균
    with ENGINE.connect() as conn:
        home_sql = text("""
          SELECT AVG(nx) AS home_lat, AVG(ny) AS home_lon
          FROM TBL_TRANSACTION
          WHERE source_account_address=:src AND date >= DATE_SUB(:cur, INTERVAL 30 DAY)
        """)
        home = conn.execute(home_sql, {"src": src, "cur": cur_dt}).mappings().first() if src else None

        last = conn.execute(SQL_LAST_BY_SOURCE, {"src": src, "cur": cur_dt}).mappings().first() if src else None

        is_new_device = 0.0
        if payload.get("device_info"):
            seen = conn.execute(SQL_DEVICE_SEEN_90D, {
                "src": src, "dev": payload["device_info"], "cur": cur_dt
            }).mappings().first()
            # 90일 내 first-seen이면 1
            is_new_device = 0.0 if (seen and int(seen["seen"]) > 0) else 1.0

    home_lat = float(home["home_lat"]) if (home and home["home_lat"] is not None) else None
    home_lon = float(home["home_lon"]) if (home and home["home_lon"] is not None) else None
    dist_home = haversine_km(lat, lon, home_lat, home_lon) if (home_lat is not None and home_lon is not None) else np.nan

    if last:
        last_dt  = parse_dt(last.get("date"))
        last_lat = _to_coord(last.get("nx"))
        last_lon = _to_coord(last.get("ny"))
        dist_last = haversine_km(lat, lon, last_lat, last_lon)
        if isinstance(last_dt, datetime):
            dt_h = (cur_dt - last_dt).total_seconds() / 3600.0
            speed = (dist_last / dt_h) if (dt_h and dt_h > 0) else np.nan
        else:
            speed = np.nan
    else:
        dist_last, speed = np.nan, np.nan


    return {
        "amount": amt,
        "hour": hour,
        "nx": lat,
        "ny": lon,
        "dist_from_home_km": dist_home,
        "speed_kmh": speed,
        "is_new_device": float(is_new_device),
        "debug": {
            "home_lat": home_lat, "home_lon": home_lon,
            "last": dict(last) if last else None
        }
    }

def impute_with_median(vec: np.ndarray, feature_names: List[str], nan_fill: Dict[str, float]) -> np.ndarray:
    """NaN → 학습 시 저장한 중앙값(없으면 0.0)"""
    v = vec.copy()
    for i, k in enumerate(feature_names):
        if np.isnan(v[0, i]):
            fill = nan_fill.get(k)
            v[0, i] = fill if (fill is not None and not np.isnan(fill)) else 0.0
    return v
# ───────────────── Flask ─────────────────
app = Flask(__name__)

class TxReq(BaseModel):
    date: str
    amount: float | str
    source_account_address: str | None = None
    target_account_address: str | None = None
    nx: float | None = None
    ny: float | None = None
    device_info: str | None = None

@app.route("/train", methods=["POST"])
def train():
    try:
        body = request.get_json(force=True) or {}
        days = int(body.get("days", 30))
        contamination = float(body.get("contamination", 0.02))

        with ENGINE.connect() as conn:
            rows = conn.execute(SQL_TRAIN, {"days": days}).mappings().all()
        if not rows:
            return jsonify({"ok": False, "msg": "학습 데이터가 없습니다."}), 400

        df = pd.DataFrame(rows)
        # 자료 생성
        feats, feature_names = build_training_features(df)

        X = feats.values.astype(float)

        model = IsolationForest(
            n_estimators=200,
            contamination=contamination,
            random_state=42
        ).fit(X)

        joblib.dump({"model": model, "feature_names": feature_names}, MODEL_PATH)

        return jsonify({"ok": True, "n_samples": len(X), "feature_names": feature_names, "contamination": contamination})

    except Exception as e:
        tb = traceback.format_exc()

        return jsonify({
            "ok": False,
            "msg": f"/train error at step='{step}': {e.__class__.__name__}: {e}",
            "trace_snippet": tb.splitlines()[-5:]  # 마지막 5줄 첨부
        }), 500

def _load_model():
    if not os.path.exists(MODEL_PATH):
        return None, None, None
    bundle = joblib.load(MODEL_PATH)
    return bundle["model"], bundle["feature_names"], bundle.get("nan_fill", {})

@app.route("/agent", methods=["POST"])
def agent():
    try:
        model, feat_names, nan_fill = _load_model()
        if model is None:
            return jsonify({
                "decision": "review", "risk_score": 0.6,
                "rule_hits": ["ML model not trained"],
                "reasons": ["모델이 아직 학습되지 않았습니다. /train 호출 후 사용하세요."],
                "evidence": {}
            }), 400

        payload = request.get_json(force=True) or {}
        # 요청 형식 검증(필수 필드 체크)
        TxReq(**payload)

        feats = build_infer_features(payload)
        vec = np.array([[feats[k] for k in feat_names]], dtype=float)

        # NaN → 중앙값 대체 (스케일링 없음)
        vec_imp = impute_with_median(vec, feat_names, nan_fill)

        df_score = float(model.decision_function(vec_imp)[0])  # 값이 낮을수록 이상
        is_anom  = df_score < 0.0
        risk_est = max(0.0, min(1.0, -df_score))               # 간단 맵핑

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
    except ValidationError as ve:
        return jsonify({
            "decision": "review", "risk_score": 0.5,
            "rule_hits": ["BadRequest"],
            "reasons": [f"요청 필드 오류: {ve}"],
            "evidence": {}
        }), 400
    except Exception as e:
        return jsonify({
            "decision": "review", "risk_score": 0.6,
            "rule_hits": [], "reasons": [f"시스템 오류: {str(e)}"], "evidence": {}
        }), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005)
