#!/bin/bash
set -e

# Containers to manage
SERVICES_DEVNET="devnet postgres"
SERVICES_ENSNODE="ensindexer ensrainbow metadata"

cleanup() {
    echo "Stopping all services..."
    docker compose down
    exit 1
}

trap cleanup SIGINT SIGTERM

start() {
    echo "Starting devnet and postgres..."
    docker compose up $SERVICES_DEVNET &

    DEVNET_PID=$!

    echo "Waiting for devnet to be ready..."
    while true; do
        if docker compose logs devnet | grep -q "Ready!"; then
            echo "Devnet is ready!"
            break
        fi
        sleep 1
    done

    echo "Starting ensindexer, ensrainbow, and metadata..."
    docker compose up $SERVICES_ENSNODE

    wait $DEVNET_PID
}

stop() {
    echo "Stopping all services..."
    docker compose down
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    *)
        echo "Usage: $0 {start|stop}"
        exit 1
        ;;
esac
