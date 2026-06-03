#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Start Vite if not already running
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 | grep -q "200"; then
  echo "Starting Vite..."
  cd "$PROJECT_DIR/frontend"
  npm run dev &
  VITE_PID=$!

  # Wait for Vite to be ready
  echo "Waiting for Vite..."
  for i in $(seq 1 20); do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 | grep -q "200"; then
      echo "Vite ready."
      break
    fi
    sleep 0.5
  done
else
  echo "Vite already running."
fi

# Start the Python backend
cd "$PROJECT_DIR"
echo "Starting budgetapp..."
mamba run -n budgetapp python -m budgetapp --dev
