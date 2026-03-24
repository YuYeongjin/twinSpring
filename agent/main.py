"""
AI Agent 진입점

터미널에서 대화형으로 실행하거나, 외부에서 graph를 import해서 사용합니다.

사용법:
    python main.py
"""

from langchain_core.messages import HumanMessage
from graph import graph


def run_agent(user_input: str, history: list | None = None) -> str:
    """
    단일 메시지를 처리하고 AI 응답 문자열을 반환합니다.

    Args:
        user_input: 사용자 입력 문자열
        history: 이전 대화 메시지 리스트 (LangChain Message 객체)

    Returns:
        AI 응답 문자열
    """
    messages = (history or []) + [HumanMessage(content=user_input)]
    state = graph.invoke({"messages": messages, "intent": None, "query_result": None, "context": None})
    return state["messages"][-1].content


def main():
    print("=" * 60)
    print("  스마트 빌딩 디지털 트윈 AI Agent")
    print("  종료하려면 'quit' 또는 'exit'를 입력하세요.")
    print("=" * 60)

    history = []

    while True:
        try:
            user_input = input("\n사용자: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n종료합니다.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "종료"):
            print("종료합니다.")
            break

        try:
            response = run_agent(user_input, history)
            print(f"\nAgent: {response}")
            # 대화 히스토리 유지
            history.append(HumanMessage(content=user_input))
            from langchain_core.messages import AIMessage
            history.append(AIMessage(content=response))
        except Exception as e:
            print(f"\n[오류] {e}")


if __name__ == "__main__":
    main()
