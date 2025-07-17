import pymysql
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib

# 1. MySQL에서 데이터 가져오기
conn = pymysql.connect(host='localhost', user='root', password='Abcd1234', database='digital_twin')
df = pd.read_sql("SELECT temperature  FROM sensor_data", conn)
conn.close()

# 2. 모델 학습
# n => 트리의 개수 , contamination => 이상치의 기준
# random_state => 검증의 무작위값으로 임의의 값이나 고정 필수
model = IsolationForest(n_estimators=20, contamination=0.2, random_state=1)
model.fit(df)

# 3. 모델 저장
joblib.dump(model, "model.pkl")
print("Create Model Complete (model.pkl)")
