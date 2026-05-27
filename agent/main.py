"""
AI Agent entry point

Run interactively from the terminal, or import graph from external code.

Usage:
    python main.py
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage
from graph import graph


def run_agent(user_input: str, history: list | None = None) -> str:
    """
    Process a single message and return the AI response string.

    Args:
        user_input: User input string
        history: Previous conversation messages (LangChain Message objects)

    Returns:
        AI response string
    """
    messages = (history or []) + [HumanMessage(content=user_input)]
    state = graph.invoke({"messages": messages, "intent": None, "query_result": None, "context": None})
    return state["messages"][-1].content


def main():
    print("=" * 60)
    print("  Smart Building Digital Twin AI Agent")
    print("  Type 'quit' or 'exit' to stop.")
    print("=" * 60)

    history = []

    while True:
        try:
            user_input = input("\nUser: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "종료"):
            print("Exiting.")
            break

        try:
            response = run_agent(user_input, history)
            print(f"\nAgent: {response}")
            history.append(HumanMessage(content=user_input))
            from langchain_core.messages import AIMessage
            history.append(AIMessage(content=response))
        except Exception as e:
            print(f"\n[Error] {e}")


if __name__ == "__main__":
    main()
