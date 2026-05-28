"""
RAG initial document loading script (PostgreSQL pgvector)

Run: python scripts/init_rag.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.rag_tool import add_documents

DOCUMENTS = [
    {
        "text": "Sensor data is collected via DHT11 sensors. Temperature and humidity values are transmitted in real time through an MQTT broker and stored in the SENSOR_DATA table.",
        "metadata": {"source": "System Manual", "category": "sensor"},
    },
    {
        "text": "BIM (Building Information Modeling) is a digital model of a building that includes position, size, and attribute information for each space and facility. The BIM server runs on port 5112.",
        "metadata": {"source": "System Manual", "category": "bim"},
    },
    {
        "text": "The Digital Twin system builds a virtual model identical to the physical building to support real-time monitoring and predictive maintenance.",
        "metadata": {"source": "System Overview", "category": "overview"},
    },
    {
        "text": "The MQTT broker (Eclipse Mosquitto) runs on port 1883. Sensor data is published to the 'test/topic' topic. The Spring Boot application subscribes to this topic and saves the data to the database.",
        "metadata": {"source": "System Manual", "category": "iot"},
    },
    {
        "text": "Connect to the /ws/sensor endpoint via WebSocket (STOMP protocol) to receive sensor data in real time. The subscription topic is /topic/sensor.",
        "metadata": {"source": "API Documentation", "category": "websocket"},
    },
]


def main():
    print(f"Adding {len(DOCUMENTS)} documents to pgvector (twin_docs)...")
    texts = [d["text"] for d in DOCUMENTS]
    metadatas = [d["metadata"] for d in DOCUMENTS]
    add_documents(texts, metadatas)
    print("Done! pgvector initialization complete.")


if __name__ == "__main__":
    main()
