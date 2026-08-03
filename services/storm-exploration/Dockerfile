FROM python:3.11.13-slim AS builder

ARG PIP_VERSION=25.3
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /build

COPY requirements-runtime.in requirements-runtime.lock ./
COPY tools/build_safe_storm_wheel.py tools/build_safe_storm_wheel.py

RUN python -m pip install "pip==${PIP_VERSION}" \
    && python -m pip download \
        --only-binary=:all: \
        --no-deps \
        --dest /tmp/upstream \
        knowledge-storm==1.1.1 \
    && python tools/build_safe_storm_wheel.py \
        /tmp/upstream/knowledge_storm-1.1.1-py3-none-any.whl \
        --output-dir .dist \
    && python -m venv /opt/storm-venv \
    && /opt/storm-venv/bin/python -m pip install "pip==${PIP_VERSION}" \
    && /opt/storm-venv/bin/python -m pip install \
        --require-hashes \
        --find-links .dist \
        -r requirements-runtime.lock

FROM python:3.11.13-slim AS runtime

ENV PATH=/opt/storm-venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STORM_EXPLORATION_DATA_DIR=/data
WORKDIR /srv/storm

COPY --from=builder /opt/storm-venv /opt/storm-venv
COPY app app
COPY runtime-admission.json runtime-admission.json

RUN useradd --system --uid 10001 --create-home storm \
    && mkdir -p /data /tmp/researchgpt-storm-disabled-cache \
    && chown -R storm:storm /data /tmp/researchgpt-storm-disabled-cache

USER 10001
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)); assert data['status']=='ok'"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
