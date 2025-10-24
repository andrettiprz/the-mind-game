// Import Firebase v9 modular SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ============================================
// FIREBASE CONFIG & INITIALIZATION
// ============================================

const firebaseConfig = {
    // --- Using your provided keys ---
    apiKey: "AIzaSyBhgVTQXICNvQTZx2wHH9kAfK0c7ymTZPc",
    authDomain: "themind-450af.firebaseapp.com",
    databaseURL: "https://themind-450af-default-rtdb.firebaseio.com",
    projectId: "themind-450af",
    storageBucket: "themind-450af.firebasestorage.app",
    messagingSenderId: "206488361143",
    appId: "1:206488361143:web:3f2dc1b2a55dd8ccbe1532",
    measurementId: "G-8NTF0H3BH4" // Optional
};

// Initialize Firebase
let app, database;
try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    console.log("Firebase initialized successfully. ✅");
} catch (error) {
    console.error("Firebase initialization failed: ❌", error);
    alert("Error crítico: No se pudo conectar con la base de datos. La aplicación no funcionará.");
    // Display error permanently if Firebase fails
    document.body.innerHTML = '<div class="text-center text-red-500 p-8">Error Crítico: No se pudo conectar a la base de datos. Por favor, recarga la página.</div>';
}

// ============================================
// GLOBAL VARIABLES & CONFIG
// ============================================

let currentRoomId = null;
let currentPlayer = null;
let gameState = null; // Local synchronized copy of the game state
let previousGameState = null; // Store previous state for comparisons (like level change)
let isAdvancing = false; // Flag to prevent multiple concurrent advanceLevel calls
let checkLevelTimeout = null; // Timeout ID for level completion check
let levelUpTimeoutId = null; // Timeout ID for the level up modal

// Configuration based on player count (Lives & Stars follow official rules)
const GAME_CONFIG = {
    2: { levels: 12, lives: 2, stars: 1 },
    3: { levels: 10, lives: 3, stars: 1 },
    4: { levels: 8, lives: 4, stars: 1 } // Correctly starts with 4 lives for 4 players
};

// Rewards granted upon completing a specific level
const LEVEL_REWARDS = {
    2: 'star', 3: 'life', 5: 'star', 6: 'life', 8: 'star', 9: 'life'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Ensures the value is always an array. Handles null, undefined, single values.
 * Crucial for dealing with Firebase's array/object handling quirks.
 */
function ensureArray(value) {
    if (!value) return []; // Handles null, undefined, 0, false, ""
    if (Array.isArray(value)) return value;
    // Firebase might store a single-element array as just the element
    return [value];
}

/**
 * Escapes HTML characters in a string to prevent XSS.
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return ''; // Handle non-string inputs safely
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Generates a standard deck of 100 cards.
 */
function generateDeck() {
    const deck = [];
    for (let i = 1; i <= 100; i++) deck.push(i);
    return shuffleArray(deck);
}

/**
 * Shuffles an array using the Fisher-Yates (Knuth) algorithm.
 */
function shuffleArray(array) {
    const newArray = [...array]; // Create a copy to avoid modifying the original
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]]; // Swap elements
    }
    return newArray;
}

// ============================================
// EXPOSE FUNCTIONS TO WINDOW (for HTML onclick handlers)
// ============================================

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGameFromWaiting = startGameFromWaiting;
window.leaveRoom = leaveRoom;
window.playCard = playCard;
window.proposeStar = proposeStar;
window.voteStarYes = voteStarYes;
window.voteStarNo = voteStarNo;

// ============================================
// LOBBY & ROOM MANAGEMENT
// ============================================

/**
 * Listens for changes in the 'rooms' node and updates the lobby display.
 */
function listenToRooms() {
    if (!database) return; // Don't listen if Firebase failed
    const roomsRef = ref(database, 'rooms');
    onValue(roomsRef, (snapshot) => {
        const rooms = snapshot.val();
        displayRooms(rooms);
    }, (error) => {
         console.error("Error listening to rooms:", error);
         const roomsList = document.getElementById('roomsList');
         if(roomsList) roomsList.innerHTML = '<p class="text-center text-red-500 py-8">Error al cargar salas.</p>';
    });
}

/**
 * Renders the list of available rooms in the lobby UI.
 */
