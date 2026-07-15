FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd -u 1000 -ms /bin/bash appuser && \
    apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        sqlite3 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY app /app/app
RUN mkdir -p /app/data && \
    python3 -c "import datetime,json; v=datetime.datetime.now(datetime.timezone.utc).strftime('v.%Y%m%d.%H%M'); open('/app/app/static/version.json','w',encoding='utf-8').write(json.dumps({'version':v}))" && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
