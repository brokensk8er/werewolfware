#!/bin/bash

# Quick Deployment Test Script
# Tests basic connectivity and logs

set -e

BACKEND_URL="${BACKEND_URL:-https://werewolfware.fly.dev}"

echo "╔════════════════════════════════════════╗"
echo "║   Werewolf Game - Quick Test           ║"
echo "║   Backend: $BACKEND_URL     ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Test 1: Health Check
echo "📍 Test 1: Health Check"
if curl -s -f "$BACKEND_URL/api/health" > /dev/null 2>&1; then
  echo "  ✓ Backend is responding"
  RESPONSE=$(curl -s "$BACKEND_URL/api/health")
  echo "  → Response: $RESPONSE"
else
  echo "  ✗ Backend is not responding"
  echo "  → Check if the app is running: flyctl status -a werewolfware"
  exit 1
fi
echo ""

# Test 2: Check Frontend
echo "📍 Test 2: Frontend Check"
if curl -s -f "$BACKEND_URL/" > /dev/null 2>&1; then
  echo "  ✓ Frontend is being served"
else
  echo "  ✗ Frontend not accessible"
  exit 1
fi
echo ""

# Test 3: Check Socket.io
echo "📍 Test 3: Socket.io Check"
if curl -s "$BACKEND_URL/socket.io/" > /dev/null 2>&1; then
  echo "  ✓ Socket.io is available"
else
  echo "  ⚠ Socket.io check inconclusive (may still be working)"
fi
echo ""

echo "╔════════════════════════════════════════╗"
echo "║   Manual Testing Required              ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "1. Open in browser: $BACKEND_URL"
echo "2. Create a game with your name"
echo "3. In another tab/window, join with different name"
echo "4. Test chat and game flow"
echo ""
echo "For detailed testing guide, see: TESTING_DEPLOYMENT.md"
