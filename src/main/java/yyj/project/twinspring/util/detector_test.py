from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import hnswlib
import numpy as np
from sklearn.preprocessing import MinMaxScaler

app = Flask(__name__)

# 자연어 임베딩 모델 (문장 유사도 비교용)
model = SentenceTransformer('all-MiniLM-L6-v2')

@app.route('/similarity', methods=['POST'])
def detect_abnormal():
    try:
        req_data = request.json
        current_str = req_data['current']
        history_strs = req_data['history']

        # 예외 처리: 빈 히스토리 방지
        if not history_strs:
            return jsonify({"error": "입력된 이력 데이터가 없습니다."}), 400

        # ------------------------------
        # 1. 자연어 기반 비교 (cosine)
        # ------------------------------
        text_vecs = model.encode(history_strs).astype('float32')
        query_vec = model.encode([current_str]).astype('float32')

        hnsw_text = hnswlib.Index(space='cosine', dim=384)
        hnsw_text.init_index(max_elements=100, ef_construction=50, M=5)
        hnsw_text.add_items(text_vecs)
        hnsw_text.set_ef(20)

        labels_text, distances_text = hnsw_text.knn_query(query_vec, k=1)
        sim_cosine = 1 - distances_text[0][0]
        matched_text = history_strs[labels_text[0][0]]

        # ------------------------------
        # 2. 정형 벡터 기반 비교 (L2)
        # ------------------------------
        def to_structured_vec(s: str):
            try:
                location_map = {'bridgeA': 0, 'bridgeB': 1}
                parts = s.split(',')

                loc_part = parts[0].split(':')[1].strip()
                temp_part = parts[1].split(':')[1].strip().replace("도", "")
                time_part = parts[2].split('T')[1].split(':')[0]  # 시(hour)만 추출

                location = location_map.get(loc_part, 0)
                temperature = int(temp_part)
                hour = int(time_part)

                return [location, temperature, hour]
            except Exception as e:
                raise ValueError(f"정형 벡터 파싱 실패: '{s}' => {e}")

        structured_vecs = np.array([to_structured_vec(s) for s in history_strs], dtype=np.float32)
        query_struct = np.array([to_structured_vec(current_str)], dtype=np.float32)

        # 정규화
        scaler = MinMaxScaler()
        structured_vecs_scaled = scaler.fit_transform(structured_vecs)
        query_scaled = scaler.transform(query_struct)

        hnsw_struct = hnswlib.Index(space='l2', dim=3)
        hnsw_struct.init_index(max_elements=100, ef_construction=50, M=5)
        hnsw_struct.add_items(structured_vecs_scaled)
        hnsw_struct.set_ef(20)

        labels_struct, distances_struct = hnsw_struct.knn_query(query_scaled, k=1)
        sim_l2 = 1 - distances_struct[0][0]
        matched_struct = history_strs[labels_struct[0][0]]

        # ------------------------------
        # 결과 반환
        # ------------------------------
        return jsonify({
            # "text_embedding": {
            #     "similarity": float(sim_cosine),
            #     "matched": matched_text
            # },
            "result": {
                "similarity": float(sim_l2)
                # "matched": matched_struct
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)
