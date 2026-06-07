"""
건설 공정서/시방서 RAG 인덱싱 스크립트 (PostgreSQL pgvector)

Usage:
    python scripts/build_rag_index.py

기능:
    - agent/rag/ 하위 HWP 파일 전체 파싱
    - 청크 분할 후 PostgreSQL pgvector(construction_specs 컬렉션)에 저장
    - 메타데이터: source(파일명), category(KCS/KDS 분류), code(규격코드)
"""

import sys
import os
import struct
import zlib
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import olefile
except ImportError:
    print("[ERROR] olefile 패키지가 없습니다. 설치: pip install olefile")
    sys.exit(1)

from langchain_postgres.vectorstores import PGVector
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from config.settings import EMBEDDING_MODEL, get_pgvector_connection

# ── 설정 ─────────────────────────────────────────────────────────────────────
RAG_DIR         = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rag")
COLLECTION_NAME = "construction_specs"
CHUNK_SIZE      = 800
CHUNK_OVERLAP   = 150

# ── HWP 파싱 ─────────────────────────────────────────────────────────────────

def _is_compressed(ole: olefile.OleFileIO) -> bool:
    try:
        header = ole.openstream("FileHeader").read()
        if len(header) < 36:
            return True
        attribute = struct.unpack_from("<I", header, 32)[0]
        return bool(attribute & 0x01)
    except Exception:
        return True


def _parse_records(data: bytes) -> str:
    texts = []
    offset = 0
    while offset + 4 <= len(data):
        header = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        tag_id = header & 0x3FF
        size   = (header >> 20) & 0xFFF
        if size == 0xFFF:
            if offset + 4 > len(data):
                break
            size = struct.unpack_from("<I", data, offset)[0]
            offset += 4
        record = data[offset : offset + size]
        offset += size
        if tag_id == 67 and len(record) >= 2:
            try:
                text = record.decode("utf-16le", errors="ignore")
                cleaned = "".join(
                    c if (c.isprintable() or c in "\n\r") else " "
                    for c in text
                ).strip()
                if cleaned:
                    texts.append(cleaned)
            except Exception:
                pass
    return "\n".join(texts)


def extract_hwp_text(hwp_path: str) -> str:
    try:
        with olefile.OleFileIO(hwp_path) as ole:
            compressed = _is_compressed(ole)
            all_texts  = []
            idx = 0
            while ole.exists(f"BodyText/Section{idx}"):
                raw = ole.openstream(f"BodyText/Section{idx}").read()
                if compressed:
                    try:
                        raw = zlib.decompress(raw, -15)
                    except zlib.error:
                        pass
                section_text = _parse_records(raw)
                if section_text.strip():
                    all_texts.append(section_text)
                idx += 1
            return "\n\n".join(all_texts)
    except Exception as e:
        print(f"  [WARN] HWP 파싱 실패 ({os.path.basename(hwp_path)}): {e}")
        return ""


# ── 메타데이터 추출 ───────────────────────────────────────────────────────────

def _parse_filename_meta(hwp_path: str) -> dict:
    basename     = os.path.basename(hwp_path)
    dirname      = os.path.basename(os.path.dirname(hwp_path))
    name_no_ext  = os.path.splitext(basename)[0]
    code_match   = re.match(r"^(KCS|KDS)\s+[\d\s]+", name_no_ext, re.IGNORECASE)
    code         = code_match.group(0).strip() if code_match else name_no_ext[:20]
    title        = name_no_ext[len(code):].strip().replace("_수정", "").replace("_전문", "")
    category     = dirname.split()[0].upper() if dirname else "UNKNOWN"
    return {
        "source":   basename,
        "series":   dirname,
        "code":     code,
        "title":    title,
        "category": category,
        "filepath": hwp_path,
    }


# ── 인덱싱 ───────────────────────────────────────────────────────────────────

