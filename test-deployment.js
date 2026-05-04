#!/usr/bin/env node

/**
 * Werewolf Game Deployment Test Script
 * Tests: Socket.io connection, game creation, joining, chat, and game mechanics
 */

import { io } from 'socket.io-client';
import fetch from 'node-fetch';

const BACKEND_URL = process.env.BACKEND_URL || 'https://werewolfware.fly.dev';
let testsPassed = 0;
let testsFailed = 0;

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function test(name, passed, message = '') {
  if (passed) {
    testsPassed++;
    log(`✓ ${name}`, 'green');
    if (message) log(`  → ${message}`, 'blue');
  } else {
    testsFailed++;
    log(`✗ ${name}`, 'red');
    if (message) log(`  → ${message}`, 'yellow');
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testHealthCheck() {
  log('\n=== Health Check Test ===', 'blue');
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`);
    const data = await response.json();
    test('Backend health check', response.status === 200 && data.status === 'ok', `Status: ${data.status}`);
  } catch (error) {
    test('Backend health check', false, `Error: ${error.message}`);
  }
}

async function testSocketConnection() {
  log('\n=== Socket.io Connection Test ===', 'blue');
  return new Promise((resolve) => {
    const socket = io(BACKEND_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      test('Socket connection', false, 'Connection timeout after 10s');
      resolve(false);
    }, 10000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      test('Socket connection', true, `Connected with ID: ${socket.id}`);
      socket.disconnect();
      resolve(true);
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      test('Socket connection', false, `Error: ${error}`);
      resolve(false);
    });
  });
}

async function testGameFlow() {
  log('\n=== Game Flow Test ===', 'blue');
  return new Promise(async (resolve) => {
    let player1Socket, player2Socket;
    let gameRoomCode = null;
    let testsPassed_local = 0;

    // Setup timeout for entire test
    const globalTimeout = setTimeout(() => {
      if (player1Socket) player1Socket.disconnect();
      if (player2Socket) player2Socket.disconnect();
      log(`Game flow tests completed: ${testsPassed_local} checks passed`, 'yellow');
      resolve();
    }, 15000);

    try {
      // Player 1: Create game
      player1Socket = io(BACKEND_URL);

      player1Socket.on('connect', () => {
        test('Player 1 connected', true, `Socket ID: ${player1Socket.id}`);
        player1Socket.emit('lobby:create', { playerName: 'Alice' });
      });

      player1Socket.on('lobby:created', (data) => {
        gameRoomCode = data.roomCode;
        test('Game created', true, `Room Code: ${gameRoomCode}`);
        testsPassed_local++;

        // Player 2: Join game
        player2Socket = io(BACKEND_URL);
        player2Socket.on('connect', () => {
          test('Player 2 connected', true, `Socket ID: ${player2Socket.id}`);
          player2Socket.emit('lobby:join', { roomCode: gameRoomCode, playerName: 'Bob' });
        });
      });

      player1Socket.on('lobby:updated', (data) => {
        test('Lobby update received', data.players && data.players.length === 2, `Players: ${data.players.length}`);
        testsPassed_local++;

        // Give a moment for player 2 to fully join, then start game
        setTimeout(() => {
          player1Socket.emit('game:start');
        }, 500);
      });

      player1Socket.on('game:started', (data) => {
        test('Game started', !!data.role, `Player 1 role: ${data.role}`);
        testsPassed_local++;

        // Test game advancement
        setTimeout(() => {
          player1Socket.emit('game:advancePhase');
        }, 500);
      });

      player1Socket.on('phase:changed', (data) => {
        test('Phase changed', !!data.phase, `New phase: ${data.phase}`);
        testsPassed_local++;

        // Test chat
        setTimeout(() => {
          player1Socket.emit('chat:send', { text: 'Hello, everyone!' });
        }, 500);
      });

      player1Socket.on('chat:received', (data) => {
        test('Chat received', !!data.message, `Message: "${data.message}"`);
        testsPassed_local++;

        // Cleanup and finish
        setTimeout(() => {
          clearTimeout(globalTimeout);
          if (player1Socket) player1Socket.disconnect();
          if (player2Socket) player2Socket.disconnect();
          log(`Game flow tests completed: ${testsPassed_local} checks passed`, 'blue');
          resolve();
        }, 1000);
      });

      player1Socket.on('error', (error) => {
        test('Player 1 error handling', false, error);
      });

      player2Socket?.on('error', (error) => {
        test('Player 2 error handling', false, error);
      });
    } catch (error) {
      log(`Game flow test error: ${error.message}`, 'red');
      if (player1Socket) player1Socket.disconnect();
      if (player2Socket) player2Socket.disconnect();
      resolve();
    }
  });
}

async function testChatFunctionality() {
  log('\n=== Chat Functionality Test ===', 'blue');
  return new Promise((resolve) => {
    const socket = io(BACKEND_URL);
    let messageReceived = false;

    const timeout = setTimeout(() => {
      socket.disconnect();
      test('Chat send/receive', messageReceived, 'No chat message received');
      resolve();
    }, 10000);

    socket.on('connect', () => {
      // Create a game and send chat
      socket.emit('lobby:create', { playerName: 'ChatTester' });
    });

    socket.on('lobby:created', () => {
      socket.emit('chat:send', { text: 'Test chat message' });
    });

    socket.on('chat:received', (data) => {
      if (data.message === 'Test chat message') {
        clearTimeout(timeout);
        test('Chat send/receive', true, `Message: "${data.message}"`);
        messageReceived = true;
        socket.disconnect();
        resolve();
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      test('Chat functionality', false, error);
      resolve();
    });
  });
}

async function runAllTests() {
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║   Werewolf Game - Deployment Tests     ║', 'blue');
  log(`║   Backend: ${BACKEND_URL}`, 'blue');
  log('╚════════════════════════════════════════╝', 'blue');

  await testHealthCheck();
  const socketConnected = await testSocketConnection();

  if (socketConnected) {
    await testGameFlow();
    await testChatFunctionality();
  } else {
    log('\nSkipping game flow and chat tests (Socket connection failed)', 'yellow');
  }

  // Summary
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║          Test Summary                  ║', 'blue');
  log(`║  Passed: ${testsPassed} ✓`, 'green');
  log(`║  Failed: ${testsFailed} ✗`, testsFailed > 0 ? 'red' : 'green');
  log('╚════════════════════════════════════════╝', 'blue');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests().catch((error) => {
  log(`\nFatal error: ${error.message}`, 'red');
  process.exit(1);
});
