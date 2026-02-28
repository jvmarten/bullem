#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="bullem"
TAG="${1:-latest}"

echo "Building Docker image: ${IMAGE_NAME}:${TAG}"
docker build -t "${IMAGE_NAME}:${TAG}" .

echo "Build complete: ${IMAGE_NAME}:${TAG}"

# To push to a container registry, uncomment and edit below:
#
# REGISTRY="your-registry.example.com"
# docker tag "${IMAGE_NAME}:${TAG}" "${REGISTRY}/${IMAGE_NAME}:${TAG}"
# docker push "${REGISTRY}/${IMAGE_NAME}:${TAG}"
# echo "Pushed to ${REGISTRY}/${IMAGE_NAME}:${TAG}"
