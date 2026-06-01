"""
Language detection and translation utilities for multi-language agent responses.

Usage:
    from config.lang_util import detect_lang, lang_instruction, translate_reply

    lang = detect_lang(user_text)          # 'ko' | 'ja' | 'en'
    note = lang_instruction(lang)          # instruction string for system prompt
    reply = translate_reply(reply, lang)   # translate hardcoded English reply
"""

import re
from langchain_core.messages import SystemMessage, HumanMessage


def detect_lang(text: str) -> str:
    """
    Detect the language of input text by scanning Unicode ranges.

    Priority:
      1. Korean  — any Hangul syllable block (U+AC00–U+D7A3)
      2. Japanese — any Hiragana (U+3040–U+309F) or Katakana (U+30A0–U+30FF)
      3. English  — default fallback

    Accepts a concatenation of recent messages for robustness in multi-step flows.
    Returns: 'ko' | 'ja' | 'en'
    """
    if re.search(r'[가-힣]', text):
        return 'ko'
    if re.search(r'[぀-ゟ゠-ヿ]', text):
        return 'ja'
    return 'en'


def lang_instruction(lang: str) -> str:
    """
    Return a language-specific instruction string to append to system prompts.

    영어·일본어는 LLM 이 장문을 생성하는 경향이 있어 명시적 길이 제한을 추가합니다.
    짧은 응답 → 처리 시간 단축 → 에러 메시지 노출 방지.
    """
    instructions = {
        'ko': '반드시 한국어로 답변하세요.',
        'en': (
            'Reply in English. '
            'Be concise — 2 to 3 sentences for simple questions. '
            'Do not add unnecessary explanations or filler phrases.'
        ),
        'ja': (
            '必ず日本語だけで返答してください。'
            '漢字・ひらがな・カタカナのみ使用してください。'
            '中国語の語句（给、您、或者、请、確認您 など）は絶対に使わないでください。'
            '簡潔に2〜3文以内で答えてください。'
        ),
    }
    return instructions.get(lang, '')


_ERROR_MESSAGES: dict[str, str] = {
    'ko': "요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    'en': "An error occurred while processing your request. Please try again.",
    'ja': "リクエストの処理中にエラーが発生しました。しばらくしてから再試行してください。",
}


def error_msg(lang: str) -> str:
    """언어에 맞는 사용자용 에러 메시지를 반환합니다."""
    return _ERROR_MESSAGES.get(lang, _ERROR_MESSAGES['en'])


def translate_reply(text: str, lang: str) -> str:
    """
    Translate an English reply to the target language using the LLM.

    Behaviour:
    - If lang == 'en' or text is empty, returns the original text unchanged.
    - Keeps emoji, numbers, technical identifiers (BIM, IFC element types,
      excavator field names, IDLE/DIG/DUMP/TRAVEL presets, etc.) as-is.
    - Falls back to the original English text on any LLM error.
    """
    if lang == 'en' or not text:
        return text

    lang_name = {'ko': '한국어', 'ja': '日本語'}.get(lang, 'English')
    try:
        from config.llm_config import llm_chat   # deferred import to avoid circular deps
        resp = llm_chat.invoke([
            SystemMessage(content=(
                f"Translate the following text into {lang_name}. "
                "Rules:\n"
                "- Keep emoji, numbers, and code values exactly as-is.\n"
                "- Keep technical identifiers unchanged: BIM, IFC, IfcColumn, IfcBeam, "
                "IfcWall, IfcSlab, IfcPier, IDLE, DIG, DUMP, TRAVEL, excavatorId, "
                "elementId, projectId, positionX/Y/Z, boomAngle, armAngle, bucketAngle, "
                "swingAngle, bodyRotation, and similar camelCase field names.\n"
                "- Only translate the natural-language portions.\n"
                "- Output ONLY the translated text — no explanation, no surrounding quotes."
            )),
            HumanMessage(content=text),
        ])
        translated = resp.content.strip()
        return translated if translated else text
    except Exception:
        return text   # graceful fallback to English
