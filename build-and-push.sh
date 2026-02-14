#!/bin/bash

# Variables
DOCKER_REGISTRY="git.donnerdachs.com/s"
VERSION="latest"

echo "Building image..."
docker compose -f docker-compose.production.yml build

echo "Pushing image..."
docker push $DOCKER_REGISTRY/noterain:$VERSION

echo "Image has been pushed to $DOCKER_REGISTRY/noterain:$VERSION"
