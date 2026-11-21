# PetroNova web app: container for online hosting (Render, Railway, Hugging Face Spaces, ...)
# Build:  docker build -t petronova .
# Run:    docker run -p 8000:8000 petronova     ->  http://localhost:8000
FROM python:3.13-slim

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# code + the small tables and trained model the app needs (see .dockerignore)
COPY . .

ENV PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "run_app.py", "--public"]
