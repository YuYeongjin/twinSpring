from typing import TypedDict, Annotated, List, Optional
from langchain_core.documents import Document
from langgraph.graph.message import add_messages

# State 정의
class GraphState(TypedDict):
    input: str               # 사용자 질문
    retrieved: Optional[str] # DB 조회 결과
    response: Optional[str]    # 응답

from IPython.display import Image,display
def show_graph(graph):
  try:
    display( Image(graph.get_graph().draw_mermaid_png()))

  except Exception:
    pass

# 1. DB에서 데이터 조회
def retrieve_from_db(state: GraphState) -> GraphState:
    query = state["input"]
    # DB에서 유사한 날짜/위치/온도 찾기
    # 자연어 -> Query 자동화 개발예정
    retrieved = query_db(query)  # 없으면 LLM
    return {"input": state["input"], "retrieved": retrieved}

# 2. LLM
def run_llm(state: GraphState) -> GraphState:
    llm_input = state["input"]
    llm_result = llm.invoke(llm_input)
    return {"input": llm_input, "retrieved": state["retrieved"], "response": llm_result.content}

# 3. DB 검색 결과 반환
def return_retrieved(state: GraphState) -> GraphState:
    return {"input": state["input"], "retrieved": state["retrieved"], "response": state["retrieved"]}

def should_use_retrieved(state: GraphState) -> str:
    if state["retrieved"]:  # DB에 유사한 결과가 있는경우
        return "use_retrieved"
    else:
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

# show_graph(graph)