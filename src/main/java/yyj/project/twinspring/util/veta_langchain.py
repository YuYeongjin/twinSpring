
import os

from typing import TypedDict, Annotated, List, Optional
from langchain_core.documents import Document
from langgraph.graph.message import add_messages
from pydantic import BaseModel
from langgraph.graph import StateGraph

from flask import Flask, request, jsonify

app = Flask(__name__)
# State 정의
class GraphState(TypedDict):
    input: str               # 사용자 질문
    retrieved: Optional[str] # DB 조회 결과
    response: Optional[str]    # 응답

from sqlalchemy import create_engine
from langchain_community.utilities import SQLDatabase
# Database 연결
db = SQLDatabase.from_uri("mysql+pymysql://root:Abcd1234@localhost:3306/digital_twin")


from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4.1-nano",temperature=0)

from langchain_experimental.sql import SQLDatabaseChain

db_chain = SQLDatabaseChain.from_llm(llm, db, verbose=True,return_intermediate_steps=True)

# 1. DB에서 데이터 조회
def retrieve_from_db(state: GraphState) -> GraphState:
    query = state["input"]
    prompt = f"""
    다음 질문을 기반으로 SQL을 생성해서 기온 데이터베이스에서 조회해줘:
    "{query}"
    결과는 사람이 읽을 수 있도록 문장으로 설명해줘.
    결과가 정확하지 않거나 없다면 null로 return 해줘.
    """

    retrieved = db_chain.invoke(prompt)  # 없으면 LLM
#    print("retrieved :" ,  retrieved["intermediate_steps"])
    return {"input": state["input"], "retrieved": retrieved["intermediate_steps"][3]}

# 2. LLM
def run_llm(state: GraphState) -> GraphState:
        llm_input = state["input"]
        llm_result = llm.invoke(llm_input)
        return {"input": llm_input, "retrieved": state["retrieved"], "response": llm_result.content}


# 3. DB 검색 결과 반환
def return_retrieved(state: GraphState) -> GraphState:
    prompt = f"""
        다음 Decimal값은 해당 위치에 Database의 평균값인데, 현재 온도가 30도라면 , 이 온도는 이상기온인지 확인해줘
        "{state["retrieved"]}"
        """
    result = llm.invoke(prompt)
    print("result :" ,  result.content)
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