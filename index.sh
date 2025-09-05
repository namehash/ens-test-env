#!/bin/bash
set -e

# Start devnet and postgres in foreground
echo "Starting devnet and postgres..."
docker compose up devnet postgres &

# Wait for devnet to emit "Ready!" in logs
echo "Waiting for devnet to be ready..."
docker compose logs -f devnet | while read -r line; do
    echo "$line"
    if [[ "$line" == *"Ready!"* ]]; then
        echo "Devnet is ready!"
        break
    fi
done

# Start the other services in foreground
echo "Starting ensindexer, ensrainbow, and metadata..."
docker compose up ensindexer ensrainbow metadata
