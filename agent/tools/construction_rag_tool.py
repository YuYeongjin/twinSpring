"""
건설 공정서/시방서 RAG 검색 도구

PostgreSQL pgvector의 construction_specs 컬렉션에서 유사 문서를 검색하고
출처(규격코드·시리즈·제목)를 포함한 결과를 반환합니다.
"""

from __future__ import annotations

from langchain_postgres.vectorstores import PGVector
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_core.tools import tool

from config.settings import EMBEDDING_MODEL, get_pgvector_connection

COLLECTION_NAME = "construction_specs"

_embeddings: HuggingFaceEmbeddings | None = None
_vectorstore: PGVector | None = None


def _get_embeddings() -> HuggingFaceEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
    return _embeddings


def _get_vectorstore() -> PGVector:
    global _vectorstore
    if _vectorstore is None:
        _vectorstore = PGVector(
            embeddings=_get_embeddings(),
            collection_name=COLLECTION_NAME,
            connection=get_pgvector_connection(),
            use_jsonb=True,
        )
    return _vectorstore


# ── 핵심 검색 함수 ────────────────────────────────────────────────────────────

def search_construction_docs(query: str, k: int = 5) -> list[Document]:
    """
    공정서/시방서에서 query와 유사한 문서 청크를 k개 반환.
    컬렉션이 비어 있으면 빈 리스트 반환.
    """
    try:
        return _get_vectorstore().similarity_search(query, k=k)
    except Exception as e:
        print(f"[construction_rag] 검색 오류: {e}")
        return []


def format_rag_results(docs: list[Document]) -> str:
    """검색 결과를 '출처 + 본문' 형식의 문자열로 포맷."""
    if not docs:
        return "관련 공정서/시방서 문서를 찾지 못했습니다."

    parts = []
    seen_chunks: set[str] = set()

    for doc in docs:
        content = doc.page_content.strip()
        if not content or content in seen_chunks:
            continue
        seen_chunks.add(content)

        meta   = doc.metadata
        code   = meta.get("code",     "")
        title  = meta.get("title",    "")
        series = meta.get("series",   "")
        cat    = meta.get("category", "")

        source_label = f"{code} {title}".strip() if (code or title) else meta.get("source", "알 수 없음")
        series_label = f"{series} / 카테고리: {cat}" if series else cat

        parts.append(
            f"{'─' * 50}\n"
            f"[출처] {source_label}\n"
            f"[시리즈] {series_label}\n\n"
            f"{content}"
        )

    return "\n\n".join(parts) if parts else "관련 문서를 찾지 못했습니다."


def search_as_text(query: str, k: int = 5) -> str:
    """검색 결과를 포맷된 문자열로 반환 (에이전트 컨텍스트용)."""
    docs = search_construction_docs(query, k=k)
    return format_rag_results(docs)


def get_source_list() -> str:
    """현재 인덱싱된 문서의 출처 목록 반환."""
    try:
        vs = _get_vectorstore()
        # PGVector는 get()을 직접 지원하지 않으므로 더미 쿼리로 메타데이터 조회
        docs = vs.similarity_search("건설 시방서", k=200)
        seen: dict[str, str] = {}
        for doc in docs:
            m = doc.metadata
            code  = m.get("code", "")
            title = m.get("title", "")
            series = m.get("series", "")
            if code and code not in seen:
                seen[code] = f"{code} {title} ({series})"

        if not seen:
            return "인덱싱된 공정서/시방서 문서가 없습니다. build_rag_index.py를 먼저 실행하세요."

        lines = ["현재 검색 가능한 공정서/시방서 목록:\n"]
        for key in sorted(seen):
            lines.append(f"  • {seen[key]}")
        return "\n".join(lines)

    except Exception as e:
        return f"문서 목록 조회 실패: {e}"


# ── LangChain Tool 정의 ───────────────────────────────────────────────────────

@tool
def search_spec_tool(query: str) -> str:
    """
    한국 건설 공정서 및 시방서(KCS·KDS)에서 관련 내용을 검색합니다.

    입력: 검색할 공종·규격·조건 관련 질문 또는 키워드
    출력: 관련 규정 본문 + 출처(규격코드, 시리즈, 제목)
    """
    return search_as_text(query, k=5)


@tool
def list_spec_sources() -> str:
    """
    현재 RAG 시스템에 인덱싱된 공정서·시방서 목록을 반환합니다.
    어떤 문서가 검색 가능한지 확인할 때 사용합니다.
    """
    return get_source_list()


CONSTRUCTION_RAG_TOOLS = [search_spec_tool, list_spec_sources]
