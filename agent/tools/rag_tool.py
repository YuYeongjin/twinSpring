import os
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from config import CHROMA_PERSIST_DIR, CHROMA_COLLECTION, EMBEDDING_MODEL


def get_embeddings():
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def get_vectorstore() -> Chroma:
    return Chroma(
        collection_name=CHROMA_COLLECTION,
        embedding_function=get_embeddings(),
        persist_directory=CHROMA_PERSIST_DIR,
    )


def add_documents(texts: list[str], metadatas: list[dict] | None = None):
    """문서를 벡터스토어에 추가"""
    docs = [
        Document(page_content=t, metadata=m or {})
        for t, m in zip(texts, metadatas or [{}] * len(texts))
    ]
    vs = get_vectorstore()
    vs.add_documents(docs)


def search(query: str, k: int = 4) -> list[Document]:
    """유사 문서 검색"""
    vs = get_vectorstore()
    return vs.similarity_search(query, k=k)


def search_as_text(query: str, k: int = 4) -> str:
    """검색 결과를 텍스트로 반환"""
    docs = search(query, k=k)
    if not docs:
        return "관련 문서를 찾을 수 없습니다."
    return "\n\n---\n\n".join(
        f"[출처: {doc.metadata.get('source', '알 수 없음')}]\n{doc.page_content}"
        for doc in docs
    )
