"""
Responder Node — qwen2.5:3b 최종 응답 생성

tool_results + rag_context 를 받아 자연어 응답을 생성합니다.
모든 Domain Agent 의 공통 출구입니다.
"""
from __future__ import annotations

import json
import logging

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from config.state import AgentState
from config.llm_config import llm_responder
from config.lang_util import detect_lang, lang_instruction, error_msg

logger = logging.getLogger(__name__)

_BASE_SYSTEM = (
    "You are a Smart Building Digital Twin AI assistant.\n"
    "Answer concisely and helpfully based on the tool results and context provided.\n"
    "If tool results indicate an error or no data, say so clearly and suggest alternatives.\n"
)

_ORCHESTRATOR_SYSTEM = (
    "You are a Digital Twin integrated report generator.\n"
    "Generate a structured Markdown report using the collected domain data.\n"
    "Include sections for WBS, BIM, and Safety with key metrics and status.\n"
    "Use tables where appropriate. Be concise but comprehensive.\n"
)


def responder_node(state: AgentState) -> dict:
    logger.info("[NODE] ▶ responder_node 진입 — domain=%s", state.get("domain", "chat"))
    messages     = state.get("messages", [])
    tool_results = state.get("tool_results") or {}
    rag_context  = state.get("rag_context") or ""
    domain       = state.get("domain") or "chat"

    last      = messages[-1]
    user_text = last.content if hasattr(last, "content") else ""
    lang      = state.get("lang") or detect_lang(user_text)

    # 프로젝트 이름 요청 — LLM 없이 바로 반환
    if tool_results.get("need_project_name"):
        return {
            "messages": [AIMessage(content="프로젝트 이름을 뭐로 할까요?")],
            "intent": domain,
        }

    # 도메인별 시스템 프롬프트
    base = _ORCHESTRATOR_SYSTEM if domain == "orchestrator" else _BASE_SYSTEM
    note = lang_instruction(lang)
    system_content = base + (f"\n{note}" if note else "")

    # 컨텍스트 조립
    ctx_parts: list[str] = []
    if tool_results:
        try:
            ctx_parts.append(
                "Tool Results:\n"
                + json.dumps(tool_results, ensure_ascii=False, indent=2)
            )
        except Exception:
            ctx_parts.append(f"Tool Results: {tool_results}")
    if rag_context:
        ctx_parts.append(f"Reference Documents (KCS/KDS):\n{rag_context}")

    if ctx_parts:
        system_content += "\n\n" + "\n\n".join(ctx_parts)

    # 메시지 구성 (시스템 + 이전 대화 + 현재 질문)
    final_messages: list = [SystemMessage(content=system_content)]
    for m in messages[:-1]:
        final_messages.append(m)
    final_messages.append(HumanMessage(content=user_text))

    try:
        response = llm_responder.invoke(final_messages)
        content  = response.content.strip()
    except Exception:
        logger.error("[responder] LLM 응답 실패", exc_info=True)
        content = error_msg(lang)

    # None 반환 시 기존 state 값을 덮어쓰지 않도록 값이 있을 때만 포함
    out: dict = {
        "messages": [AIMessage(content=content)],
        "intent":   domain,
    }
    for key in ("bim_data", "sensor_data", "report_data", "wbs_data", "safe_data"):
        val = tool_results.get(key)
        if val is not None:
            out[key] = val

    return out