function displayRooms(rooms) {
    const roomsList = document.getElementById('roomsList');
    if (!roomsList) {
        // Only log error if we expect the lobby to be visible
        if (!document.getElementById('lobbyScreen')?.classList.contains('hidden')) {
            console.error('Elemento roomsList no encontrado en el DOM.');
        }
        return;
    }

    if (!rooms || typeof rooms !== 'object' || Object.keys(rooms).length === 0) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas disponibles</p>';
        return;
    }

    // Filter for rooms that are 'waiting' and not full, with robust checks
    const openRooms = Object.entries(rooms).filter(([_, room]) => {
        return room && typeof room === 'object' &&
               room.players && typeof room.players === 'object' &&
               room.status === 'waiting' &&
               (Object.keys(room.players).length < (room.maxPlayers || 0));
    });

    if (openRooms.length === 0) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas abiertas</p>';
        return;
    }

    // Generate HTML for each open room, ensuring data safety
    roomsList.innerHTML = openRooms.map(([roomId, room]) => {
        const currentPlayers = Object.keys(room.players || {}).length;
        const maxPlayers = room.maxPlayers || 0;
        const roomName = escapeHtml(room.name || 'Sala sin nombre'); // Sanitize name

        // Use button type="button" to prevent potential form submission issues
        return `
            <div class="bg-white/10 p-4 rounded-lg hover:bg-white/20 transition cursor-pointer border border-white/20"
                 onclick="joinRoom('${roomId}')">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="font-bold text-lg">${roomName}</p>
                        <p class="text-sm opacity-75">${currentPlayers}/${maxPlayers} jugadores</p>
                    </div>
                    <button type="button" class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg font-bold pointer-events-none">UNIRSE</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Creates a new game room in Firebase.
 */
async function createRoom() {
     if (!database) { alert("Error de conexión con la base de datos."); return; }
    try {
        const roomNameInput = document.getElementById('createRoomName');
        const playerNameInput = document.getElementById('createPlayerName');
        const playerCountEl = document.getElementById('playerCount');

        if (!roomNameInput || !playerNameInput || !playerCountEl) {
             alert('Error: Elementos del formulario no encontrados.'); return;
        }

        const roomName = roomNameInput.value.trim();
        const playerName = playerNameInput.value.trim();
        const maxPlayers = parseInt(playerCountEl.value);

        if (!roomName || !playerName) {
            alert('Por favor completa el nombre de la sala y tu nombre.'); return;
        }
        if (isNaN(maxPlayers) || !GAME_CONFIG[maxPlayers]) {
            alert('Número de jugadores inválido seleccionado.'); return;
        }

        currentPlayer = playerName;
        const config = GAME_CONFIG[maxPlayers]; // Get config based on selection

        const roomsRef = ref(database, 'rooms');
        const newRoomRef = push(roomsRef); // Generate unique room ID
        currentRoomId = newRoomRef.key;
        if (!currentRoomId) throw new Error("No se pudo generar ID para la sala.");

        // Set initial room data
        await set(newRoomRef, {
            name: roomName,
            maxPlayers: maxPlayers,
            status: 'waiting',
            host: playerName,
            players: { [playerName]: { connected: true } }, // Simple player object
            config: config // Store game config
        });
        console.log(`Sala ${currentRoomId} creada por ${playerName}`);

        // Set up automatic removal on disconnect
        const playerRef = ref(database, `rooms/${currentRoomId}/players/${playerName}`);
        onDisconnect(playerRef).remove();

        showWaitingScreen();
        listenToRoom(); // Start listening to this specific room
    } catch (error) {
        console.error('Error al crear sala:', error);
        alert(`Error al crear sala: ${error.message}`);
        // Reset state if creation failed
        currentRoomId = null;
        currentPlayer = null;
    }
}

/**
 * Joins an existing game room.
 */
async function joinRoom(roomId) {
     if (!database) { alert("Error de conexión con la base de datos."); return; }
    try {
        const playerNameInput = document.getElementById('joinPlayerName');
        if (!playerNameInput) {
             alert('Error: Campo de nombre no encontrado.'); return;
        }
        const playerName = playerNameInput.value.trim();

        if (!playerName) {
            alert('Por favor ingresa tu nombre para unirte.'); return;
        }
        if (!roomId) {
            alert('ID de sala inválido.'); return;
        }

        currentRoomId = roomId; // Set room ID early for checks

        const roomRef = ref(database, `rooms/${roomId}`);
        const snapshot = await get(roomRef);

        if (!snapshot.exists()) {
            alert('La sala no existe o fue cerrada.');
            currentRoomId = null; return;
        }

        const room = snapshot.val();
        // Add more robust checks for room data validity
        if (!room || !room.players || typeof room.players !== 'object' || typeof room.maxPlayers !== 'number') {
             alert('Error: Datos de la sala inválidos.');
             currentRoomId = null; return;
        }

        // Check if room is full
        if (Object.keys(room.players).length >= room.maxPlayers) {
            alert('La sala está llena.');
            currentRoomId = null; return;
        }
        // Check if player name is already taken
        if (room.players[playerName]) {
            alert('Ya existe un jugador con ese nombre en esta sala.');
            currentRoomId = null; return;
        }
        // Check if game is already in progress
        if (room.status === 'playing') {
             alert('El juego ya ha comenzado en esta sala.');
             currentRoomId = null; return;
        }

        currentPlayer = playerName; // Set currentPlayer only after validation passes

        // Add player to the room
        console.log(`Jugador ${playerName} uniéndose a la sala ${roomId}`);
        const playerRef = ref(database, `rooms/${roomId}/players/${playerName}`);
        await set(playerRef, { connected: true });
        onDisconnect(playerRef).remove(); // Setup disconnect handler

        showWaitingScreen();
        listenToRoom(); // Start listening to this specific room
    } catch (error) {
        console.error(`Error al unirse a la sala ${roomId}:`, error);
        alert(`Error al unirse: ${error.message}`);
        currentRoomId = null; // Reset state on error
        currentPlayer = null;
    }
}

/**
 * Switches the UI to the waiting screen, hiding others.
 */
function showWaitingScreen() {
    document.getElementById('lobbyScreen')?.classList.add('hidden');
    document.getElementById('waitingScreen')?.classList.remove('hidden');
    document.getElementById('gameScreen')?.classList.add('hidden');
    document.getElementById('gameOverModal')?.classList.add('hidden');
    document.getElementById('levelUpModal')?.classList.add('hidden'); // Also hide level up modal
}

/**
 * Switches the UI to the game screen, hiding others.
 */
function showGameScreen() {
    document.getElementById('waitingScreen')?.classList.add('hidden');
    document.getElementById('lobbyScreen')?.classList.add('hidden');
    document.getElementById('gameScreen')?.classList.remove('hidden');
    document.getElementById('gameOverModal')?.classList.add('hidden'); // Ensure game over modal is hidden
    document.getElementById('levelUpModal')?.classList.add('hidden'); // Ensure level up modal is hidden
}

// ============================================
// ROOM LISTENER & STATE MANAGEMENT
// ============================================

/**
 * Listens for real-time updates to the current room and manages state transitions.
 */
function listenToRoom() {
     if (!database || !currentRoomId) return; // Need DB and room ID

    const roomRef = ref(database, `rooms/${currentRoomId}`);
    console.log(`Escuchando cambios en la sala: ${currentRoomId}`);

    // Detach previous listener if exists? For simplicity, we assume one listener per room entry.
    // If rejoining rooms without refresh is needed, listener management becomes crucial.

    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();

        // Handle room closure or unexpected deletion
        if (!room) {
            console.error(`La sala ${currentRoomId} ya no existe en Firebase.`);
            // Only alert/reload if user was actively in this room's context
            const lobbyHidden = document.getElementById('lobbyScreen')?.classList.contains('hidden');
            if (currentRoomId && lobbyHidden) { // Check if user was not on lobby screen
                 const modal = document.getElementById('gameOverModal');
                 const levelUpModal = document.getElementById('levelUpModal');
                 // Avoid double alert if a modal is already shown
                 if ((!modal || modal.classList.contains('hidden')) && (!levelUpModal || levelUpModal.classList.contains('hidden')) ) {
                     alert('La sala fue cerrada o ya no existe.');
                     location.reload(); // Force reload to lobby
                 } else {
                      console.log("Sala cerrada, pero un modal está activo. Recarga pendiente.");
                      // Maybe force reload after modal timeout? For now, rely on user action.
                 }
            }
            // Clean up state if room disappears
            currentRoomId = null; currentPlayer = null; gameState = null; previousGameState = null;
            // Potentially detach listener here
            return; // Stop processing this update
        }

        // --- State Transition Logic ---
        console.log(`Actualización recibida para sala ${currentRoomId}, status: ${room.status}`);

        if (room.status === 'waiting') {
            // Check if we were previously in game or already waiting
            const waitingScreen = document.getElementById('waitingScreen');
             if (waitingScreen?.classList.contains('hidden')) {
                 // Transitioning TO waiting screen
                 console.log("Transición a pantalla de espera.");
                 showWaitingScreen(); // Ensure correct screen is shown
             }
             // Always update waiting screen info
             updateWaitingScreen(room);
             // Reset game-related state
             gameState = null;
             previousGameState = null;
             isAdvancing = false; // Reset flag

        } else if (room.status === 'playing' && room.game) {
            // Game is active
            previousGameState = gameState ? { ...gameState } : null; // Deep copy previous state if it existed
            gameState = room.game; // Update global state
            console.log("Estado del juego actualizado:", JSON.stringify(gameState));

            // --- Level Advancement Notification Logic (uses modal) ---
            if (previousGameState && typeof previousGameState.level === 'number' && gameState.level > previousGameState.level) {
                console.log(`>>> DETECTADO CAMBIO DE NIVEL: ${previousGameState.level} -> ${gameState.level}`);
                const completedLevel = previousGameState.level;
                const newLevel = gameState.level;
                const reward = LEVEL_REWARDS[completedLevel];
                let rewardGainedText = '';
                // Check if lives/stars actually increased vs previous state
                if (reward === 'life' && (gameState.lives > (previousGameState.lives ?? 0))) {
                    rewardGainedText = '+1 Vida ❤️';
                } else if (reward === 'star' && (gameState.stars > (previousGameState.stars ?? 0))) {
                    rewardGainedText += (rewardGainedText ? ' & ' : '') + '+1 Estrella ⭐'; // Combine rewards text
                }

                // Determine next reward text
                let nextRewardLevel = null;
                for (const level in LEVEL_REWARDS) {
                    if (parseInt(level) >= newLevel) { // Find first reward level >= new level
                        nextRewardLevel = level;
                        break;
                    }
                }
                const nextRewardText = nextRewardLevel
                    ? `${nextRewardLevel} (${LEVEL_REWARDS[nextRewardLevel] === 'life' ? 'Vida ❤️' : 'Estrella ⭐'})`
                    : null;

                 console.log(`>>> MOSTRANDO MODAL DE NIVEL ${completedLevel} COMPLETADO`);
                showLevelUpModal(completedLevel, newLevel, rewardGainedText, nextRewardText); // Call the modal function
            }
            // --- End Notification Logic ---

            // Ensure game screen is shown and update its UI
            if (document.getElementById('gameScreen')?.classList.contains('hidden')) {
                showGameScreen();
            }
            updateGameUI(); // Update UI with the latest gameState

        } else if (room.status === 'playing' && !room.game) {
             // State during reset transition (game removed before status flips to waiting)
             console.warn("Estado 'playing' pero sin objeto 'game'. Esperando reseteo a 'waiting'...");
             gameState = null; // Clear local state
             if (!document.getElementById('gameScreen')?.classList.contains('hidden')) {
                 updateGameUI(); // Update UI to show empty state
             }
        } else {
             console.log(`Estado de sala no manejado o inesperado: Status=${room.status}, Game Exists=${!!room.game}`);
        }
    }, (error) => {
         console.error(`Error crítico escuchando la sala ${currentRoomId}:`, error);
         alert("Error grave de conexión con la sala. La página se recargará.");
         // Force reload on critical listener error
         location.reload();
    });
}


/**
 * Updates the waiting screen UI with current player list and room info.
 */
function updateWaitingScreen(room) {
    const roomNameEl = document.getElementById('waitingRoomName');
    const playersListEl = document.getElementById('waitingPlayersList');
    const countEl = document.getElementById('waitingCount');
    const maxEl = document.getElementById('waitingMax');
    const startBtn = document.getElementById('startBtn');

    // Ensure elements exist before updating
    if (roomNameEl) roomNameEl.textContent = escapeHtml(room.name || 'Sala');

    const players = room.players ? Object.keys(room.players) : [];
    if (playersListEl) {
        playersListEl.innerHTML = players.map(p =>
            `<p>${escapeHtml(p)} ${p === room.host ? '👑' : ''}</p>`
        ).join('');
    }
    if (countEl) countEl.textContent = players.length;
    if (maxEl) maxEl.textContent = room.maxPlayers || '?'; // Default if missing

    // Enable start button only for the host when player count >= 2
    if (startBtn) {
        startBtn.disabled = !(currentPlayer === room.host && players.length >= 2);
    }
}


// ============================================
// STARTING THE GAME
// ============================================

/**
 * Initializes the game state when the host clicks "Start Game".
 */
async function startGameFromWaiting() {
     if (!database || !currentRoomId) { alert("Error: No conectado a una sala."); return; }
    try {
        console.log(`Intentando iniciar juego en sala ${currentRoomId}...`);
        isAdvancing = false; // Reset flags
        checkLevelTimeout = null;
        if (levelUpTimeoutId) clearTimeout(levelUpTimeoutId); // Clear any pending level up modal timeout
        levelUpTimeoutId = null;

        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();

        // Validate room, players, config, and host status
        if (!room || room.status !== 'waiting') {
             throw new Error('La sala no está esperando o no existe.');
        }
        if (currentPlayer !== room.host) {
             alert('Solo el host (👑) puede iniciar la partida.'); return;
        }
        if (!room.players || !room.config) {
            throw new Error('Faltan jugadores o configuración en la sala.');
        }
        const players = Object.keys(room.players);
        if (players.length < 2) {
             alert('Se necesitan al menos 2 jugadores para iniciar.'); return;
        }

        const deck = generateDeck();
        const hands = {};
        const initialCards = 1; // Level 1 starts with 1 card

        // Deal cards for level 1
        players.forEach(player => {
             const hand = [];
             for (let i = 0; i < initialCards; i++) {
                if (deck.length > 0) {
                     hand.push(deck.pop());
                 } else {
                      console.error("Mazo vacío al repartir nivel 1!"); break;
                 }
             }
             hands[player] = hand;
        });

        console.log('Manos iniciales:', JSON.stringify(hands));

        // Set the initial game state in Firebase using room's config
        await update(roomRef, {
            status: 'playing', // Change room status
            game: {
                level: 1,
                lives: room.config.lives, // Use config
                stars: room.config.stars, // Use config
                maxLevels: room.config.levels, // Use config
                deck: deck, // Store remaining deck
                hands: hands, // Store initial hands
                centralPile: [],
                discardedCards: [],
                starProposal: null, // Ensure null
                starVotes: {},
                gameOver: false,
                victory: false
            }
        });

        console.log('✓ Juego iniciado correctamente en Firebase.');
        // UI transition handled by onValue listener

    } catch (error) {
        console.error('ERROR CRÍTICO al iniciar juego:', error);
        alert(`Error al iniciar la partida: ${error.message}`);
    }
}

// ============================================
// GAME UI UPDATES
// ============================================

/**
 * Updates the game screen UI based on the current `gameState`.
 * Includes safety checks for missing elements or state.
 */
function updateGameUI() {
    try {
        // --- Header Info ---
        const livesDisplay = document.getElementById('livesDisplay');
        const levelDisplay = document.getElementById('levelDisplay');
        const starsDisplay = document.getElementById('starsDisplay');

        if (livesDisplay) livesDisplay.innerHTML = '❤️'.repeat(gameState?.lives ?? 0);
        if (levelDisplay) levelDisplay.textContent = gameState?.level ?? '?';
        if (starsDisplay) starsDisplay.innerHTML = '⭐'.repeat(gameState?.stars ?? 0);

        // --- Central Pile ---
        const centralPileEl = document.getElementById('centralPile');
        if (centralPileEl) {
            const centralPile = ensureArray(gameState?.centralPile);
            if (centralPile.length === 0) {
                centralPileEl.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
            } else {
                const lastCard = centralPile[centralPile.length - 1];
                centralPileEl.innerHTML = `<div class="text-8xl font-bold">${typeof lastCard === 'number' ? lastCard : '?'}</div>`;
            }
        }

        // --- Played Cards History ---
        const cardsPlayedList = document.getElementById('cardsPlayedList');
        if (cardsPlayedList) {
            const centralPile = ensureArray(gameState?.centralPile);
            cardsPlayedList.innerHTML = centralPile.filter(c => typeof c === 'number').map(card =>
                `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
            ).join('');
        }

        // --- Player Hand ---
        const handDiv = document.getElementById('playerHand');
        if (handDiv) {
            const currentHandValue = gameState?.hands?.[currentPlayer] ?? null;
            const myHand = ensureArray(currentHandValue);

            if (myHand.length === 0) {
                handDiv.innerHTML = '<p class="text-center opacity-60 py-8">No tienes cartas</p>';
            } else {
                const sortedHand = myHand.filter(c => typeof c === 'number').sort((a, b) => a - b);
                handDiv.innerHTML = sortedHand.map(card =>
                    `<button type="button" onclick="playCard(${card})"
                             class="bg-gradient-to-br from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 rounded-xl p-6 min-w-[100px] text-4xl font-bold transform transition hover:scale-110 shadow-xl">
                        ${card}
                    </button>`
                ).join('');
            }
        }

        // --- Star Controls ---
        updateStarControl(); // Update star buttons/status

        // --- Game Over Modal ---
        // Managed primarily by listenToRoom ensuring correct screen transitions
        // Hide explicitly if game state is definitively NOT game over
        const modal = document.getElementById('gameOverModal');
        if (modal && (!gameState || !gameState.gameOver)) {
             modal.classList.add('hidden');
        } else if (modal && gameState?.gameOver) {
             showGameOver(); // Ensure visibility if game is over
        }


    } catch (error) {
        console.error('ERROR en updateGameUI:', error);
    }
}


