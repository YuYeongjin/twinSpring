from __future__ import annotations

from langchain_postgres.vectorstores import PGVector
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from config.settings import EMBEDDING_MODEL, get_pgvector_connection

COLLECTION_NAME = "twin_docs"

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


def add_documents(texts: list[str], metadatas: list[dict] | None = None):
    docs = [
        Document(page_content=t, metadata=m or {})
        for t, m in zip(texts, metadatas or [{}] * len(texts))
    ]
    _get_vectorstore().add_documents(docs)


def search(query: str, k: int = 4) -> list[Document]:
    return _get_vectorstore().similarity_search(query, k=k)


def search_as_text(query: str, k: int = 4) -> str:
    docs = search(query, k=k)
    if not docs:
        return "No related documents found."
    return "\n\n---\n\n".join(
        f"[Source: {doc.metadata.get('source', 'unknown')}]\n{doc.page_content}"
        for doc in docs
    )
