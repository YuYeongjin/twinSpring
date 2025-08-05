from flask import Flask, request, jsonify
import os
import openai
import numpy as np

from langchain_openai import ChatOpenAI


app = Flask(__name__)

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    prompt = data.get("prompt")
    api_key = data.get("api_key")

    if not prompt or not api_key:
        return jsonify({"error": "Missing 'prompt' or 'api_key' in request"}), 400

    # 환경 변수로 설정 (langchain_openai 사용을 위해)
    os.environ["OPENAI_API_KEY"] = api_key
    openai.api_key = api_key

    try:
        # ① langchain 사용
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=1)
        langchain_response = llm.invoke(prompt)
        langchain_text = langchain_response.content

        return jsonify({
            "response": langchain_text
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5001, debug=True)