// ============================================
// PLAYING A CARD (CORE GAME LOGIC)
// ============================================

/**
 * Handles the logic when a player clicks on a card to play it.
 * Includes validation for explicit (card < last) and implicit (skipped lower card) errors.
 */
async function playCard(cardValue) {
    if (isAdvancing) { console.warn("Bloqueado: Avanzando nivel."); return; }
    if (typeof cardValue !== 'number' || cardValue < 1 || cardValue > 100) { console.error(`Intento de jugar carta inválida: ${cardValue}`); return; }
    if (!database || !currentRoomId) { console.error("playCard: No conectado a una sala."); return; }

    try {
        console.log(`\n=== INTENTO JUGAR CARTA ${cardValue} ===`);

        if (checkLevelTimeout) { clearTimeout(checkLevelTimeout); checkLevelTimeout = null; console.log("Verificación nivel anterior cancelada."); }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();

        if (!freshGame || freshGame.gameOver) { console.warn('❌ Juego no activo o ya terminado.'); return; }
        if (!freshGame.hands) {
             console.error('❌ Estado inválido: No hay objeto hands.'); return;
         }

        const myHandValue = freshGame.hands[currentPlayer] ?? null;
        const myHand = ensureArray(myHandValue);
        if (!myHand.includes(cardValue)) { console.warn(`❌ No tienes la carta ${cardValue}.`); updateGameUI(); return; }

        // --- VALIDATION 1: Explicit Error ---
        const centralPile = ensureArray(freshGame.centralPile);
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            if (typeof lastCard === 'number' && cardValue < lastCard) {
                console.error(`❌ ERROR EXPLÍCITO: ${cardValue} < ${lastCard}`);
                await handleError(cardValue, freshGame); return;
            }
        }

        // --- VALIDATION 2: Implicit Error ---
        let lowestRemainingCard = Infinity; // Start high
        let foundRemaining = false;
        Object.keys(freshGame.hands).forEach(player => {
            const hand = ensureArray(freshGame.hands[player]);
            const cardsToCheck = (player === currentPlayer) ? hand.filter(c => c !== cardValue) : hand;
            cardsToCheck.forEach(card => {
                 if (typeof card === 'number') {
                      foundRemaining = true;
                      if (card < lowestRemainingCard) {
                           lowestRemainingCard = card;
                      }
                 }
            });
        });
        console.log(`Chequeo Implícito - Carta más baja restante: ${foundRemaining ? lowestRemainingCard : 'Ninguna'}`);

        if (foundRemaining && cardValue > lowestRemainingCard) {
            console.error(`❌ ERROR IMPLÍCITO: ${cardValue} jugada, pero ${lowestRemainingCard} sigue en juego.`);
            await handleError(lowestRemainingCard, freshGame); return;
        }

        // --- PLAY IS VALID: Update Firebase ---
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];

        console.log(`Actualizando Firebase: ${currentPlayer} juega ${cardValue}. Mano restante: [${newHand.join(', ')}]`);
        await update(gameRef, {
            [`hands/${currentPlayer}`]: newHand.length > 0 ? newHand : null,
            centralPile: newPile
        });
        console.log(`✓ Carta ${cardValue} jugada correctamente`);

        // Schedule check for level completion
        checkLevelTimeout = setTimeout(() => { checkLevelComplete(); }, 2000);

    } catch (error) {
        console.error('ERROR en playCard:', error);
        if (error.message.includes("permission_denied")) alert("Error de permisos.");
    }
}


