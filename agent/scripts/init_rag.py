"""
RAG 초기 문서 로딩 스크립트

실행: python scripts/init_rag.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.rag_tool import add_documents

DOCUMENTS = [
    {
        "text": "센서 데이터는 DHT11 센서를 통해 수집됩니다. 온도(temperature)와 습도(humidity) 값을 MQTT 브로커를 통해 실시간으로 전송하며, SENSOR_DATA 테이블에 저장됩니다.",
        "metadata": {"source": "시스템 매뉴얼", "category": "sensor"},
    },
    {
        "text": "에너지 데이터(ENERGY_DATA)에는 전력(power_kw), 전압(voltage), 전류(current), 누적 전력량(energy_kwh) 정보가 저장됩니다. 전기 요금은 115원/kWh로 계산됩니다.",
        "metadata": {"source": "시스템 매뉴얼", "category": "energy"},
    },
    {
        "text": "EMS 알림(EMS_ALERT)은 에너지 임계값 초과 시 자동으로 생성됩니다. 심각도는 CRITICAL, WARNING, INFO 세 단계로 구분됩니다.",
        "metadata": {"source": "시스템 매뉴얼", "category": "ems"},
    },
    {
        "text": "EMS_THRESHOLD 테이블에는 위치별, 유형별 임계값이 저장됩니다. 임계값 초과 시 EMS_ALERT가 생성되어 관리자에게 알림이 전송됩니다.",
        "metadata": {"source": "시스템 매뉴얼", "category": "ems"},
    },
    {
        "text": "BIM(Building Information Modeling)은 건물의 디지털 모델로, 각 공간과 설비의 위치, 크기, 속성 정보를 포함합니다. BIM 서버는 포트 5112에서 동작합니다.",
        "metadata": {"source": "시스템 매뉴얼", "category": "bim"},
    },
    {
        "text": "디지털 트윈 시스템은 실물 건물과 동일한 가상 모델을 구축하여 실시간 모니터링, 에너지 최적화, 예측 유지보수를 지원합니다.",
        "metadata": {"source": "시스템 개요", "category": "overview"},
    },
    {
        "text": "MQTT 브로커(Eclipse Mosquitto)는 포트 1883에서 동작하며, 센서 데이터는 'test/topic' 토픽으로 발행됩니다. Spring Boot 애플리케이션이 이를 구독하여 DB에 저장합니다.",
        "metadata": {"source": "시스템 매뉴얼", "category": "iot"},
    },
    {
        "text": "WebSocket(STOMP 프로토콜)을 통해 /ws/sensor 엔드포인트에 연결하면 센서 데이터를 실시간으로 수신할 수 있습니다. 토픽은 /topic/sensor입니다.",
        "metadata": {"source": "API 문서", "category": "websocket"},
    },
]


def main():
    print(f"총 {len(DOCUMENTS)}개 문서를 벡터스토어에 추가합니다...")
    texts = [d["text"] for d in DOCUMENTS]
    metadatas = [d["metadata"] for d in DOCUMENTS]
    add_documents(texts, metadatas)
    print("완료! 벡터스토어 초기화가 완료되었습니다.")


if __name__ == "__main__":
    main()
