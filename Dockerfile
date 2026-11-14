FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin libgdal32 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/flagwa
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN useradd --create-home --uid 10001 flagwa && mkdir -p /srv/flagwa/storage && chown flagwa:flagwa /srv/flagwa/storage
COPY --chown=flagwa:flagwa app ./app
COPY --chown=flagwa:flagwa config ./config
COPY --chown=flagwa:flagwa scripts ./scripts
COPY --chown=flagwa:flagwa alembic.ini .
USER flagwa
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]