// ============================================
// CHECK LEVEL COMPLETE (STABLE VERSION)
// ============================================

/**
 * Checks if all players have empty hands to advance the level.
 * Reads the stable player list from /players, robust against Firebase removing keys for empty hands.
 */
async function checkLevelComplete() {
    if (isAdvancing || !checkLevelTimeout) {
        if (isAdvancing) console.log('CheckLevelComplete: Avance ya en progreso.');
        if (!checkLevelTimeout) console.log('CheckLevelComplete: Timeout consumido.');
        return;
    }
    console.log('\n--- Verificando si el nivel está completo (Estable) ---');
    checkLevelTimeout = null; // Mark consumed

    try {
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const checkGame = gameSnapshot.val();
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        if (!checkGame || checkGame.gameOver || !roomPlayers) {
            console.log('⚠️ Juego no válido, terminado, o sin jugadores.'); return;
        }

        const playerList = Object.keys(roomPlayers);
        let totalCards = 0;

        console.log('Contando cartas restantes:');
        for (const player of playerList) {
            const handValue = checkGame.hands ? checkGame.hands[player] : null;
            const hand = ensureArray(handValue);
            totalCards += hand.length;
            console.log(`  ${player}: ${hand.length} cartas`);
        }
        console.log(`Total de cartas restantes: ${totalCards}`);

        if (totalCards === 0) {
            if (!isAdvancing) {
                 console.log('✅ ¡Todas las manos vacías! Iniciando avance de nivel...');
                 await advanceLevel();
            } else {
                 console.log("⚠️ Nivel completo detectado, pero avance ya en marcha.");
            }
        } else {
            console.log('⏳ Nivel aún incompleto');
        }

    } catch (error) {
        console.error('ERROR CRÍTICO verificando nivel:', error);
    }
}


