from typing import TypedDict, Optional
from langgraph.graph import StateGraph
from datetime import datetime, timezone, timedelta
from flask import Flask, request, jsonify
from langchain_community.chat_models import ChatOllama
from langchain_community.utilities import SQLDatabase
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
import re, traceback, json  # ← json 추가

app = Flask(__name__)

# State 정의
class GraphState(TypedDict):
    input: str                # 사용자 프롬프트/질문
    data: dict                # 센서 데이터
    retrieved: Optional[str]  # DB/LLM 중간 결과
    response: Optional[str]   # 최종 응답

# 시간
KST = timezone(timedelta(hours=9))
def print_now(label):
    now = datetime.now(KST)
    print(f"[{label}] {now.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}")
    return now

# DB & LLM
db = SQLDatabase.from_uri("mysql+pymysql://root:Abcd1234@localhost:3306/digital_twin")
llm = ChatOllama(
    # model="llama3.1:8b",
    model="gemma:2b",
    temperature=0,
    base_url="http://127.0.0.1:11434"
)

SQL_ONLY_PROMPT = PromptTemplate.from_template("""
데이터베이스에서 해당 위치의 평균 온도와 비교할거야.
데이터베이스에서 해당 위치의 평균 온도 및 습도를 조회해.
{query}
""".strip())
sql_gen_chain = LLMChain(llm=llm, prompt=SQL_ONLY_PROMPT)

# 유틸
def strip_markdown_sql(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"```sql\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"```", "", s)
    s = s.replace("**", "")
    return s.strip().rstrip(";")

def to_text(x):
    if x is None:
        return ""
    if isinstance(x, (dict, list)):
        try:
            return json.dumps(x, ensure_ascii=False)
        except Exception:
            return str(x)
    return str(x)

def build_query_text(data: dict, user_input: str) -> str:
    if not isinstance(data, dict):
        data = {"raw": to_text(data)}
    parts = []
    for k in ("location", "temperature", "humidity", "time"):
        if k in data:
            parts.append(f"{k}={data[k]}")
    data_line = ", ".join(parts) if parts else to_text(data)
    ui = to_text(user_input)
    return f"센서데이터: {data_line}\n요청: {ui}".strip()


def retrieve_from_db(state: GraphState) -> GraphState:
    print_now("시작 retrieve")
    # Dick Data , Prompt 결합한 Query
    query_text = build_query_text(state["data"], state["input"])

    retrieved = sql_gen_chain.invoke({"query": query_text})
    text = retrieved.get("text", to_text(retrieved))

    print("@@@@@@@@@ RETRIEVED @@@@@@@@@")
    print(text)
    print("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@")

    return {"input": state["input"], "data": state["data"], "retrieved": text}

# 노드 2) 일반 LLM 경로
def run_llm(state: GraphState) -> GraphState:
    llm_input = to_text(state["input"])
    llm_result = llm.invoke(llm_input)
    print_now("종료 llm")
    return {"input": llm_input, "retrieved": state.get("retrieved"), "response": llm_result.content}

# 노드 3) DB 검색 결과를 기반으로 최종 판단
def return_retrieved(state: GraphState) -> GraphState:
    prompt = (
        f'DB/LLM에서 얻은 정보:\n"{to_text(state.get("retrieved"))}"\n\n'
        f'센서 데이터: "{to_text(state.get("data"))}"\n'
        f"이상이 있는지 한국어로 간결히 판단해"
    )
    result = llm.invoke(prompt)
    print_now("종료 retrieve->final")
    return {"response": result.content}

def should_use_retrieved(state: GraphState) -> str:
    return "use_retrieved" if state.get("retrieved") else "use_llm"

# 그래프 구성
builder = StateGraph(GraphState)
builder.add_node("retrieve", retrieve_from_db)
builder.add_node("use_llm", run_llm)
builder.add_node("use_retrieved", return_retrieved)
builder.set_entry_point("retrieve")
builder.add_conditional_edges("retrieve", should_use_retrieved, {
    "use_llm": "use_llm",
    "use_retrieved": "use_retrieved",
})
builder.set_finish_point("use_llm")
builder.set_finish_point("use_retrieved")
graph = builder.compile()

# API
@app.route("/agent", methods=["POST"])
def agent():
    try:
        payload = request.get_json(silent=True) or {}

        raw_data = payload.get("data") or {}
        if not isinstance(raw_data, dict):
            try:
                raw_data = json.loads(raw_data)
            except Exception:
                raw_data = {"raw": to_text(raw_data)}

        user_input = payload.get("prompt")
        if user_input is None:
            user_input = payload.get("query")

        state: GraphState = {
            "input": to_text(user_input),
            "data": raw_data
        }

        result = graph.invoke(state)
        print("[Graph 결과] : ", result)

        # 대표 키 우선 반환
        if isinstance(result, dict):
            for k in ("response", "final", "output", "answer"):
                if result.get(k):
                    return jsonify({"response": result[k]})
            return jsonify({"response": to_text(result)})

        return jsonify({"response": to_text(result)})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005)
