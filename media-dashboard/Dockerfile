FROM python:3.11-slim

WORKDIR /app/media-dashboard/backend

# Install system deps (for pg8000/asyncpg)
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (layer caching)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -q -r requirements.txt

# Copy backend code
COPY backend/ .

# Copy frontend build (pre-built static files)
COPY frontend/build/ ./static/

EXPOSE 8000

# Run migrations then start server
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