// ============================================
// HANDLE PLAYING ERROR
// ============================================

/**
 * Handles the logic when a card is played out of order (explicit or implicit error).
 * Reduces lives, discards cards <= error card, checks for Game Over, triggers room reset.
 */
async function handleError(errorCardRef, freshGame) {
     if (isAdvancing) { console.warn(`Error (ref ${errorCardRef}) durante avance, ignorando.`); return; }

    try {
        console.log(`\n=== MANEJANDO ERROR (carta referencia: ${errorCardRef}) ===`);

        if (!freshGame || typeof freshGame.lives !== 'number') { console.error("handleError: Estado inválido."); return; }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const newLives = freshGame.lives - 1;

        console.log(`Vidas: ${freshGame.lives} → ${newLives}`);

        // --- GAME OVER ---
        if (newLives <= 0) {
            console.log('💔 GAME OVER DETECTADO');
            await update(gameRef, { lives: 0, gameOver: true, victory: false });
            showGameOver(); // Show modal immediately
            console.log("Modal Game Over mostrado.");
            await new Promise(resolve => setTimeout(resolve, 4000)); // Delay
            console.log("Reseteando sala post Game Over...");
            await update(roomRef, { status: 'waiting', game: null });
            console.log("Sala reseteada.");
            return; // Stop
        }

        // --- CONTINUE GAME (LOSE LIFE & DISCARD) ---
        const updates = { lives: newLives };
        const discarded = ensureArray(freshGame.discardedCards);
        console.log(`Descartando cartas <= ${errorCardRef}`);

         const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
         const roomPlayers = playersSnapshot.val();
         if (!roomPlayers) { console.error("No se encontraron jugadores."); return; }
         const playerList = Object.keys(roomPlayers);

        playerList.forEach(player => {
             const handValue = freshGame.hands ? freshGame.hands[player] : null;
             const playerHand = ensureArray(handValue);
             const toDiscard = playerHand.filter(c => typeof c === 'number' && c <= errorCardRef);
             const newHand = playerHand.filter(c => typeof c === 'number' && c > errorCardRef);
             console.log(`  ${player}: Mano=[${playerHand.join(',')}], Descarta=[${toDiscard.join(',')}], Queda=[${newHand.join(',')}]`);
             if (toDiscard.length > 0) discarded.push(...toDiscard);
             updates[`hands/${player}`] = newHand.length > 0 ? newHand : null;
        });
        updates.discardedCards = discarded;

        await update(gameRef, updates);
        alert(`❌ ¡Error! Carta fuera de orden (ref: ${errorCardRef}).\nVidas restantes: ${newLives}\nCartas ≤${errorCardRef} descartadas.`);
        console.log('✓ Error manejado y estado actualizado.');

        // Check completion after discard
         if (checkLevelTimeout) clearTimeout(checkLevelTimeout);
        checkLevelTimeout = setTimeout(() => checkLevelComplete(), 1500);

    } catch (error) {
        console.error('ERROR CRÍTICO en handleError:', error);
        alert('Error grave al manejar el error: ' + error.message);
    }
}


