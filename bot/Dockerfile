# the reply bot: one Python process, standard library only
FROM public.ecr.aws/docker/library/python:3.13-slim
ENV PYTHONUNBUFFERED=1 BOT_STATE=/data/bot-state.json
WORKDIR /app
COPY xapi.py render.py worker.py ./
CMD ["python", "worker.py"]
