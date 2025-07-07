from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import hnswlib
import numpy as np
import jaydebeapi

conn = jaydebeapi.connect(
    "org.h2.Driver",
    "jdbc:h2:mem:testdb",  # 또는 file 경로
    ["sa", ""],
    "h2-2.2.224.jar"  # H2 JDBC 드라이버 경로
)
cursor = conn.cursor()
cursor.execute("SELECT location, temperature, timestamp FROM sensor_data ORDER BY id DESC LIMIT 100")
rows = cursor.fetchall()
sentences = [f"{row[0]} {row[1]}도 {row[2]}" for row in rows]

# 벡터화 및 인덱싱
model = SentenceTransformer('all-MiniLM-L6-v2')
vectors = model.encode(sentences).astype('float32')

index = hnswlib.Index(space='cosine', dim=384)
index.init_index(max_elements=1000, ef_construction=100, M=16)
index.add_items(vectors)
index.set_ef(100)

# Flask 앱 구성
app = Flask(__name__)

@app.route('/similarity', methods=['POST'])
def get_similarity():
    data = request.json
    sentence = data['text']

    query_vec = model.encode([sentence]).astype('float32')
    labels, distances = index.knn_query(query_vec, k=1)
    similarity = 1 - distances[0][0]

    return jsonify({
        "similarity": float(similarity),
        "matched": sentences[labels[0][0]],
        "thresholdExceeded": similarity < 0.7
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)