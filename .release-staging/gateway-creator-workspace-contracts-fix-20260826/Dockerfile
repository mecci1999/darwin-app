ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# Replace only the Gateway transport boundary. The base image remains the
# currently verified production image, so unrelated services are untouched.
COPY dist/core/gateway/index.js /app/dist/core/gateway/index.js
COPY dist/core/gateway/dispatch-meta.js /app/dist/core/gateway/dispatch-meta.js
