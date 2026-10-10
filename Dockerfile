# Quoro: one Python process — the API (scores, AI reading, quotes) and the static site
# the official python image through AWS ECR Public: Docker Hub rate-limits shared builders (429)
FROM public.ecr.aws/docker/library/python:3.13-slim
ENV PYTHONUNBUFFERED=1 DATA_DIR=/data DB_PATH=/data/quoro.db HOST=0.0.0.0 SITE_DIR=/app/site
WORKDIR /app
COPY server/requirements.txt server/
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/server.py server/stocks.json server/
COPY site site
RUN rm -f site/js/mock.js
CMD ["python", "server/server.py"]
