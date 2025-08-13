from typing import TypedDict, Annotated, List, Optional
from langchain_core.documents import Document
from langgraph.graph.message import add_messages
from pydantic import BaseModel
from langgraph.graph import StateGraph
from datetime import datetime, timezone, timedelta
from flask import Flask, request, jsonify
from langchain_community.chat_models import ChatOllama

#모델이 낮아서 '''가생기는경우
import re, traceback
def strip_markdown_sql(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"```sql\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"```", "", s)
    s = s.replace("**", "")
    return s.strip().rstrip(";")

app = Flask(__name__)
# State 정의
class GraphState(TypedDict):
    input: str               # 사용자 질문
    retrieved: Optional[str] # DB 조회 결과
    response: Optional[str]    # 응답

## 현재 시간 함수
KST = timezone(timedelta(hours=9))

def print_now(label):
    now = datetime.now(KST)
    print(f"[{label}] {now.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]}")  # 밀리세컨드까지
    return now


from sqlalchemy import create_engine
from langchain_community.utilities import SQLDatabase
# Database 연결
db = SQLDatabase.from_uri("mysql+pymysql://root:Abcd1234@localhost:3306/digital_twin")


from langchain_openai import ChatOpenAI
# llm = ChatOpenAI(model="gpt-4.1-nano",temperature=0)
llm = ChatOllama(
    model="gpt-oss:20b",
    # model="llama3.1:8b",
    # model="gemma:2b",
    temperature=0,
    base_url="http://127.0.0.1:11434"
)
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
SQL_ONLY_PROMPT = PromptTemplate.from_template("""
다음 질문을 기반으로 SQL을 생성해 :
    "{query}"
    이 location의 평균 기온을 측정하는 쿼리를 생성해
    SELECT 문만 생성 (DDL/DML 금지)
    sensor_data 테이블에서 조회해
    절대로 (```),(**) 같은 코드 블록/펜스를 사용하지 말 것
    기타 설명은 필요없고 SQL만 만들어
""")

sql_gen_chain = LLMChain(llm=llm, prompt=SQL_ONLY_PROMPT)


# from langchain_experimental.sql import SQLDatabaseChain
# db_chain = SQLDatabaseChain.from_llm(llm, db, verbose=True,return_intermediate_steps=True)

# 1. DB에서 데이터 조회
def retrieve_from_db(state: GraphState) -> GraphState:
    print(print_now("시작"))
    query = state["input"]

    retrieved = sql_gen_chain.invoke(query)  # 없으면 LLM
    print("@@@@@@@@@@@@@@@@@@@@@@@@@")
    print(retrieved['text'])
    result = strip_markdown_sql(retrieved['text'])
    print("@@@@@@@@@@@@@@@@@@@@@@@@@")
    print(result)
    test = db.run(result);
    print("@@@@@@@@@@@@@@@@@@@@@@@@@")
    print( test)
    print("@@@@@@@@@@@@@@@@@@@@@@@@@" )
   # print("retrieved :" ,  retrieved["intermediate_steps"])
   #  return {"input": state["input"], "retrieved": strip_markdown_sql(retrieved["intermediate_steps"][3])}
    return {"input": state["input"], "retrieved":test}

# 2. LLM
def run_llm(state: GraphState) -> GraphState:
        llm_input = state["input"]
        llm_result = llm.invoke(llm_input)
        print(print_now("종료 llm"))
        return {"input": llm_input, "retrieved": state["retrieved"], "response": llm_result.content}


# 3. DB 검색 결과 반환
def return_retrieved(state: GraphState) -> GraphState:
    prompt = f"""
        다음 숫자값은 해당 위치에 Database의 평균값인데, 현재 온도가 30도라면 , 이 온도는 이상기온인지 확인해줘
        만약 질문이 숫자가 아닌 다른 값이 왔다면, 그 질문의 답변을 해줘.
        "{state["retrieved"]}"
        """
    result = llm.invoke(prompt)
    # print("result :" ,  result.content)
    print(print_now("종료 retrieve"))
    return {"response":result.content}

def should_use_retrieved(state: GraphState) -> str:
    if state["retrieved"]:  # DB에 유사한 결과가 있는경우
        print("use_retrieved")
        return "use_retrieved"
    else:
        print("use_llm")
        return "use_llm"

from langgraph.graph import StateGraph

builder = StateGraph(GraphState)

builder.add_node("retrieve", retrieve_from_db)
builder.add_node("use_llm", run_llm)
builder.add_node("use_retrieved", return_retrieved)

builder.set_entry_point("retrieve")
builder.add_conditional_edges("retrieve", should_use_retrieved, {
    "use_llm": "use_llm",
    "use_retrieved": "use_retrieved"
})
builder.set_finish_point("use_llm")
builder.set_finish_point("use_retrieved")

graph = builder.compile()



class QueryRequest(BaseModel):
    query: str


@app.route("/agent", methods=["POST"])
def agent():
    try:
        data = request.get_json()
        query = data.get("query")
        result = graph.invoke({"input": query})

        print("[Graph 결과]", result)

        # 'response' 키가 실제 결과에 존재하는지 확인 필요
        return jsonify({"response": result.get("response", "결과 없음")})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005)