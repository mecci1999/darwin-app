ARG BASE_IMAGE
FROM ${BASE_IMAGE}

# MySQL may deserialize BIGINT resource versions as safe numbers. Replace only
# the compiled private shooting-location repository in the verified Trails image.
COPY --chown=node:node dist/apps/trails/repository/mysqlShootingLocation.js /app/dist/apps/trails/repository/mysqlShootingLocation.js
