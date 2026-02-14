#!/bin/bash

# Variables
DOCKER_REGISTRY="git.donnerdachs.com/s"
APP_IMAGE="noterain"
VERSION="latest"
COMPOSE_FILE="docker-compose.production.yml"

# Pull latest image
echo "Pulling latest noterain image..."
docker pull $DOCKER_REGISTRY/$APP_IMAGE:$VERSION

# Bring down the running containers
echo "Stopping and removing existing containers..."
docker compose -f $COMPOSE_FILE down --remove-orphans

# Start the services with updated images
echo "Starting updated services..."
docker compose -f $COMPOSE_FILE up -d

echo "noterain has been updated and restarted."