// ============================================
// ADVANCE TO NEXT LEVEL
// ============================================

/**
 * Advances the game to the next level after successful completion.
 * Calculates rewards, deals new cards, handles victory, and resets room on win.
 */
async function advanceLevel() {
    if (isAdvancing) { console.log('⚠️ Avance ya en progreso.'); return; }
    isAdvancing = true;

    try {
        console.log('\n=== INICIANDO AVANCE DE NIVEL ===');

        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();

        if (!room || !room.game || !room.players) { throw new Error("Estado inválido."); }
        const currentGame = room.game;
        if (currentGame.gameOver) { console.warn("Juego ya terminado."); return; }

        const currentLevel = currentGame.level;
        const nextLevel = currentLevel + 1;
        console.log(`Nivel: ${currentLevel} → ${nextLevel} (Max: ${currentGame.maxLevels})`);

        // --- CHECK FOR VICTORY ---
        if (nextLevel > currentGame.maxLevels) {
            console.log('🎉 ¡VICTORIA!');
            const gameRef = ref(database, `rooms/${currentRoomId}/game`);
            await update(gameRef, { gameOver: true, victory: true });
            showGameOver(); // Show modal
            await new Promise(resolve => setTimeout(resolve, 4000)); // Delay
            console.log("Victoria: Reseteando sala...");
            await update(roomRef, { status: 'waiting', game: null });
            console.log("Sala reseteada.");
            return; // Stop
        }

        // --- CALCULATE REWARDS ---
        let newLives = currentGame.lives;
        let newStars = currentGame.stars;
        const reward = LEVEL_REWARDS[currentLevel];
        if (reward === 'life' && newLives < 5) { newLives++; console.log(`Recompensa: +1 ❤️`); }
        if (reward === 'star' && newStars < 3) { newStars++; console.log(`Recompensa: +1 ⭐`); }

        // --- DEAL NEW HANDS ---
        const deck = generateDeck();
        const hands = {};
        const players = Object.keys(room.players);
        console.log(`Repartiendo ${nextLevel} cartas...`);
        players.forEach(player => {
            const hand = [];
            for (let i = 0; i < nextLevel; i++) {
                if (deck.length > 0) hand.push(deck.pop());
                else { console.error("Mazo vacío!"); break; }
            }
            hands[player] = hand;
            console.log(`  ${player}: [${hand.sort((a,b)=>a-b).join(',')}]`);
        });

        // --- UPDATE FIREBASE ---
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        console.log('Actualizando Firebase...');
        await update(gameRef, {
            level: nextLevel, lives: newLives, stars: newStars, deck: deck, hands: hands,
            centralPile: [], discardedCards: [], starProposal: null, starVotes: {}
        });
        console.log('✓ Nivel actualizado.');
        // Alert handled by listener

    } catch (error) {
        console.error('ERROR CRÍTICO en advanceLevel:', error);
        alert('Error grave al avanzar de nivel: ' + error.message);
         try { // Attempt recovery
             await update(ref(database, `rooms/${currentRoomId}`), { status: 'waiting', game: null });
         } catch (resetError) { console.error("Error reseteando sala:", resetError); }
    } finally {
        isAdvancing = false;
        console.log('✓ Proceso avance finalizado.\n');
    }
}


// ============================================
// STAR MECHANICS
// ============================================

/**
 * Initiates a proposal to use a ninja star.
 */
async function proposeStar() {
     if (isAdvancing) { console.warn("Bloqueado: Avanzando nivel."); return; }
    try {
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const currentGame = gameSnapshot.val();

        if (!currentGame || currentGame.gameOver) { alert('Juego no activo.'); return; }
        if (currentGame.stars <= 0) { alert('No tienes estrellas.'); return; }
        if (currentGame.starProposal) { alert('Propuesta en curso.'); return; }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, { starProposal: currentPlayer, starVotes: { [currentPlayer]: true } });
        console.log(`${currentPlayer} propone usar estrella.`);
        checkStarVotes(); // Check if enough votes already
    } catch (error) { console.error('Error proponiendo estrella:', error); }
}

/**
 * Registers a "yes" vote for using a ninja star.
 */
async function voteStarYes() {
     if (isAdvancing) { console.warn("Bloqueado: Avanzando nivel."); return; }
    try {
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const currentGame = gameSnapshot.val();

         if (!currentGame || !currentGame.starProposal || currentGame.starVotes?.[currentPlayer]) {
              console.warn("No se puede votar sí."); return;
         }

        const voteRef = ref(database, `rooms/${currentRoomId}/game/starVotes/${currentPlayer}`);
        await set(voteRef, true);
        console.log(`${currentPlayer} votó SÍ.`);
        checkStarVotes(); // Check if vote completes
    } catch (error) { console.error('Error votando sí:', error); }
}

/**
 * Cancels the current star proposal.
 */
async function voteStarNo() {
     if (isAdvancing) { console.warn("Bloqueado: Avanzando nivel."); return; }
    try {
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const currentGame = gameSnapshot.val();

         if (!currentGame || !currentGame.starProposal) { console.warn("No hay propuesta."); return; }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, { starProposal: null, starVotes: {} });
        console.log(`${currentPlayer} votó NO, cancelando propuesta.`);
    } catch (error) { console.error('Error votando no:', error); }
}

/**
 * Checks if all players have voted "yes" to use the star.
 */
async function checkStarVotes() {
     if (isAdvancing) return;

    try {
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const freshGame = gameSnapshot.val();
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        if (!freshGame || !freshGame.starProposal || !roomPlayers) return;

        const playerList = Object.keys(roomPlayers);
        const votes = freshGame.starVotes || {};
        const voteCount = Object.keys(votes).length;

        console.log(`Votos estrella: ${voteCount}/${playerList.length}`);
        // Ensure all votes are explicitly true (though set() should handle this)
        const allYes = playerList.every(p => votes[p] === true);

        if (voteCount === playerList.length && allYes) {
            console.log("Todos votaron sí. Usando estrella...");
            if (!isAdvancing) await useStar(); // Prevent conflict
        } else if (voteCount === playerList.length && !allYes) {
             console.log("No todos votaron sí, la propuesta falla (implícitamente).");
             // Optional: Could reset proposal here if needed, but voteNo handles explicit cancel
        }

    } catch (error) { console.error('Error en checkStarVotes:', error); }
}

