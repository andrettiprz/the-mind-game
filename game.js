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
    measurementId: "G-8NTF0H3BH4" // Optional: Replace if using Analytics
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
        console.error('Elemento roomsList no encontrado en el DOM.');
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
            players: { [playerName]: { connected: true } }, // 'ready' not needed here
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
        if (!room || !room.players || typeof room.players !== 'object') {
             alert('Error: Datos de la sala inválidos.');
             currentRoomId = null; return;
        }


        // Check if room is full
        if (Object.keys(room.players).length >= (room.maxPlayers || 0)) {
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
}

/**
 * Switches the UI to the game screen, hiding others.
 */
function showGameScreen() {
    document.getElementById('waitingScreen')?.classList.add('hidden');
    document.getElementById('lobbyScreen')?.classList.add('hidden');
    document.getElementById('gameScreen')?.classList.remove('hidden');
    document.getElementById('gameOverModal')?.classList.add('hidden');
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

    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();

        // Handle room closure or unexpected deletion
        if (!room) {
            console.error(`La sala ${currentRoomId} ya no existe en Firebase.`);
            // Only alert/reload if user was actively in this room's context
            // Check if ANY screen other than lobby is visible
            const lobbyHidden = document.getElementById('lobbyScreen')?.classList.contains('hidden');
            if (currentRoomId && lobbyHidden) {
                 const modal = document.getElementById('gameOverModal');
                 if (!modal || modal.classList.contains('hidden')) { // Avoid double alert if modal shown
                     alert('La sala fue cerrada o ya no existe.');
                     location.reload(); // Force reload to lobby
                 }
            }
            // Clean up state if room disappears
            currentRoomId = null; currentPlayer = null; gameState = null; previousGameState = null;
            return; // Stop processing this update
        }

        // --- State Transition Logic ---
        console.log(`Actualización recibida para sala ${currentRoomId}, status: ${room.status}`);

        if (room.status === 'waiting') {
            // Check if we are currently in game or already waiting
            const waitingScreen = document.getElementById('waitingScreen');
             if (waitingScreen?.classList.contains('hidden')) {
                 // Transitioning from game/lobby TO waiting
                 console.log("Transición a pantalla de espera.");
                 showWaitingScreen();
             }
             // Always update waiting screen info
             updateWaitingScreen(room);
             // Reset game-related state
             gameState = null;
             previousGameState = null;
             isAdvancing = false; // Reset flag if returning to lobby

        } else if (room.status === 'playing' && room.game) {
            // Game is active
            previousGameState = gameState; // Store previous state for comparison
            gameState = room.game; // Update global state
            console.log("Estado del juego actualizado:", JSON.stringify(gameState)); // Log new state

            // --- Level Advancement Notification Logic ---
            if (previousGameState && gameState.level > previousGameState.level) {
                console.log(`>>> DETECTADO CAMBIO DE NIVEL: ${previousGameState.level} -> ${gameState.level}`);
                const completedLevel = previousGameState.level;
                const reward = LEVEL_REWARDS[completedLevel];
                let rewardText = '';
                // Check if lives/stars actually increased (more reliable than just checking reward type)
                if (reward === 'life' && (gameState.lives > previousGameState.lives)) {
                    rewardText = '\n¡+1 ❤️!';
                } else if (reward === 'star' && (gameState.stars > previousGameState.stars)) {
                    // Combine rewards text if both happen (e.g. if rules change)
                    rewardText += '\n¡+1 ⭐!';
                }
                // Show level up alert on ALL clients (runs inside onValue)
                 console.log(`>>> MOSTRANDO ALERTA DE NIVEL ${completedLevel} COMPLETADO`);
                alert(`✅ ¡Nivel ${completedLevel} completado!${rewardText}\n\nAvanzando al nivel ${gameState.level}...`);
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
             // Clear local state and update UI to reflect empty game
             gameState = null;
             if (!document.getElementById('gameScreen')?.classList.contains('hidden')) {
                 updateGameUI(); // Update UI to show empty state
             }
        } else {
             console.log(`Estado de sala no manejado o inesperado: ${room.status}, game exists: ${!!room.game}`);
        }
    }, (error) => {
         console.error(`Error escuchando la sala ${currentRoomId}:`, error);
         alert("Error de conexión con la sala. Intenta recargar la página.");
         // Potentially force reload or redirect
         // location.reload();
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
            // Sanitize player names
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
        isAdvancing = false; // Reset any lingering advance flag

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

        // Deal 1 card to each player for level 1
        players.forEach(player => {
             if (deck.length > 0) {
                 hands[player] = [deck.pop()];
             } else {
                  console.error("Mazo vacío al repartir nivel 1!"); // Should be impossible
                  hands[player] = [];
             }
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
                starProposal: null,
                starVotes: {},
                gameOver: false,
                victory: false
            }
        });

        console.log('✓ Juego iniciado correctamente en Firebase.');
        // UI transition is handled by the onValue listener reacting to status change

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

        // Use optional chaining (?.) and nullish coalescing (??) for safety
        if (livesDisplay) livesDisplay.innerHTML = '❤️'.repeat(gameState?.lives ?? 0);
        if (levelDisplay) levelDisplay.textContent = gameState?.level ?? '?'; // Show '?' if level missing
        if (starsDisplay) starsDisplay.innerHTML = '⭐'.repeat(gameState?.stars ?? 0);

        // --- Central Pile ---
        const centralPileEl = document.getElementById('centralPile');
        if (centralPileEl) {
            const centralPile = ensureArray(gameState?.centralPile);
            if (centralPile.length === 0) {
                centralPileEl.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
            } else {
                const lastCard = centralPile[centralPile.length - 1];
                // Ensure lastCard is a number before displaying
                centralPileEl.innerHTML = `<div class="text-8xl font-bold">${typeof lastCard === 'number' ? lastCard : '?'}</div>`;
            }
        }

        // --- Played Cards History ---
        const cardsPlayedList = document.getElementById('cardsPlayedList');
        if (cardsPlayedList) {
            const centralPile = ensureArray(gameState?.centralPile);
            // Filter out non-numeric values just in case
            cardsPlayedList.innerHTML = centralPile.filter(c => typeof c === 'number').map(card =>
                `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
            ).join('');
        }

        // --- Player Hand ---
        const handDiv = document.getElementById('playerHand');
        if (handDiv) {
            // Safely access hand, defaulting to null if hands object doesn't exist or player key missing
            const currentHandValue = gameState?.hands?.[currentPlayer] ?? null;
            const myHand = ensureArray(currentHandValue); // Handles null value correctly

            if (myHand.length === 0) {
                handDiv.innerHTML = '<p class="text-center opacity-60 py-8">No tienes cartas</p>';
            } else {
                // Ensure all items are numbers before sorting and displaying
                const sortedHand = myHand.filter(c => typeof c === 'number').sort((a, b) => a - b);
                handDiv.innerHTML = sortedHand.map(card =>
                    // Use type="button" for buttons inside potential forms
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
        const modal = document.getElementById('gameOverModal');
        if (modal) {
             if (gameState?.gameOver) {
                 showGameOver(); // Ensure modal is shown if game state indicates game over
             } else {
                 modal.classList.add('hidden'); // Ensure modal is hidden otherwise
             }
        }

    } catch (error) {
        console.error('ERROR en updateGameUI:', error);
        // Avoid alerting here to prevent UI spam if state is temporarily inconsistent
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
    // Prevent action if advancing level or invalid card value
    if (isAdvancing) {
        console.warn("Acción bloqueada: Avanzando de nivel."); return;
    }
    if (typeof cardValue !== 'number' || cardValue < 1 || cardValue > 100) {
         console.error(`Intento de jugar carta inválida: ${cardValue}`); return;
    }
     if (!database || !currentRoomId) { console.error("playCard: No conectado a una sala."); return; }


    try {
        console.log(`\n=== INTENTO JUGAR CARTA ${cardValue} ===`);

        // Cancel any pending level completion check from previous plays
        if (checkLevelTimeout) {
            clearTimeout(checkLevelTimeout);
            checkLevelTimeout = null;
            console.log("Verificación de nivel anterior cancelada.");
        }

        // Get the most recent game state directly from Firebase
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();

        // --- Pre-play Validations ---
        if (!freshGame || freshGame.gameOver) {
            console.warn('❌ Juego no activo o ya terminado.'); return; // Exit silently
        }
        // Ensure hands object exists (or game is invalid)
        if (!freshGame.hands) {
             // It's possible hands becomes null if all players finish simultaneously before level advances
             // Check if pile length matches expected cards for the level to confirm this edge case
             const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
             const roomPlayers = playersSnapshot.val();
             const expectedCards = (roomPlayers ? Object.keys(roomPlayers).length : 0) * (freshGame.level || 1);
             const pileLength = ensureArray(freshGame.centralPile).length;

             if (pileLength === expectedCards) {
                 console.log("Manos no encontradas, pero todas las cartas parecen jugadas. Esperando avance de nivel.");
                 // Schedule check just in case something stalled
                 if (!checkLevelTimeout && !isAdvancing) {
                      checkLevelTimeout = setTimeout(() => checkLevelComplete(), 500);
                 }
                 return; // Don't proceed with card play
             } else {
                 console.error('❌ Estado inválido: No hay objeto hands y no todas las cartas jugadas.');
                 return; // Exit - state is broken
             }
         }

        // Verify the player has the card (check against fresh state)
        // Safely access player's hand, might be null if Firebase removed it
        const myHandValue = freshGame.hands[currentPlayer] ?? null;
        const myHand = ensureArray(myHandValue);
        if (!myHand.includes(cardValue)) {
            console.warn(`❌ No tienes la carta ${cardValue} (o ya fue jugada/descartada).`);
            // Refresh UI just in case it was a visual glitch
            updateGameUI();
            return; // Exit silently
        }

        // --- VALIDATION 1: Explicit Error (Card < Last Played) ---
        const centralPile = ensureArray(freshGame.centralPile);
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            // Ensure lastCard is a number before comparison
            if (typeof lastCard === 'number' && cardValue < lastCard) {
                console.error(`❌ ERROR EXPLÍCITO: ${cardValue} < ${lastCard}`);
                await handleError(cardValue, freshGame); // Handle error based on the card played
                return; // Stop execution
            }
        }

        // --- VALIDATION 2: Implicit Error (Skipped a Lower Card still in anyone's hand) ---
        let allRemainingCards = [];
        // Iterate through players listed in hands ONLY (ignore players with null/empty hands)
        Object.keys(freshGame.hands).forEach(player => {
             const handValue = freshGame.hands[player]; // Can be null here
            const hand = ensureArray(handValue);
            if (hand.length === 0) return; // Skip players with empty/null hand

            // Exclude the card *about to be played* only from the current player's hand
            const cardsToCheck = (player === currentPlayer)
                ? hand.filter(c => c !== cardValue)
                : hand;
             // Only add valid numbers
            allRemainingCards.push(...cardsToCheck.filter(c => typeof c === 'number'));
        });
        console.log("Chequeo Implícito - Cartas restantes:", JSON.stringify(allRemainingCards));

        if (allRemainingCards.length > 0) {
            const lowestRemainingCard = Math.min(...allRemainingCards);
            console.log("Chequeo Implícito - Carta más baja restante:", lowestRemainingCard);

            // If the card being played is greater than the lowest card remaining elsewhere
            if (cardValue > lowestRemainingCard) {
                console.error(`❌ ERROR IMPLÍCITO: ${cardValue} jugada, pero ${lowestRemainingCard} sigue en juego.`);
                // CRITICAL: Call handleError with the card that *should* have been played
                await handleError(lowestRemainingCard, freshGame);
                return; // Stop execution
            }
        } else {
             console.log("Chequeo Implícito - No quedan otras cartas activas (o esta es la última).");
        }


        // --- PLAY IS VALID: Update Firebase ---
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];

        console.log(`Actualizando Firebase: ${currentPlayer} juega ${cardValue}. Mano restante: [${newHand.join(', ')}]`);
        await update(gameRef, {
            // Use null to explicitly remove the player's key if the hand becomes empty
            [`hands/${currentPlayer}`]: newHand.length > 0 ? newHand : null,
            centralPile: newPile
        });

        console.log(`✓ Carta ${cardValue} jugada correctamente`);

        // Schedule a check for level completion after a delay
        // Check if this card play might have emptied all hands IMMEDIATELY
        // Get player list again for accurate count
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayersNow = playersSnapshot.val();
        const expectedCardsNow = (roomPlayersNow ? Object.keys(roomPlayersNow).length : 0) * (freshGame.level || 1);

        if (newPile.length === expectedCardsNow && !isAdvancing) {
             console.log("Parece que esta fue la última carta del nivel. Verificando inmediatamente...");
             // Check immediately AND schedule a delayed check as backup
             checkLevelComplete();
             if (!checkLevelTimeout) { // If immediate check didn't start advance, schedule backup
                  checkLevelTimeout = setTimeout(() => checkLevelComplete(), 1500);
             }
        } else {
             // Schedule the normal delayed check
             checkLevelTimeout = setTimeout(() => {
                  checkLevelComplete(); // Call the stable checking function
             }, 2000); // 2-second delay
        }


    } catch (error) {
        console.error('ERROR CRÍTICO en playCard:', error);
        if (error.message.includes("permission_denied")) {
             alert("Error de permisos con Firebase. Intenta recargar la página.");
        }
        // Avoid generic alert, rely on console logs primarily
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
    // Prevent check if already advancing or timeout was cleared elsewhere
    if (isAdvancing || !checkLevelTimeout) {
        if (isAdvancing) console.log('CheckLevelComplete: Avance ya en progreso, chequeo ignorado.');
        if (!checkLevelTimeout) console.log('CheckLevelComplete: Timeout ya consumido/cancelado, chequeo ignorado.');
        return;
    }
    console.log('\n--- Verificando si el nivel está completo (Estable) ---');
    checkLevelTimeout = null; // Mark timeout as consumed immediately

    try {
        // 1. Get current game state
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const checkGame = gameSnapshot.val();

        // 2. Get stable player list from /players
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        // Exit conditions: Game over, invalid state, or no players found
        if (!checkGame || checkGame.gameOver || !roomPlayers) {
            console.log('⚠️ Juego no válido, terminado, o sin jugadores para verificar.');
            return; // Don't proceed if game ended or data is missing
        }

        const playerList = Object.keys(roomPlayers);
        let totalCards = 0;

        // 3. Iterate through STABLE player list and count remaining cards
        console.log('Contando cartas restantes:');
        for (const player of playerList) {
            // Safely check hand in game state (might be null/undefined if Firebase removed key)
            const handValue = checkGame.hands ? checkGame.hands[player] : null;
            const hand = ensureArray(handValue); // ensureArray handles null/undefined => []
            totalCards += hand.length;
            console.log(`  ${player}: ${hand.length} cartas`);
        }

        console.log(`Total de cartas restantes: ${totalCards}`);

        // 4. Advance level ONLY if total cards is zero
        if (totalCards === 0) {
             // Double-check isAdvancing flag *just before* calling advanceLevel
            if (!isAdvancing) {
                 console.log('✅ ¡Todas las manos vacías! Iniciando avance de nivel...');
                 await advanceLevel(); // Call the advance level function
            } else {
                 console.log("⚠️ Detectado nivel completo, pero el avance ya está en marcha por otra instancia.");
            }
        } else {
            console.log('⏳ Nivel aún incompleto');
        }

    } catch (error) {
        console.error('ERROR CRÍTICO verificando nivel:', error);
        // Maybe alert user if check fails critically?
        // alert("Error al verificar el estado del juego.");
    }
}


// ============================================
// HANDLE PLAYING ERROR
// ============================================

/**
 * Handles the logic when a card is played out of order (explicit or implicit error).
 * Reduces lives, discards cards <= error card, checks for Game Over, and triggers room reset.
 */
async function handleError(errorCardRef, freshGame) {
     // Prevent handling error if already advancing level (can cause race conditions)
     if (isAdvancing) {
          console.warn(`Error (ref ${errorCardRef}) detectado durante avance de nivel, ignorando manejo.`);
          return;
     }

    try {
        console.log(`\n=== MANEJANDO ERROR (carta referencia: ${errorCardRef}) ===`);

        // Ensure freshGame is valid
        if (!freshGame || typeof freshGame.lives !== 'number') {
             console.error("handleError: Estado de juego inválido recibido.");
             return; // Cannot proceed
        }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const roomRef = ref(database, `rooms/${currentRoomId}`); // Room reference for game over reset
        const newLives = freshGame.lives - 1;

        console.log(`Vidas: ${freshGame.lives} → ${newLives}`);

        // --- GAME OVER ---
        if (newLives <= 0) {
            console.log('💔 GAME OVER DETECTADO');
            // Mark game over in Firebase FIRST
            await update(gameRef, {
                lives: 0,
                gameOver: true,
                victory: false
            });

            // Trigger modal display immediately based on state change
            showGameOver(); // Make sure modal shows now
            console.log("Modal de Game Over mostrado.");
            // Wait AFTER showing modal
            await new Promise(resolve => setTimeout(resolve, 4000)); // Delay for viewing modal

            // Reset room state to waiting, clearing the game object
            console.log("Reseteando sala a 'waiting' post Game Over...");
            await update(roomRef, {
                status: 'waiting',
                game: null // Remove game object
            });

            console.log("Sala reseteada.");
            // The onValue listener in listenToRoom will handle UI change back to waiting screen
            return; // Stop execution here
        }

        // --- CONTINUE GAME (LOSE LIFE & DISCARD) ---
        const updates = { lives: newLives };
        const discarded = ensureArray(freshGame.discardedCards); // Ensure discarded is array

        console.log(`Descartando cartas <= ${errorCardRef}`);
        // Need the player list to ensure all hands are checked, even if Firebase removed keys
         const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
         const roomPlayers = playersSnapshot.val();
         if (!roomPlayers) {
              console.error("handleError: No se encontraron jugadores para descartar.");
              return; // Cannot proceed
         }
         const playerList = Object.keys(roomPlayers);

        // Iterate through the STABLE player list
        playerList.forEach(player => {
             const handValue = freshGame.hands ? freshGame.hands[player] : null; // Safely check hand
             const playerHand = ensureArray(handValue);

            // Filter cards to discard (<= error reference card)
            const toDiscard = playerHand.filter(c => typeof c === 'number' && c <= errorCardRef);
            // Filter cards to keep (> error reference card)
            const newHand = playerHand.filter(c => typeof c === 'number' && c > errorCardRef);

            console.log(`  ${player}: Mano=[${playerHand.join(', ')}], Descarta=[${toDiscard.join(', ')}], Queda=[${newHand.join(', ')}]`);

            if (toDiscard.length > 0) {
                 discarded.push(...toDiscard);
            }
             // Update the hand for this player in the 'updates' object
             // Send null to Firebase to remove the key if the hand becomes empty
             updates[`hands/${player}`] = newHand.length > 0 ? newHand : null;
        });

        updates.discardedCards = discarded; // Add all discarded cards

        // Apply updates to Firebase
        await update(gameRef, updates);
        alert(`❌ ¡Error! Carta fuera de orden (ref: ${errorCardRef}).\n\nVidas restantes: ${newLives}\nCartas ≤${errorCardRef} descartadas.`);

        console.log('✓ Error manejado y estado actualizado en Firebase.');

        // Check if level might be complete *after* discarding cards due to error
        // Clear any pending check first to avoid race conditions
         if (checkLevelTimeout) {
             clearTimeout(checkLevelTimeout);
             checkLevelTimeout = null;
         }
        // Schedule a new check
        checkLevelTimeout = setTimeout(() => checkLevelComplete(), 1500); // Check completion after error handling updates sync

    } catch (error) {
        console.error('ERROR CRÍTICO en handleError:', error);
        alert('Error grave al manejar el error del juego: ' + error.message);
        // Consider reloading or taking other recovery actions if this fails
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
    // Double check flag at the very start to prevent race conditions
    if (isAdvancing) {
        console.log('⚠️ Avance ya en progreso, abortando llamada duplicada.');
        return;
    }
    isAdvancing = true; // Set flag immediately

    try {
        console.log('\n=== INICIANDO AVANCE DE NIVEL ===');

        // Get fresh room and game state together
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();

        // Validate state before proceeding
        if (!room || !room.game || !room.players) {
            console.error('❌ Estado inválido para avanzar nivel (sala/juego/jugadores no encontrados).');
            throw new Error("Estado inválido para avanzar."); // Throw to trigger finally block correctly
        }

        const currentGame = room.game;
        // Ensure game isn't already over (might have happened between check and now)
        if (currentGame.gameOver) {
             console.warn("Intentando avanzar nivel, pero el juego ya terminó.");
             // No need to release flag here, finally block does it.
             return; // Just exit
        }

        const currentLevel = currentGame.level;
        const nextLevel = currentLevel + 1;

        console.log(`Nivel actual: ${currentLevel}, Próximo nivel: ${nextLevel} (Máximo: ${currentGame.maxLevels})`);

        // --- CHECK FOR VICTORY ---
        if (nextLevel > currentGame.maxLevels) {
            console.log('🎉 ¡VICTORIA ALCANZADA!');
            const gameRef = ref(database, `rooms/${currentRoomId}/game`);

            // Mark victory in Firebase
            await update(gameRef, {
                gameOver: true,
                victory: true
            });

            // Trigger modal display immediately (state change will handle it via onValue)
            showGameOver(); // Ensure modal shows based on new state
            console.log("Modal de Victoria mostrado.");
            await new Promise(resolve => setTimeout(resolve, 4000)); // Delay for viewing

            // Reset room state to waiting
            console.log("Victoria: Reseteando sala a 'waiting'...");
            await update(roomRef, {
                status: 'waiting',
                game: null // Remove game object
            });
            console.log("Sala reseteada post-victoria.");
            // onValue listener handles UI change back to waiting screen
             // No need to release flag here, finally block does it.
            return; // Stop execution for victory
        }

        // --- CALCULATE REWARDS ---
        let newLives = currentGame.lives;
        let newStars = currentGame.stars;
        // rewardText is now handled solely by the onValue listener
        const reward = LEVEL_REWARDS[currentLevel];

        if (reward === 'life' && newLives < 5) { // Assuming max 5 lives
            newLives++;
            console.log(`Recompensa: +1 ❤️ (total: ${newLives})`);
        }
        if (reward === 'star' && newStars < 3) { // Assuming max 3 stars
            newStars++;
            console.log(`Recompensa: +1 ⭐ (total: ${newStars})`);
        }

        // --- DEAL NEW HANDS ---
        const deck = generateDeck();
        const hands = {};
        const players = Object.keys(room.players); // Use stable player list from room

        console.log(`Repartiendo ${nextLevel} cartas a ${players.length} jugadores`);

        players.forEach(player => {
            const hand = [];
            for (let i = 0; i < nextLevel; i++) {
                if (deck.length > 0) {
                    hand.push(deck.pop());
                } else {
                     console.error("¡Mazo vacío durante el reparto!"); break;
                }
            }
             // Store hand (Firebase handles empty array vs null based on update below)
            hands[player] = hand; // Assign the dealt hand
            console.log(`  ${player}: [${hand.sort((a, b) => a - b).join(', ')}]`);
        });

        // --- UPDATE FIREBASE (Single atomic update for the entire next level state) ---
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        console.log('Actualizando Firebase con el estado del nuevo nivel...');

        await update(gameRef, {
            level: nextLevel,
            lives: newLives,
            stars: newStars,
            deck: deck, // Remaining deck
            hands: hands, // New hands structure
            centralPile: [], // Reset pile
            discardedCards: [], // Reset discards
            starProposal: null, // Reset star proposal
            starVotes: {} // Reset votes
            // No need to set gameOver/victory false explicitly if they weren't true
        });

        console.log('✓ Estado del nivel actualizado correctamente en Firebase.');
        // Alert for level completion is handled by the onValue listener in listenToRoom

    } catch (error) {
        console.error('ERROR CRÍTICO en advanceLevel:', error);
        alert('Error grave al avanzar de nivel: ' + error.message);
        // Consider if room should be reset on critical failure
        // Maybe try resetting status?
         try {
             await update(ref(database, `rooms/${currentRoomId}`), { status: 'waiting', game: null });
         } catch (resetError) {
             console.error("Error intentando resetear la sala:", resetError);
         }
    } finally {
        isAdvancing = false; // ALWAYS release the flag
        console.log('✓ Proceso de avance de nivel finalizado (éxito o fallo).\n');
    }
}


// ============================================
// STAR MECHANICS (Simplified, Non-async updateStarControl)
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
        await update(gameRef, {
            starProposal: currentPlayer,
            starVotes: { [currentPlayer]: true } // Proposer votes yes automatically
        });
        console.log(`${currentPlayer} propone usar estrella.`);
        checkStarVotes(); // Check if this vote is enough (e.g., 2 players)
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

         if (!currentGame || !currentGame.starProposal || (currentGame.starVotes && currentGame.starVotes[currentPlayer])) {
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
        if (voteCount === playerList.length) {
            console.log("Todos votaron sí. Usando estrella...");
            // Double check isAdvancing flag before calling useStar
            if (!isAdvancing) await useStar();
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
             // Clean up proposal state just in case
             if (freshGame?.starProposal) await update(gameRef, { starProposal: null, starVotes: {} });
             return;
        }

        const updates = { stars: freshGame.stars - 1, starProposal: null, starVotes: {} };
        const discarded = ensureArray(freshGame.discardedCards);

        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();
        if (!roomPlayers) { console.error("useStar: No se encontraron jugadores."); return; }
        const playerList = Object.keys(roomPlayers);

        playerList.forEach(player => {
            // Safely access hand, could be null
            const handValue = freshGame.hands ? freshGame.hands[player] : null;
            const hand = ensureArray(handValue);
            if (hand.length > 0) {
                const sorted = hand.filter(c => typeof c === 'number').sort((a, b) => a - b); // Filter non-numbers before sort
                 if (sorted.length > 0) {
                    const lowest = sorted[0];
                    discarded.push(lowest);
                    const newHand = sorted.slice(1);
                    updates[`hands/${player}`] = newHand.length > 0 ? newHand : null; // Use null for empty
                    console.log(`  ${player}: descarta ${lowest}`);
                 } else {
                      console.log(`  ${player}: mano no contiene números válidos.`);
                      updates[`hands/${player}`] = null; // Clear invalid hand data
                 }

            } else {
                 console.log(`  ${player}: mano vacía o nula`);
                 // Ensure key is set to null if it existed but was empty/invalid
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
 * Updates UI for star proposal/voting, fetching player count asynchronously.
 * This function is NOT async to avoid blocking updateGameUI.
 */
function updateStarControl() {
    // Check if game screen elements are present
    const proposeBtn = document.getElementById('proposeStarBtn');
    if (!proposeBtn) return; // Exit if not on game screen

    const starVotesEl = document.getElementById('starVotes');
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');

    if (!starVotesEl || !starMessage || !starVoteStatus) {
         console.warn("updateStarControl: Elementos UI no encontrados.");
         return;
    }
     // Ensure gameState exists
     if (!gameState || !currentRoomId) {
         // Hide star controls if no game state
         proposeBtn.classList.add('hidden');
         starVotesEl.classList.add('hidden');
         starMessage.textContent = '';
         starVoteStatus.textContent = '';
         return;
     }

    // Disable proposal based on local state
    proposeBtn.disabled = gameState.stars <= 0 || gameState.starProposal !== null;

    if (gameState.starProposal) {
        proposeBtn.classList.add('hidden');
        starVotesEl.classList.remove('hidden');
        starMessage.textContent = `${escapeHtml(gameState.starProposal)} propone usar estrella`;

        const votes = gameState.starVotes || {};
        const voteCount = Object.keys(votes).length;
        // Estimate player count initially
        let playerCountEstimate = 2; // Default estimate
        if (previousGameState?.players) playerCountEstimate = Object.keys(previousGameState.players).length;
        if (gameState?.hands) playerCountEstimate = Math.max(playerCountEstimate, Object.keys(gameState.hands).length);

        starVoteStatus.textContent = `Votos: ${voteCount}/${playerCountEstimate}?`; // Show estimate

        // Fetch accurate count asynchronously
        get(ref(database, `rooms/${currentRoomId}/players`)).then(snapshot => {
            const roomPlayers = snapshot.val();
            const actualPlayerCount = roomPlayers ? Object.keys(roomPlayers).length : playerCountEstimate;
            // Check current gameState again, proposal might have changed
            if (gameState && gameState.starProposal) {
                 starVoteStatus.textContent = `Votos: ${voteCount}/${actualPlayerCount}`;
            }
        }).catch(error => {
            console.error("Error fetching players for star status:", error);
            if (gameState && gameState.starProposal) {
                 starVoteStatus.textContent = `Votos: ${voteCount}/?`;
            }
        });

        // Disable buttons if already voted (based on local state)
        const yesBtn = starVotesEl.querySelector('button:first-child');
        const noBtn = starVotesEl.querySelector('button:last-child');
        if (yesBtn && noBtn) {
            const alreadyVoted = votes.hasOwnProperty(currentPlayer); // More reliable check
            yesBtn.disabled = alreadyVoted;
            noBtn.disabled = alreadyVoted;
        }

    } else {
        // No active proposal
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
 * Handles the player leaving the room gracefully.
 */
async function leaveRoom() {
    try {
        console.log(`Intentando salir de la sala ${currentRoomId}...`);
        if (currentRoomId && currentPlayer) {
            const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
            // Cancel onDisconnect locally BEFORE removing
            onDisconnect(playerRef).cancel();
            console.log(`onDisconnect cancelado para ${currentPlayer}.`);
            await remove(playerRef); // Explicit removal
            console.log(`Jugador ${currentPlayer} eliminado de Firebase.`);
        } else {
             console.log("No hay sala activa o jugador definido.");
        }
    } catch (error) {
        console.error('Error al salir de la sala:', error);
        // Still attempt reload even if Firebase removal failed
    } finally {
        // Force reload to go back to lobby and clean up ALL local state
        console.log("Recargando página para limpiar estado...");
        currentRoomId = null; currentPlayer = null; gameState = null; previousGameState = null; // Clear local state vars
        location.reload();
    }
}

/**
 * Displays the Game Over / Victory modal based on `gameState`.
 */
function showGameOver() {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');

    if (!modal || !title || !message) {
         console.warn("showGameOver: Elementos del modal no encontrados."); return;
    }
     // Ensure gameState exists
     if (!gameState) {
          console.warn("showGameOver: gameState es nulo.");
          modal.classList.add('hidden'); return;
     }

    // Only show if game is actually over
    if (gameState.gameOver) {
        modal.classList.remove('hidden'); // Make modal visible
        console.log("Mostrando modal - Game Over:", !gameState.victory, "Victoria:", gameState.victory);

        if (gameState.victory) {
            title.textContent = '🎉 ¡VICTORIA!';
            title.className = 'text-5xl font-bold mb-4 text-green-400';
            message.textContent = `¡Completaron todos los ${gameState.maxLevels || '?'} niveles! ¡Son uno con la mente!`;
        } else {
            title.textContent = '💔 GAME OVER';
            title.className = 'text-5xl font-bold mb-4 text-red-400';
            // Use current level if available, otherwise fallback to previous, then '?'
            const levelReached = gameState.level || previousGameState?.level || '?';
            message.textContent = `Llegaron hasta el nivel ${levelReached}. ¡Inténtenlo de nuevo!`;
        }
    } else {
         // Explicitly hide if game state indicates not game over
         console.log("showGameOver: gameState.gameOver es false, ocultando modal.");
         modal.classList.add('hidden');
    }
}


// ============================================
// INITIALIZE LOBBY LISTENER
// ============================================

// Wrap initialization in DOMContentLoaded to ensure elements are ready
document.addEventListener('DOMContentLoaded', () => {
    if (database) {
        // Check if user is already in a room (e.g., page refresh) - Needs logic to rejoin or go to lobby
        // For now, start by listening to all rooms (lobby view)
        listenToRooms();
        console.log("Game script loaded. Listening for rooms.");
    } else {
         console.error("Firebase no inicializado. La aplicación no funcionará.");
         // Display a permanent error message covering the body
         document.body.innerHTML = '<div class="flex items-center justify-center min-h-screen bg-red-900 text-white text-2xl p-8">Error Crítico: No se pudo conectar a la base de datos. Por favor, recarga la página o revisa la configuración de Firebase.</div>';
    }
});