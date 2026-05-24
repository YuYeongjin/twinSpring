FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY detect.py .

RUN curl -L -o yolov8n.pt https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.pt

EXPOSE 5001

CMD ["python", "detect.py"]