/**
 * Executes the star action: discards lowest card from each player's hand.
 */
async function useStar() {
     if (isAdvancing) { console.warn("Bloqueado: Avanzando nivel."); return; }

    try {
        console.log('\n=== USANDO ESTRELLA NINJA ===');
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();

        if (!freshGame || freshGame.stars <= 0 || freshGame.gameOver) {
             console.warn("No se puede usar estrella.");
             if (freshGame?.starProposal) await update(gameRef, { starProposal: null, starVotes: {} });
             return;
        }

        const updates = { stars: freshGame.stars - 1, starProposal: null, starVotes: {} };
        const discarded = ensureArray(freshGame.discardedCards);

        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();
        if (!roomPlayers) { console.error("No se encontraron jugadores."); return; }
        const playerList = Object.keys(roomPlayers);

        playerList.forEach(player => {
            const handValue = freshGame.hands ? freshGame.hands[player] : null;
            const hand = ensureArray(handValue);
            if (hand.length > 0) {
                const sorted = hand.filter(c=> typeof c === 'number').sort((a, b) => a - b);
                 if (sorted.length > 0) {
                     const lowest = sorted[0];
                     discarded.push(lowest);
                     const newHand = sorted.slice(1);
                     updates[`hands/${player}`] = newHand.length > 0 ? newHand : null; // Use null for empty
                     console.log(`  ${player}: descarta ${lowest}`);
                 } else {
                     console.log(`  ${player}: mano sin números válidos.`);
                     updates[`hands/${player}`] = null; // Clear invalid
                 }
            } else {
                 console.log(`  ${player}: mano vacía.`);
                 // Ensure key is null if it existed but was empty
                 if (freshGame.hands && freshGame.hands.hasOwnProperty(player)) {
                      updates[`hands/${player}`] = null;
                 }
            }
        });
        updates.discardedCards = discarded;

        await update(gameRef, updates);
        alert('⭐ ¡Estrella ninja usada!\nCada jugador descartó su carta más baja.');
        console.log('✓ Estrella usada.');

        // Clear and set timeout for level check
        if (checkLevelTimeout) clearTimeout(checkLevelTimeout);
        checkLevelTimeout = setTimeout(() => checkLevelComplete(), 1500);

    } catch (error) {
        console.error('ERROR en useStar:', error);
        alert('Error al usar estrella: ' + error.message);
    }
}

/**
 * Updates UI for star proposal/voting, using local gameState and async player count fetch.
 */
function updateStarControl() {
    // Check if game screen elements are present first
    const proposeBtn = document.getElementById('proposeStarBtn');
    if (!proposeBtn) return; // Exit silently if not on game screen

    const starVotesEl = document.getElementById('starVotes');
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');

    if (!starVotesEl || !starMessage || !starVoteStatus) {
         console.warn("updateStarControl: Elementos UI estrella no encontrados."); return;
    }
     // Use local gameState; exit if null
     if (!gameState || !currentRoomId) {
         proposeBtn.classList.add('hidden'); starVotesEl.classList.add('hidden'); proposeBtn.disabled = true;
         starMessage.textContent = ''; starVoteStatus.textContent = '';
         return;
     }

    // Determine conditions based on current gameState
    const hasStars = (gameState.stars ?? 0) > 0;
    const proposalActive = gameState.starProposal !== null && gameState.starProposal !== undefined;

    console.log(`updateStarControl: Has Stars=${hasStars}, Proposal Active=${proposalActive} (Proposer: ${gameState.starProposal}, Stars: ${gameState.stars})`);

    // Enable/disable propose button
    proposeBtn.disabled = !hasStars || proposalActive;

    if (proposalActive) {
        // Proposal is active: Show voting UI
        proposeBtn.classList.add('hidden');
        starVotesEl.classList.remove('hidden');
        starMessage.textContent = `${escapeHtml(gameState.starProposal || 'Alguien')} propone usar estrella`;

        const votes = gameState.starVotes || {};
        const voteCount = Object.keys(votes).length;

        // Estimate player count for immediate display
        let playerCountEstimate = 2; // Default
        if (previousGameState?.players) playerCountEstimate = Object.keys(previousGameState.players).length; // Use previous if available
        if (gameState.hands) playerCountEstimate = Math.max(playerCountEstimate, Object.keys(gameState.hands).length); // Refine with current hands
        starVoteStatus.textContent = `Votos: ${voteCount}/${playerCountEstimate}?`; // Show estimate

        // Fetch accurate player count asynchronously
        get(ref(database, `rooms/${currentRoomId}/players`)).then(snapshot => {
            const roomPlayers = snapshot.val();
            const actualPlayerCount = roomPlayers ? Object.keys(roomPlayers).length : playerCountEstimate;
            // IMPORTANT: Check GLOBAL gameState again inside the callback, as it might have changed
            if (gameState && gameState.starProposal) { // Only update if proposal is STILL active
                 starVoteStatus.textContent = `Votos: ${voteCount}/${actualPlayerCount}`;
            }
        }).catch(error => {
            console.error("Error fetching players for star status:", error);
            // Check GLOBAL gameState again
            if (gameState && gameState.starProposal) {
                 starVoteStatus.textContent = `Votos: ${voteCount}/?`;
            }
        });

        // Disable vote buttons if current player has already voted
        const yesBtn = starVotesEl.querySelector('button:first-child');
        const noBtn = starVotesEl.querySelector('button:last-child');
        if (yesBtn && noBtn) {
            const alreadyVoted = votes.hasOwnProperty(currentPlayer);
            yesBtn.disabled = alreadyVoted;
            noBtn.disabled = alreadyVoted;
        }

    } else {
        // No proposal active: Show propose button
        proposeBtn.classList.remove('hidden');
        starVotesEl.classList.add('hidden');
        starMessage.textContent = '¿Usar estrella ninja?';
        starVoteStatus.textContent = '';
    }
}


// ============================================
// LEAVE ROOM & GAME OVER DISPLAY
// ============================================

/**
 * Handles the player leaving the room gracefully by removing their data.
 */
