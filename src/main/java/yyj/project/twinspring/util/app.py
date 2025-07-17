from flask import Flask, request, jsonify
import joblib
import numpy as np

app = Flask(__name__)

# 모델 로딩
model = joblib.load("model.pkl")

@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()
    temp = data.get("temperature")

    if temp is None :
        return jsonify({"error": "Invalid input"}), 400

    X = np.array([[temp]])
    result = model.predict(X)
    # 검증 이론 : contamination 값을 기준으로 정상은 1 , 비정상은 -1 로 분리
    score = model.decision_function(X) 
    
    return jsonify({
        "anomaly": bool(result[0] == -1),
        "score": float(score[0])
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
