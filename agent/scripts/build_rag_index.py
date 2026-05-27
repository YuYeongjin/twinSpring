"""
건설 공정서/시방서 RAG 인덱싱 스크립트

Usage:
    python scripts/build_rag_index.py

기능:
    - agent/rag/ 하위 HWP 파일 전체 파싱
    - 청크 분할 후 ChromaDB(construction_specs 컬렉션)에 저장
    - 메타데이터: source(파일명), category(KCS/KDS 분류), code(규격코드)

HWP 파싱 방식:
    - olefile 라이브러리로 OLE 구조 직접 읽기
    - BodyText/Section{n} 스트림 추출 → zlib 압축 해제 → UTF-16LE 디코딩
    - HWPTAG_PARA_TEXT(tag_id=67) 레코드에서 텍스트 파싱
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

from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from config import CHROMA_PERSIST_DIR, EMBEDDING_MODEL

# ── 설정 ─────────────────────────────────────────────────────────────────────
RAG_DIR          = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rag")
COLLECTION_NAME  = "construction_specs"
CHUNK_SIZE       = 800    # 문자 수 (한국어 기준 약 400~500 어절)
CHUNK_OVERLAP    = 150

# ── HWP 파싱 ─────────────────────────────────────────────────────────────────

def _is_compressed(ole: olefile.OleFileIO) -> bool:
    """FileHeader에서 BodyText 압축 여부 확인"""
    try:
        header = ole.openstream("FileHeader").read()
        if len(header) < 36:
            return True          # 기본값: 압축 가정
        attribute = struct.unpack_from("<I", header, 32)[0]
        return bool(attribute & 0x01)
    except Exception:
        return True


def _parse_records(data: bytes) -> str:
    """HWP BodyText 레코드 스트림 → 텍스트"""
    texts = []
    offset = 0

    while offset + 4 <= len(data):
        header = struct.unpack_from("<I", data, offset)[0]
        offset += 4

        tag_id = header & 0x3FF
        size   = (header >> 20) & 0xFFF

        # 확장 크기 필드
        if size == 0xFFF:
            if offset + 4 > len(data):
                break
            size = struct.unpack_from("<I", data, offset)[0]
            offset += 4

        record = data[offset : offset + size]
        offset += size

        # HWPTAG_PARA_TEXT = 67 (0x43)
        if tag_id == 67 and len(record) >= 2:
            try:
                text = record.decode("utf-16le", errors="ignore")
                # 인쇄 가능 문자 + 줄바꿈만 유지, 제어 코드 제거
                cleaned = "".join(
                    c if (c.isprintable() or c in "\n\r") else " "
                    for c in text
                )
                cleaned = cleaned.strip()
                if cleaned:
                    texts.append(cleaned)
            except Exception:
                pass

    return "\n".join(texts)


def extract_hwp_text(hwp_path: str) -> str:
    """
    HWP 5.x 파일에서 전체 본문 텍스트 추출.
    실패 시 빈 문자열 반환.
    """
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
                        pass  # 압축 안 된 섹션이면 그대로 사용

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
    """
    파일 경로에서 메타데이터 추출.

    예) agent/rag/KCS 10 00 00/KCS 10 10 05 공사일반_수정.hwp
      → category: KCS, series: KCS 10 00 00, code: KCS 10 10 05, title: 공사일반
    """
    basename = os.path.basename(hwp_path)           # "KCS 10 10 05 공사일반_수정.hwp"
    dirname  = os.path.basename(os.path.dirname(hwp_path))  # "KCS 10 00 00"

    name_no_ext = os.path.splitext(basename)[0]     # "KCS 10 10 05 공사일반_수정"

    # 규격 코드 추출: "KCS 10 10 05" 형태
    code_match = re.match(r"^(KCS|KDS)\s+[\d\s]+", name_no_ext, re.IGNORECASE)
    code = code_match.group(0).strip() if code_match else name_no_ext[:20]

    # 제목: 코드 이후 나머지 (한글 부분)
    title = name_no_ext[len(code):].strip().replace("_수정", "").replace("_전문", "")

    # 상위 분류
    category = dirname.split()[0].upper() if dirname else "UNKNOWN"  # "KCS" or "KDS"

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
    """rag/ 디렉토리 하위 HWP 파일 목록 수집"""
    hwp_files = []
    for dirpath, _, filenames in os.walk(root_dir):
        for fname in filenames:
            if fname.lower().endswith(".hwp"):
                hwp_files.append(os.path.join(dirpath, fname))
    return sorted(hwp_files)


def build_index():
    print("=" * 60)
    print("  건설 공정서/시방서 RAG 인덱스 구축")
    print(f"  소스 디렉토리 : {RAG_DIR}")
    print(f"  ChromaDB 경로 : {CHROMA_PERSIST_DIR}")
    print(f"  컬렉션 이름   : {COLLECTION_NAME}")
    print("=" * 60)

    # ── HWP 파일 수집 ─────────────────────────────────────────────
    hwp_files = collect_hwp_files(RAG_DIR)
    if not hwp_files:
        print(f"[ERROR] {RAG_DIR} 에서 HWP 파일을 찾을 수 없습니다.")
        return

    print(f"\n총 {len(hwp_files)}개 HWP 파일 발견\n")

    # ── 텍스트 분할기 ─────────────────────────────────────────────
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", ". ", " ", ""],
    )

    # ── 문서 생성 ─────────────────────────────────────────────────
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
            doc = Document(
                page_content=chunk,
                metadata={
                    **meta,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                },
            )
            all_docs.append(doc)

    if not all_docs:
        print("\n[ERROR] 인덱싱할 문서가 없습니다. HWP 파싱을 확인하세요.")
        return

    print(f"\n총 {len(all_docs)}개 청크 → ChromaDB 저장 중...")

    # ── 임베딩 + ChromaDB 저장 ─────────────────────────────────────
    embeddings = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )

    # 기존 컬렉션 초기화 후 재저장 (멱등성 보장)
    vectorstore = Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=CHROMA_PERSIST_DIR,
    )

    # 배치 저장 (메모리 절약)
    BATCH = 50
    for start in range(0, len(all_docs), BATCH):
        batch = all_docs[start : start + BATCH]
        vectorstore.add_documents(batch)
        print(f"  저장: {min(start + BATCH, len(all_docs))}/{len(all_docs)}")

    print("\n✅ 인덱스 구축 완료!")
    print(f"   컬렉션: {COLLECTION_NAME}  |  총 청크: {len(all_docs)}")


if __name__ == "__main__":
    build_index()