def collect_hwp_files(root_dir: str) -> list[str]:
    hwp_files = []
    for dirpath, _, filenames in os.walk(root_dir):
        for fname in filenames:
            if fname.lower().endswith(".hwp"):
                hwp_files.append(os.path.join(dirpath, fname))
    return sorted(hwp_files)


def is_index_populated() -> bool:
    """construction_specs 컬렉션에 문서가 있는지 확인."""
    try:
        import psycopg
        from config.settings import (
            VECTOR_DB_HOST, VECTOR_DB_PORT, VECTOR_DB_NAME,
            VECTOR_DB_USER, VECTOR_DB_PASSWORD,
        )
        with psycopg.connect(
            host=VECTOR_DB_HOST, port=VECTOR_DB_PORT, dbname=VECTOR_DB_NAME,
            user=VECTOR_DB_USER, password=VECTOR_DB_PASSWORD, connect_timeout=5,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*) FROM langchain_pg_embedding e
                    JOIN langchain_pg_collection c ON e.collection_id = c.uuid
                    WHERE c.name = %s
                """, (COLLECTION_NAME,))
                count = cur.fetchone()[0]
                return count > 0
    except Exception:
        return False


def build_index(force: bool = False):
    print("=" * 60)
    print("  건설 공정서/시방서 RAG 인덱스 구축 (pgvector)")
    print(f"  소스 디렉토리 : {RAG_DIR}")
    print(f"  컬렉션 이름   : {COLLECTION_NAME}")
    print("=" * 60)

    if not force and is_index_populated():
        print("\n[SKIP] 인덱스가 이미 구축되어 있습니다. 재구축하려면 --force 옵션을 사용하세요.")
        return

    hwp_files = collect_hwp_files(RAG_DIR)
    if not hwp_files:
        print(f"[ERROR] {RAG_DIR} 에서 HWP 파일을 찾을 수 없습니다.")
        return

    print(f"\n총 {len(hwp_files)}개 HWP 파일 발견\n")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", ". ", " ", ""],
    )

    all_docs: list[Document] = []
    for hwp_path in hwp_files:
        meta = _parse_filename_meta(hwp_path)
        print(f"  파싱 중: [{meta['category']}] {meta['code']} {meta['title']}")
        raw_text = extract_hwp_text(hwp_path)
        if not raw_text.strip():
            print(f"    → 텍스트 추출 실패 또는 빈 파일, 건너뜀")
            continue
        chunks = splitter.split_text(raw_text)
        print(f"    → {len(raw_text):,}자 추출, {len(chunks)}개 청크 생성")
        for i, chunk in enumerate(chunks):
            if not chunk.strip():
                continue
            all_docs.append(Document(
                page_content=chunk,
                metadata={**meta, "chunk_index": i, "total_chunks": len(chunks)},
            ))

    if not all_docs:
        print("\n[ERROR] 인덱싱할 문서가 없습니다.")
        return

    print(f"\n총 {len(all_docs)}개 청크 → pgvector 저장 중...")

    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )

    # 기존 컬렉션 삭제 후 재생성 (멱등성 보장)
    vs = PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=get_pgvector_connection(),
        use_jsonb=True,
    )
    vs.delete_collection()
    vs = PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=get_pgvector_connection(),
        use_jsonb=True,
    )

    BATCH = 50
    for start in range(0, len(all_docs), BATCH):
        batch = all_docs[start : start + BATCH]
        vs.add_documents(batch)
        print(f"  저장: {min(start + BATCH, len(all_docs))}/{len(all_docs)}")

    print("\n✅ 인덱스 구축 완료!")
    print(f"   컬렉션: {COLLECTION_NAME}  |  총 청크: {len(all_docs)}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="건설 시방서 RAG 인덱스 구축")
    parser.add_argument("--force", action="store_true", help="기존 인덱스를 삭제하고 재구축")
    args = parser.parse_args()
    build_index(force=args.force)
