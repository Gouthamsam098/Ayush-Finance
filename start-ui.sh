#!/bin/bash
# Anush LMS — frontend only (no backend needed). Data is in-memory/mock.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node 18+ first: sudo apt install -y nodejs npm"; exit 1; }
[ -d node_modules ] || { echo "Installing dependencies (once, ~2 min)…"; npm install --no-audit --no-fund || exit 1; }
echo "──────────────────────────────────────────────"
echo "  Anush Capitals — UI demo (no backend)"
echo "  Vite will print a URL below (usually http://localhost:5173)"
echo "  Login: any username / password works"
echo "  Ctrl+C to stop"
echo "──────────────────────────────────────────────"
npm run dev
