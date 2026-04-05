from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    intent: Literal["rag_db", "bim_builder", "chat"] | None
    query_result: str | None
    context: str | None
    bim_project_id: str | None    # 현재 선택된 BIM 프로젝트 ID
    pending_action: dict | None   # 다단계 BIM 대화에서 대기 중인 액션
