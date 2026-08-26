ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# Replace only the Trails action shard. The base image remains the currently
# verified production Trails image, preserving all prior native-contract fixes.
COPY --chown=node:node dist/apps/trails/actions/index.js /app/dist/apps/trails/actions/index.js