async function leaveRoom() {
    try {
        console.log(`Intentando salir de la sala ${currentRoomId}...`);
        if (currentRoomId && currentPlayer) {
            const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
            // Cancel the onDisconnect handler FIRST to prevent race condition on manual leave
            onDisconnect(playerRef).cancel();
            console.log(`onDisconnect cancelado para ${currentPlayer}.`);
            await remove(playerRef); // Explicitly remove player data
            console.log(`Jugador ${currentPlayer} eliminado de Firebase.`);
        } else {
             console.log("No hay sala activa o jugador definido para salir.");
        }
    } catch (error) {
        console.error('Error al salir de la sala:', error);
        // Still attempt reload even if Firebase removal failed
    } finally {
        // Force reload to go back to lobby and ensure clean state, regardless of errors
        console.log("Recargando página para limpiar estado local...");
        currentRoomId = null; currentPlayer = null; gameState = null; previousGameState = null; // Clear local state vars
        location.reload();
    }
}

/**
 * Displays the Game Over / Victory modal based on the current `gameState`.
 */
function showGameOver() {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');

    // Ensure all modal elements are present
    if (!modal || !title || !message) {
         console.warn("showGameOver: Elementos del modal no encontrados."); return;
    }
     // Ensure gameState exists before trying to display info
     if (!gameState) {
          console.warn("showGameOver: gameState es nulo, no se puede mostrar modal.");
          modal.classList.add('hidden'); // Ensure hidden if state is missing
          return;
     }

    // Only show if game is actually marked as over
    if (gameState.gameOver) {
        modal.classList.remove('hidden'); // Make modal visible
        console.log("Mostrando modal - Game Over:", !gameState.victory, "Victoria:", !!gameState.victory);

        if (gameState.victory) {
            title.textContent = '🎉 ¡VICTORIA!';
            title.className = 'text-5xl font-bold mb-4 text-green-400'; // Apply styling
            message.textContent = `¡Completaron todos los ${gameState.maxLevels || '?'} niveles! ¡Son uno con la mente!`;
        } else {
            title.textContent = '💔 GAME OVER';
            title.className = 'text-5xl font-bold mb-4 text-red-400'; // Apply styling
            // Use current level if available, fallback safely
            const levelReached = gameState.level || previousGameState?.level || '?';
            message.textContent = `Llegaron hasta el nivel ${levelReached}. ¡Inténtenlo de nuevo!`;
        }
    } else {
         // Explicitly hide if game state somehow indicates not game over
         console.log("showGameOver: gameState.gameOver es falso, asegurando que el modal está oculto.");
         modal.classList.add('hidden');
    }
}

/**
 * Shows the level up modal with dynamic content and hides it after a delay.
 */
function showLevelUpModal(completedLevel, newLevel, rewardGainedText, nextRewardText) {
    const modal = document.getElementById('levelUpModal');
    const title = document.getElementById('levelUpTitle');
    const message = document.getElementById('levelUpMessage');
    const rewardGainedEl = document.getElementById('levelUpRewardGained'); // Corrected ID usage
    const nextRewardEl = document.getElementById('levelUpNextReward');   // Corrected ID usage
    const timerBar = document.getElementById('levelUpTimerBar');

    if (!modal || !title || !message || !rewardGainedEl || !nextRewardEl || !timerBar) {
        console.error("Error: Elementos del modal de avance de nivel no encontrados.");
        // Fallback to alert if modal elements are missing
        alert(`✅ ¡Nivel ${completedLevel} completado! ${rewardGainedText || ''}\n\nAvanzando al nivel ${newLevel}...`);
        return;
    }

    // Clear any previous timeout for this modal
    if (levelUpTimeoutId) {
        clearTimeout(levelUpTimeoutId);
        levelUpTimeoutId = null;
    }

    // Update modal content
    title.textContent = `¡NIVEL ${completedLevel} COMPLETADO!`;
    message.textContent = `¡Prepárense para el Nivel ${newLevel}!`;
    rewardGainedEl.textContent = rewardGainedText ? `Recompensa Ganada: ${rewardGainedText}` : "Sin recompensa este nivel.";
    nextRewardEl.textContent = nextRewardText ? `Próxima Recompensa: Nivel ${nextRewardText}` : "¡No quedan más recompensas!";

    // --- Animation Logic ---
    // Make visible and prepare for animation
    modal.classList.remove('hidden', 'opacity-0', 'scale-95');
    modal.classList.add('opacity-100', 'scale-100'); // Animate in

    // Reset and start timer bar animation
    timerBar.style.transition = 'none'; // Temporarily remove transition for reset
    timerBar.style.width = '100%';    // Set initial width
    // Force browser reflow to apply the reset width before starting transition
    void timerBar.offsetWidth;
    // Re-apply transition and animate to 0 width over 5 seconds
    timerBar.style.transition = 'width 5000ms linear';
    timerBar.style.width = '0%';

    // --- Auto-hide Logic ---
    levelUpTimeoutId = setTimeout(() => {
        // Start fade out animation
        modal.classList.remove('opacity-100', 'scale-100');
        modal.classList.add('opacity-0', 'scale-95');

        // Wait for fade out animation (500ms) to complete before hiding fully
        setTimeout(() => {
             modal.classList.add('hidden'); // Hide with display: none
             levelUpTimeoutId = null; // Clear timeout ID
             // Optional: Reset timer bar width if needed for next appearance
             // timerBar.style.transition = 'none';
             // timerBar.style.width = '100%';
        }, 500); // Must match the opacity transition duration

    }, 5000); // 5 seconds total display time
}


// ============================================
// INITIALIZE LOBBY LISTENER
// ============================================

// Ensure DOM is fully loaded before initializing Firebase listeners or accessing DOM elements
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Cargado. Inicializando script...");
    if (database) {
        // Start listening for available rooms in the lobby
        listenToRooms();
        console.log("Script inicializado. Escuchando salas.");
    } else {
         // Display critical error if Firebase failed to initialize
         console.error("Firebase no inicializado. La aplicación no puede continuar.");
         document.body.innerHTML = '<div class="flex items-center justify-center min-h-screen bg-red-900 text-white text-2xl p-8">Error Crítico: No se pudo conectar a la base de datos. Por favor, recarga la página o revisa la configuración de Firebase.</div>';
    }
});