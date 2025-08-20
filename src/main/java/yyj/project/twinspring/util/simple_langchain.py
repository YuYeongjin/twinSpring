from typing import TypedDict, Optional
from langgraph.graph import StateGraph
from datetime import datetime, timezone, timedelta
from flask import Flask, request, jsonify
from langchain_community.chat_models import ChatOllama
import re, traceback, json  # json 사용

app = Flask(__name__)

# State 정의
class GraphState(TypedDict, total=False):
    input: str                 # 사용자 프롬프트/질문
    sensor_data: dict          # 센서 데이터
    avg_data: dict             # DB 평균 데이터
    retrieved: Optional[str]   # (미사용) 호환용
    response: Optional[str]    # 최종 응답(JSON 문자열)

# 시간
KST = timezone(timedelta(hours=9))
def print_now(label):
    now = datetime.now(KST)
    print(f"[{label}] {now.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}")
    return now

llm = ChatOllama(
    model="gemma:2b",          # 필요 시 llama3.1:8b 등으로 교체
    temperature=0,
    base_url="http://127.0.0.1:11434"
)

def to_text(x):
    if x is None:
        return ""
    if isinstance(x, (dict, list)):
        try:
            return json.dumps(x, ensure_ascii=False)
        except Exception:
            return str(x)
    return str(x)

# --- JSON 안전 파서: LLM이 코드펜스(```)를 붙여도 파싱되도록 보정 ---
def try_parse_json(s: str):
    if not s:
        return None
    # 코드펜스 제거
    s = re.sub(r"```(?:json)?", "", s, flags=re.IGNORECASE).replace("```", "").strip()
    # 첫 번째 { ... } 블록 추출
    m = re.search(r"\{.*\}", s, flags=re.DOTALL)
    if m:
        block = m.group(0)
        try:
            return json.loads(block)
        except Exception:
            pass
    # 마지막 시도: 전체를 JSON으로 가정
    try:
        return json.loads(s)
    except Exception:
        return None

# --- LLM용 프롬프트 생성: 평균 vs 실측 비교를 LLM에게 맡김 ---
def make_llm_prompt(sensor: dict, avg: dict, user_input: str) -> str:
    # LLM이 일관되게 JSON만 반환하도록 강하게 지시
    return f"""
당신은 센서 데이터의 이상 여부를 간단히 판정하는 도우미입니다.
다음 정보를 바탕으로 한국어로 알려줘.

[센서 데이터]
{json.dumps(sensor, ensure_ascii=False)}

[평균 데이터]
{json.dumps(avg, ensure_ascii=False)}

[사용자 요청]
{to_text(user_input)}

""".strip()

# 노드 1) 일반 LLM 경로(프롬프트에 sensor_data/avg_data 투입)
def run_llm(state: GraphState) -> GraphState:
    sensor = state.get("sensor_data") or {}
    avg    = state.get("avg_data") or {}
    user_input = state.get("input") or ""
    print_now("시작 llm @@")
    prompt = make_llm_prompt(sensor, avg, user_input)
    res = llm.invoke(prompt)
    print_now("종료 llm @@")

    txt = res.content if hasattr(res, "content") else str(res)
    parsed = try_parse_json(txt)

    # response에는 JSON 문자열을 넣어 API에서 그대로 전달
    if parsed is not None:
        return {"response": json.dumps(parsed, ensure_ascii=False)}
    else:
        # 파싱 실패 시 원문 반환
        return {"response": txt.strip()}

# 그래프 구성
builder = StateGraph(GraphState)
builder.add_node("use_llm", run_llm)
builder.set_entry_point("use_llm")
builder.set_finish_point("use_llm")
graph = builder.compile()

# API
@app.route("/agent", methods=["POST"])
def agent():
    try:
        payload = request.get_json(silent=True) or {}

        sensor = payload.get("sensor_data") or {}
        if not isinstance(sensor, dict):
            try:
                sensor = json.loads(sensor)
            except Exception:
                sensor = {"raw": to_text(sensor)}

        avg = payload.get("avg_data") or {}
        if not isinstance(avg, dict):
            try:
                avg = json.loads(avg)
            except Exception:
                avg = {"raw": to_text(avg)}

        user_input = payload.get("prompt") or payload.get("query") or ""

        state: GraphState = {
            "input": to_text(user_input),
            "sensor_data": sensor,
            "avg_data": avg
        }

        result = graph.invoke(state)
        print("[Graph 결과] : ", result)

        if isinstance(result, dict) and result.get("response"):
            # 이미 JSON 문자열로 만들어둔 response를 그대로 전달
            resp_str = result["response"]
            # 가능하면 한 번 더 파싱해서 객체로 반환(클라이언트 편의)
            parsed = try_parse_json(resp_str)
            if parsed is not None:
                return jsonify(parsed)
            return jsonify({"response": resp_str})

        return jsonify({"response": to_text(result)})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005)
