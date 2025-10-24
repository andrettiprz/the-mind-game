// Import Firebase v9 modular SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ============================================
// FIREBASE CONFIG & INITIALIZATION
// ============================================

const firebaseConfig = {
    apiKey: "AIzaSyBhgVTQXICNvQTZx2wHH9kAfK0c7ymTZPc", // Replace with your actual API key if needed
    authDomain: "themind-450af.firebaseapp.com",
    databaseURL: "https://themind-450af-default-rtdb.firebaseio.com",
    projectId: "themind-450af",
    storageBucket: "themind-450af.firebasestorage.app",
    messagingSenderId: "206488361143",
    appId: "1:206488361143:web:3f2dc1b2a55dd8ccbe1532",
    measurementId: "G-8NTF0H3BH4"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// ============================================
// GLOBAL VARIABLES & CONFIG
// ============================================

let currentRoomId = null;
let currentPlayer = null;
let gameState = null; // Local copy of the game state
let isAdvancing = false; // Flag to prevent multiple advanceLevel calls
let checkLevelTimeout = null; // Timeout ID for level completion check

// Configuration based on player count (Lives & Stars follow official rules)
const GAME_CONFIG = {
    2: { levels: 12, lives: 2, stars: 1 },
    3: { levels: 10, lives: 3, stars: 1 },
    4: { levels: 8, lives: 4, stars: 1 }
};

// Rewards granted upon completing a specific level
const LEVEL_REWARDS = {
    2: 'star',
    3: 'life',
    5: 'star',
    6: 'life',
    8: 'star',
    9: 'life'
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Ensures the value is always an array. Handles null, undefined, single values, and arrays.
 * Needed due to Firebase sometimes returning single values instead of arrays or removing keys for empty arrays.
 */
function ensureArray(value) {
    if (!value) return []; // Handles null, undefined, 0, false, ""
    if (Array.isArray(value)) return value;
    // Firebase sometimes saves single-element arrays as just the element
    return [value];
}

/**
 * Escapes HTML characters in a string to prevent XSS attacks.
 */
function escapeHtml(text) {
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
 * Shuffles an array using the Fisher-Yates algorithm.
 */
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// ============================================
// EXPOSE FUNCTIONS TO WINDOW (for HTML onclick)
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
    const roomsRef = ref(database, 'rooms');
    onValue(roomsRef, (snapshot) => {
        const rooms = snapshot.val();
        displayRooms(rooms);
    });
}

/**
 * Renders the list of available rooms in the lobby.
 */
function displayRooms(rooms) {
    const roomsList = document.getElementById('roomsList');
    if (!roomsList) {
        console.error('Elemento roomsList no encontrado');
        return;
    }

    if (!rooms || typeof rooms !== 'object' || Object.keys(rooms).length === 0) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas disponibles</p>';
        return;
    }

    // Filter for rooms that are 'waiting' and not full
    const openRooms = Object.entries(rooms).filter(([_, room]) => {
        if (!room || typeof room !== 'object' || !room.players || typeof room.players !== 'object') return false;
        if (room.status !== 'waiting') return false;
        const currentPlayers = Object.keys(room.players).length;
        const maxPlayers = room.maxPlayers || 0;
        return currentPlayers < maxPlayers;
    });

    if (openRooms.length === 0) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas abiertas</p>';
        return;
    }

    // Generate HTML for each open room
    roomsList.innerHTML = openRooms.map(([roomId, room]) => {
        const currentPlayers = Object.keys(room.players || {}).length;
        const maxPlayers = room.maxPlayers || 0;
        const roomName = escapeHtml(room.name || 'Sala sin nombre');

        return `
            <div class="bg-white/10 p-4 rounded-lg hover:bg-white/20 transition cursor-pointer border border-white/20"
                 onclick="joinRoom('${roomId}')">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="font-bold text-lg">${roomName}</p>
                        <p class="text-sm opacity-75">${currentPlayers}/${maxPlayers} jugadores</p>
                    </div>
                    <button class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg font-bold">UNIRSE</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Creates a new game room in Firebase.
 */
async function createRoom() {
    try {
        const roomName = document.getElementById('createRoomName').value.trim();
        const playerName = document.getElementById('createPlayerName').value.trim();
        const playerCountEl = document.getElementById('playerCount');
        
        if (!playerCountEl){
             alert('Error: Elemento playerCount no encontrado.');
             return;
        }
        const maxPlayers = parseInt(playerCountEl.value);

        if (!roomName || !playerName) {
            alert('Por favor completa todos los campos');
            return;
        }

        currentPlayer = playerName;
        const config = GAME_CONFIG[maxPlayers];
        if (!config) {
             alert('Número de jugadores inválido.');
             return;
        }

        const roomsRef = ref(database, 'rooms');
        const newRoomRef = push(roomsRef); // Generate unique room ID
        currentRoomId = newRoomRef.key;

        // Set initial room data
        await set(newRoomRef, {
            name: roomName,
            maxPlayers: maxPlayers,
            status: 'waiting',
            host: playerName,
            players: { [playerName]: { connected: true, ready: false } },
            config: config
        });

        // Set up automatic removal on disconnect
        const playerRef = ref(database, `rooms/${currentRoomId}/players/${playerName}`);
        onDisconnect(playerRef).remove();

        showWaitingScreen();
        listenToRoom(); // Start listening to this specific room
    } catch (error) {
        console.error('Error al crear sala:', error);
        alert('Error al crear sala: ' + error.message);
    }
}

/**
 * Joins an existing game room.
 */
async function joinRoom(roomId) {
    try {
        const playerName = document.getElementById('joinPlayerName').value.trim();

        if (!playerName) {
            alert('Por favor ingresa tu nombre');
            return;
        }

        currentRoomId = roomId; // Set room ID early for player check

        const roomRef = ref(database, `rooms/${roomId}`);
        const snapshot = await get(roomRef);

        if (!snapshot.exists()) {
            alert('La sala no existe');
            currentRoomId = null; // Reset room ID
            return;
        }

        const room = snapshot.val();

        // Check if room is full
        if (!room.players || Object.keys(room.players).length >= (room.maxPlayers || 0)) {
            alert('La sala está llena');
            currentRoomId = null; // Reset room ID
            return;
        }
        // Check if player name is already taken
        if (room.players[playerName]) {
            alert('Ya existe un jugador con ese nombre en esta sala.');
            currentRoomId = null; // Reset room ID
            return;
        }

        currentPlayer = playerName; // Set currentPlayer only after validation passes

        // Add player to the room
        const playerRef = ref(database, `rooms/${roomId}/players/${playerName}`);
        await set(playerRef, { connected: true, ready: false });
        onDisconnect(playerRef).remove(); // Setup disconnect handler

        showWaitingScreen();
        listenToRoom(); // Start listening to this specific room
    } catch (error) {
        console.error('Error al unirse a la sala:', error);
        alert('Error al unirse: ' + error.message);
        currentRoomId = null; // Reset room ID on error
        currentPlayer = null;
    }
}


/**
 * Switches the UI to the waiting screen.
 */
function showWaitingScreen() {
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('waitingScreen').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('hidden'); // Ensure game screen is hidden
    document.getElementById('gameOverModal').classList.add('hidden'); // Ensure game over modal is hidden
}

/**
 * Switches the UI to the game screen.
 */
function showGameScreen() {
    document.getElementById('waitingScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.add('hidden'); // Ensure lobby screen is hidden
    document.getElementById('gameScreen').classList.remove('hidden');
    document.getElementById('gameOverModal').classList.add('hidden'); // Ensure game over modal is hidden initially
}

// ============================================
// ROOM LISTENER & STATE MANAGEMENT
// ============================================

// Variable to store the previous game state for comparison
let previousGameState = null;

/**
 * Listens for real-time updates to the current room and manages state transitions.
 */
function listenToRoom() {
    const roomRef = ref(database, `rooms/${currentRoomId}`);

    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();

        // Handle room closure or unexpected deletion
        if (!room) {
            console.error('Sala cerrada o no encontrada en Firebase.');
            // Only alert and reload if the user was actively in a waiting or game screen
            if (currentRoomId && ( !document.getElementById('lobbyScreen').classList.contains('hidden') ||
                                   !document.getElementById('waitingScreen').classList.contains('hidden') ||
                                   !document.getElementById('gameScreen').classList.contains('hidden') ) )
             {
                 // Check if modal is already showing to prevent double alert/reload
                 const modal = document.getElementById('gameOverModal');
                 if (!modal || modal.classList.contains('hidden')) {
                     alert('La sala fue cerrada o ya no existe.');
                     location.reload();
                 }
            }
            // Reset state if room disappears
            currentRoomId = null;
            currentPlayer = null;
            gameState = null;
            previousGameState = null;
            return;
        }

        // --- State Transition Logic ---

        if (room.status === 'waiting') {
            // Transitioning back to waiting (e.g., after game over/victory)
             if (!document.getElementById('waitingScreen').classList.contains('hidden')) {
                 // Already on waiting screen, just update it
                 updateWaitingScreen(room);
             } else {
                 // Transition from game/lobby to waiting
                 console.log("Transición a pantalla de espera.");
                 showWaitingScreen();
                 updateWaitingScreen(room);
             }
             // Reset game state when back in waiting
             gameState = null;
             previousGameState = null;

        } else if (room.status === 'playing' && room.game) {
            // Game is active, update game state and UI
            previousGameState = gameState; // Store previous state before updating
            gameState = room.game; // Update global state

            // --- Level Advancement Notification Logic ---
            if (previousGameState && gameState.level > previousGameState.level) {
                console.log(`Level increased from ${previousGameState.level} to ${gameState.level}`);
                const completedLevel = previousGameState.level;
                const reward = LEVEL_REWARDS[completedLevel];
                let rewardText = '';
                // Check if lives/stars actually increased to confirm reward
                if (reward === 'life' && gameState.lives > previousGameState.lives) {
                    rewardText = '\n¡+1 ❤️!';
                }
                if (reward === 'star' && gameState.stars > previousGameState.stars) {
                    rewardText = '\n¡+1 ⭐!';
                }
                // Show level up alert on ALL clients (runs inside onValue)
                alert(`✅ ¡Nivel ${completedLevel} completado!${rewardText}\n\nAvanzando al nivel ${gameState.level}...`);
            }
            // --- End Notification Logic ---

            // Ensure game screen is shown and UI updated
            if (document.getElementById('gameScreen').classList.contains('hidden')) {
                showGameScreen();
            }
            updateGameUI();

        } else if (room.status === 'playing' && !room.game) {
             // This state might occur briefly during game reset
             console.warn("Room status 'playing' but game object missing. Waiting for state update.");
             // Keep local state for now, UI should reflect lack of game data or previous state
             // updateGameUI will handle missing gameState gracefully
             if (!document.getElementById('gameScreen').classList.contains('hidden')) {
                 updateGameUI(); // Update UI to show empty state if necessary
             }
        }
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

    if (roomNameEl) roomNameEl.textContent = escapeHtml(room.name || 'Sala');

    const players = room.players ? Object.keys(room.players) : [];
    if (playersListEl) {
        playersListEl.innerHTML = players.map(p =>
            `<p>${escapeHtml(p)} ${p === room.host ? '👑' : ''}</p>`
        ).join('');
    }
    if (countEl) countEl.textContent = players.length;
    if (maxEl) maxEl.textContent = room.maxPlayers || 0;

    // Enable start button only for the host when enough players are present
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
    try {
        console.log('Iniciando juego...');
        isAdvancing = false; // Reset advance flag

        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();

        if (!room || !room.players || !room.config) {
            throw new Error('Sala, jugadores o configuración no encontrados');
        }

        const players = Object.keys(room.players);
        // Ensure minimum player count
        if (players.length < 2) {
             alert('Se necesitan al menos 2 jugadores para iniciar.');
             return;
        }

        const deck = generateDeck();
        const hands = {};

        // Deal 1 card to each player for level 1
        players.forEach(player => {
             if (deck.length > 0) {
                 hands[player] = [deck.pop()];
             } else {
                  hands[player] = [];
             }
        });

        console.log('Manos iniciales:', hands);

        // Set the initial game state in Firebase using room's config
        await update(roomRef, {
            status: 'playing',
            game: {
                level: 1,
                lives: room.config.lives, // Use lives from config
                stars: room.config.stars, // Use stars from config
                maxLevels: room.config.levels, // Use levels from config
                deck: deck, // Remaining deck
                hands: hands,
                centralPile: [],
                discardedCards: [],
                starProposal: null,
                starVotes: {},
                gameOver: false,
                victory: false
            }
        });

        console.log('✓ Juego iniciado correctamente');
         // No alert here, onValue listener handles UI change
    } catch (error) {
        console.error('ERROR al iniciar juego:', error);
        alert('Error al iniciar: ' + error.message);
    }
}

// ============================================
// GAME UI UPDATES
// ============================================

/**
 * Updates the game screen UI based on the current `gameState`.
 */
function updateGameUI() {
    try {
        // --- Header Info ---
        const livesDisplay = document.getElementById('livesDisplay');
        const levelDisplay = document.getElementById('levelDisplay');
        const starsDisplay = document.getElementById('starsDisplay');

        if (livesDisplay) livesDisplay.innerHTML = '❤️'.repeat(gameState?.lives ?? 0);
        if (levelDisplay) levelDisplay.textContent = gameState?.level ?? 1;
        if (starsDisplay) starsDisplay.innerHTML = '⭐'.repeat(gameState?.stars ?? 0);

        // --- Central Pile ---
        const centralPileEl = document.getElementById('centralPile');
        if (centralPileEl) {
            const centralPile = ensureArray(gameState?.centralPile);
            if (centralPile.length === 0) {
                centralPileEl.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
            } else {
                const lastCard = centralPile[centralPile.length - 1];
                centralPileEl.innerHTML = `<div class="text-8xl font-bold">${lastCard}</div>`;
            }
        }

        // --- Played Cards History ---
        const cardsPlayedList = document.getElementById('cardsPlayedList');
        if (cardsPlayedList) {
            const centralPile = ensureArray(gameState?.centralPile);
            cardsPlayedList.innerHTML = centralPile.map(card =>
                `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
            ).join('');
        }

        // --- Player Hand ---
        const handDiv = document.getElementById('playerHand');
        if (handDiv) {
            const currentHandValue = gameState?.hands ? gameState.hands[currentPlayer] : null;
            const myHand = ensureArray(currentHandValue);

            if (myHand.length === 0) {
                handDiv.innerHTML = '<p class="text-center opacity-60 py-8">No tienes cartas</p>';
            } else {
                const sortedHand = [...myHand].sort((a, b) => a - b);
                handDiv.innerHTML = sortedHand.map(card =>
                    `<button onclick="playCard(${card})"
                             class="bg-gradient-to-br from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 rounded-xl p-6 min-w-[100px] text-4xl font-bold transform transition hover:scale-110 shadow-xl">
                        ${card}
                    </button>`
                ).join('');
            }
        }

        // --- Star Controls ---
        updateStarControl(); // Update star buttons/status

        // --- Game Over Modal ---
        // The modal is shown based on gameState.gameOver, handled by the listener calling showGameOver if needed.
        // We ensure it's hidden if the game state is NOT game over.
        const modal = document.getElementById('gameOverModal');
        if (modal && (!gameState || !gameState.gameOver)) {
             modal.classList.add('hidden');
        } else if (modal && gameState && gameState.gameOver) {
             // Ensure it's shown if game is over (listener might miss the transition)
             showGameOver();
        }


    } catch (error) {
        console.error('ERROR en updateGameUI:', error);
        // Avoid alerting here to prevent spamming if state is weird
    }
}


// ============================================
// PLAYING A CARD
// ============================================

/**
 * Handles the logic when a player clicks on a card to play it.
 * Includes validation for explicit and implicit errors.
 */
async function playCard(cardValue) {
    // Prevent action if advancing level
    if (isAdvancing) {
        console.warn("Acción bloqueada: Avanzando de nivel.");
        return;
    }

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
            console.error('❌ Juego no activo o ya terminado.');
            return; // Exit silently
        }
        if (!freshGame.hands) {
             console.error('❌ Estado inválido: No hay manos (hands).');
             return; // Exit silently
         }


        // Verify the player has the card (check against fresh state)
        const myHand = ensureArray(freshGame.hands[currentPlayer]);
        if (!myHand.includes(cardValue)) {
            console.warn(`❌ No tienes la carta ${cardValue} (o ya fue jugada/descartada).`);
            return; // Exit silently
        }

        // --- VALIDATION 1: Explicit Error (Card < Last Played) ---
        const centralPile = ensureArray(freshGame.centralPile);
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            if (cardValue < lastCard) {
                console.error(`❌ ERROR EXPLÍCITO: ${cardValue} < ${lastCard}`);
                await handleError(cardValue, freshGame); // Handle error and exit
                return;
            }
        }

        // --- VALIDATION 2: Implicit Error (Skipped a Lower Card still in anyone's hand) ---
        let allRemainingCards = [];
        // Iterate through hands in the fresh game state
        Object.keys(freshGame.hands).forEach(player => {
            const hand = ensureArray(freshGame.hands[player]);
            // Exclude the card *about to be played* only from the current player's hand for this check
            const cardsToCheck = (player === currentPlayer)
                ? hand.filter(c => c !== cardValue)
                : hand;
            allRemainingCards.push(...cardsToCheck);
        });

        if (allRemainingCards.length > 0) {
            const lowestRemainingCard = Math.min(...allRemainingCards);
            // If the card being played is greater than the lowest card remaining elsewhere
            if (cardValue > lowestRemainingCard) {
                console.error(`❌ ERROR IMPLÍCITO: ${cardValue} jugada, pero ${lowestRemainingCard} sigue en juego.`);
                // CRITICAL: Call handleError with the card that *should* have been played
                await handleError(lowestRemainingCard, freshGame);
                return; // Handle error and exit
            }
        }

        // --- PLAY IS VALID: Update Firebase ---
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];

        console.log(`Actualizando Firebase: ${currentPlayer} juega ${cardValue}`);
        await update(gameRef, {
            // Use null to explicitly remove the key if the hand becomes empty
            [`hands/${currentPlayer}`]: newHand.length > 0 ? newHand : null,
            centralPile: newPile
        });

        console.log(`✓ Carta ${cardValue} jugada correctamente`);

        // Schedule a check for level completion after a delay
        // This check runs *after* Firebase has been updated
        checkLevelTimeout = setTimeout(() => {
            checkLevelComplete(); // Call the stable checking function
        }, 2000); // 2-second delay to allow for sync and potential other plays

    } catch (error) {
        console.error('ERROR en playCard:', error);
        // Avoid alerting for common/expected errors during gameplay
        if (error.message.includes("permission_denied")) {
             alert("Error de permisos. Intenta recargar.");
        } else {
             // alert('Error inesperado al jugar carta.'); // Optional: Alert for truly unexpected errors
        }

    }
}


// ============================================
// CHECK LEVEL COMPLETE (STABLE VERSION)
// ============================================

/**
 * Checks if all players have empty hands to advance the level.
 * Reads the stable player list from /players, not /game/hands.
 * This is robust against Firebase removing keys for empty hands.
 */
async function checkLevelComplete() {
    // Prevent check if already advancing or timeout was cleared elsewhere
    if (isAdvancing || !checkLevelTimeout) {
        if (isAdvancing) console.log('CheckLevelComplete: Avance ya en progreso.');
        if (!checkLevelTimeout) console.log('CheckLevelComplete: Timeout ya cancelado.');
        return;
    }
    checkLevelTimeout = null; // Mark timeout as consumed

    try {
        console.log('\n--- Verificando si el nivel está completo (Estable) ---');

        // 1. Get current game state
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const checkGame = gameSnapshot.val();

        // 2. Get stable player list from /players
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        // Exit conditions: Game over, invalid state, or no players found
        if (!checkGame || checkGame.gameOver || !roomPlayers) {
            console.log('⚠️ Juego no válido, terminado, o sin jugadores para verificar.');
            return;
        }

        const playerList = Object.keys(roomPlayers);
        let totalCards = 0;

        // 3. Iterate through STABLE player list and count remaining cards
        console.log('Contando cartas restantes:');
        for (const player of playerList) {
            // Safely check hand in game state (might be null/undefined)
            const handValue = checkGame.hands ? checkGame.hands[player] : null;
            const hand = ensureArray(handValue); // ensureArray([]) returns 0 length
            totalCards += hand.length;
            console.log(`  ${player}: ${hand.length} cartas`);
        }

        console.log(`Total de cartas restantes: ${totalCards}`);

        // 4. Advance level ONLY if total cards is zero
        if (totalCards === 0) {
             // Double-check isAdvancing flag before calling
            if (!isAdvancing) {
                 console.log('✅ ¡Todas las manos vacías! Avanzando nivel...');
                 await advanceLevel(); // Call the advance level function
            } else {
                 console.log("⚠️ Detectado nivel completo, pero avance ya iniciado.");
            }

        } else {
            console.log('⏳ Nivel aún incompleto');
        }

    } catch (error) {
        console.error('ERROR verificando nivel:', error);
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
     // Prevent handling error if already advancing level (might cause conflicts)
     if (isAdvancing) {
          console.warn("Error detectado durante avance de nivel, ignorando.");
          return;
     }

    try {
        console.log(`\n=== MANEJANDO ERROR (carta referencia: ${errorCardRef}) ===`);

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const roomRef = ref(database, `rooms/${currentRoomId}`); // Room reference for game over reset
        const newLives = freshGame.lives - 1;

        console.log(`Vidas: ${freshGame.lives} → ${newLives}`);

        // --- GAME OVER ---
        if (newLives <= 0) {
            console.log('💔 GAME OVER');
            // Mark game over in Firebase
            await update(gameRef, {
                lives: 0,
                gameOver: true,
                victory: false
            });

            // Wait briefly for UI update/modal display before resetting
            // Trigger modal display immediately based on state change
            showGameOver(); // Make sure modal shows now
            await new Promise(resolve => setTimeout(resolve, 4000)); // Increased delay for viewing modal

            // Reset room state to waiting, clearing the game object
            console.log("Reseteando sala a 'waiting'...");
            await update(roomRef, {
                status: 'waiting',
                game: null // Remove game object
            });

            // The onValue listener in listenToRoom will handle UI change back to waiting screen
            // Alert might be redundant if modal is shown, consider removing
            // alert('💔 Se acabaron las vidas. Game Over. Volviendo al lobby.');
            console.log("Sala reseteada.");
            return; // Stop execution here
        }

        // --- CONTINUE GAME (LOSE LIFE & DISCARD) ---
        const updates = { lives: newLives };
        const discarded = ensureArray(freshGame.discardedCards); // Ensure discarded is array

        console.log('Descartando cartas <=', errorCardRef);
        // Need the player list to ensure all hands are checked, even if some are empty (null)
         const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
         const roomPlayers = playersSnapshot.val();
         if (!roomPlayers) return; // Should not happen
         const playerList = Object.keys(roomPlayers);


        playerList.forEach(player => {
             const handValue = freshGame.hands ? freshGame.hands[player] : null;
             const playerHand = ensureArray(handValue);

            const toDiscard = playerHand.filter(c => c <= errorCardRef);
            const newHand = playerHand.filter(c => c > errorCardRef);

            console.log(`  ${player}: descarta [${toDiscard.join(', ')}], quedan [${newHand.join(', ')}]`);

            if (toDiscard.length > 0) {
                 discarded.push(...toDiscard);
            }
             // Send null to remove hand key if empty after discard
             // Check if the key exists before assigning null to avoid unnecessary writes
             if (freshGame.hands && freshGame.hands.hasOwnProperty(player)) {
                  updates[`hands/${player}`] = newHand.length > 0 ? newHand : null;
             }
        });

        updates.discardedCards = discarded;

        // Apply updates to Firebase
        await update(gameRef, updates);
        alert(`❌ ¡Error! Carta fuera de orden (ref: ${errorCardRef}).\n\nVidas restantes: ${newLives}\nCartas ≤${errorCardRef} descartadas.`);

        console.log('✓ Error manejado correctamente');

        // Check if level might be complete *after* discarding cards due to error
        // Clear any pending check first
         if (checkLevelTimeout) {
             clearTimeout(checkLevelTimeout);
             checkLevelTimeout = null;
         }
        checkLevelTimeout = setTimeout(() => checkLevelComplete(), 1500); // Check completion after error handling

    } catch (error) {
        console.error('ERROR en handleError:', error);
        alert('Error al manejar el error: ' + error.message);
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
    // Double check flag at the very start
    if (isAdvancing) {
        console.log('⚠️ Avance ya en progreso, abortando llamada duplicada.');
        return;
    }
    isAdvancing = true; // Set flag immediately

    try {
        console.log('\n=== AVANZANDO DE NIVEL ===');

        // Get fresh room and game state
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();

        // Validate state before proceeding
        if (!room || !room.game || !room.players) {
            console.error('❌ Estado inválido para avanzar nivel (sala/juego/jugadores no encontrados).');
            isAdvancing = false; // Release flag on error
            return;
        }

        const currentGame = room.game;
        // Ensure game isn't already over
        if (currentGame.gameOver) {
             console.warn("Intentando avanzar nivel, pero el juego ya terminó.");
             isAdvancing = false;
             return;
        }

        const currentLevel = currentGame.level;
        const nextLevel = currentLevel + 1;

        console.log(`Nivel: ${currentLevel} → ${nextLevel} (Max: ${currentGame.maxLevels})`);

        // --- CHECK FOR VICTORY ---
        if (nextLevel > currentGame.maxLevels) {
            console.log('🎉 ¡VICTORIA!');
            const gameRef = ref(database, `rooms/${currentRoomId}/game`);

            // Mark victory in Firebase
            await update(gameRef, {
                gameOver: true,
                victory: true
            });

            // Trigger modal display immediately
            showGameOver();
            await new Promise(resolve => setTimeout(resolve, 4000)); // Increased delay

            // Reset room state to waiting
            console.log("Victoria: Reseteando sala a 'waiting'...");
            await update(roomRef, {
                status: 'waiting',
                game: null
            });
            console.log("Sala reseteada post-victoria.");
            // onValue listener handles UI change
            isAdvancing = false; // Release flag *before* returning
            return; // Stop execution
        }

        // --- CALCULATE REWARDS ---
        let newLives = currentGame.lives;
        let newStars = currentGame.stars;
        let rewardText = ''; // Defined here for the alert later
        const reward = LEVEL_REWARDS[currentLevel];

        if (reward === 'life' && newLives < 5) {
            newLives++;
            rewardText = '\n¡+1 ❤️!';
            console.log(`Recompensa: +1 ❤️ (total: ${newLives})`);
        }
        if (reward === 'star' && newStars < 3) {
            newStars++;
            rewardText = '\n¡+1 ⭐!'; // Will overwrite life reward text if both happen
            console.log(`Recompensa: +1 ⭐ (total: ${newStars})`);
        }
         // Combine reward text if both are awarded (less likely but possible if rules change)
         // Simplified: Only shows the last reward text generated above.

        // --- DEAL NEW HANDS ---
        const deck = generateDeck();
        const hands = {};
        const players = Object.keys(room.players); // Use stable player list

        console.log(`Repartiendo ${nextLevel} cartas a ${players.length} jugadores`);

        players.forEach(player => {
            const hand = [];
            for (let i = 0; i < nextLevel; i++) {
                if (deck.length > 0) {
                    hand.push(deck.pop());
                } else {
                     console.error("¡Mazo vacío durante el reparto!"); // Should not happen
                     break;
                }
            }
             // Always assign a hand, even if empty (though it shouldn't be)
            hands[player] = hand;
            console.log(`  ${player}: [${hand.sort((a, b) => a - b).join(', ')}]`);
        });

        // --- UPDATE FIREBASE (Single atomic update for next level state) ---
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        console.log('Actualizando Firebase para el nuevo nivel...');

        await update(gameRef, {
            level: nextLevel,
            lives: newLives,
            stars: newStars,
            deck: deck, // Remaining deck after dealing
            hands: hands, // New hands structure
            centralPile: [], // Reset pile
            discardedCards: [], // Reset discards
            starProposal: null, // Reset star proposal
            starVotes: {} // Reset votes
            // Ensure gameOver and victory are false (they should be already)
            // gameOver: false,
            // victory: false
        });

        console.log('✓ Nivel actualizado correctamente en Firebase');

        // **IMPORTANT**: Alert is now handled by the onValue listener in listenToRoom
        // alert(`✅ ¡Nivel ${currentLevel} completado!${rewardText}\n\nAvanzando al nivel ${nextLevel}...`); // REMOVED

    } catch (error) {
        console.error('ERROR CRÍTICO en advanceLevel:', error);
        alert('Error al avanzar de nivel: ' + error.message);
    } finally {
        isAdvancing = false; // Always release the flag, even on error
        console.log('✓ Proceso de avance de nivel finalizado (o fallido).\n');
    }
}


// ============================================
// STAR MECHANICS
// ============================================

/**
 * Initiates a proposal to use a ninja star.
 */
async function proposeStar() {
     // Prevent action if advancing level
    if (isAdvancing) {
        console.warn("Acción bloqueada: Avanzando de nivel.");
        return;
    }
    try {
        // Get fresh state to check stars and proposal status
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const currentGame = gameSnapshot.val();

        if (!currentGame || currentGame.gameOver) {
             alert('El juego no está activo.'); return;
        }
        if (currentGame.stars <= 0) {
            alert('No tienes estrellas disponibles.'); return;
        }
        if (currentGame.starProposal) {
             alert('Ya hay una propuesta de estrella en curso.'); return;
        }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        // Proposer automatically votes yes
        await update(gameRef, {
            starProposal: currentPlayer,
            starVotes: { [currentPlayer]: true }
        });
        console.log(`${currentPlayer} propone usar una estrella.`);
        // No need to call checkStarVotes here, onValue handles UI update

    } catch (error) {
        console.error('Error al proponer estrella:', error);
    }
}

/**
 * Registers a "yes" vote for using a ninja star.
 */
async function voteStarYes() {
     if (isAdvancing) return; // Prevent action during level advance
    try {
        // Get fresh state to check proposal status and if already voted
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const currentGame = gameSnapshot.val();

         if (!currentGame || !currentGame.starProposal || (currentGame.starVotes && currentGame.starVotes[currentPlayer])) {
              console.warn("No se puede votar sí: sin propuesta o ya votaste.");
              return;
         }

        // Set vote to true
        const voteRef = ref(database, `rooms/${currentRoomId}/game/starVotes/${currentPlayer}`);
        await set(voteRef, true);
        console.log(`${currentPlayer} votó SÍ para la estrella.`);

        // Check immediately if this vote completes the process
        checkStarVotes(); // Check if all players have now voted yes

    } catch (error) {
        console.error('Error al votar sí:', error);
    }
}

/**
 * Cancels the current star proposal (implicitly a "no" vote).
 */
async function voteStarNo() {
     if (isAdvancing) return; // Prevent action during level advance
    try {
         // Get fresh state to check if proposal is active
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const currentGame = gameSnapshot.val();

         if (!currentGame || !currentGame.starProposal) {
              console.warn("No hay propuesta de estrella para cancelar.");
              return;
         }

        // Reset proposal and votes
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, {
            starProposal: null,
            starVotes: {}
        });
        console.log(`${currentPlayer} votó NO, cancelando la propuesta.`);
    } catch (error) {
        console.error('Error al votar no:', error);
    }
}

/**
 * Checks if all players have voted "yes" to use the star based on the latest state.
 */
async function checkStarVotes() {
     if (isAdvancing) return; // Don't interfere with level advance

    try {
        // Get fresh game and player data
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const freshGame = gameSnapshot.val();
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        // Exit if no active proposal, game state invalid, or no players
        if (!freshGame || !freshGame.starProposal || !roomPlayers) {
             console.log("checkStarVotes: No hay propuesta activa o estado inválido.");
             return;
        }

        const playerList = Object.keys(roomPlayers);
        const votes = freshGame.starVotes || {};
        const voteCount = Object.keys(votes).length;

        console.log(`Votos de estrella: ${voteCount}/${playerList.length}`);

        // If vote count matches player count, trigger star usage
        if (voteCount === playerList.length) {
            console.log("Todos votaron sí. Usando estrella...");
            // Ensure useStar isn't called multiple times concurrently
            // Use a simple debounce or check flag if needed, but isAdvancing might cover it
            if (!isAdvancing) { // Check advance flag here too? Maybe not needed.
                 await useStar();
            } else {
                 console.log("checkStarVotes: Bloqueado por avance de nivel.");
            }

        }
    } catch (error) {
        console.error('Error en checkStarVotes:', error);
    }
}


/**
 * Executes the star action: discards lowest card from each player's hand.
 */
async function useStar() {
     if (isAdvancing) {
          console.warn("useStar: Bloqueado por avance de nivel.");
          return; // Prevent action during level advance
     }

    try {
        console.log('\n=== USANDO ESTRELLA NINJA ===');

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();

        // Validate state before using star
        if (!freshGame || freshGame.stars <= 0 || freshGame.gameOver) {
             console.warn("No se puede usar estrella: no hay estrellas, juego inválido o terminado.");
             // Attempt to clean up proposal state if inconsistent
             if (freshGame && freshGame.starProposal) {
                  await update(gameRef, { starProposal: null, starVotes: {} });
             }
             return;
        }

        const updates = {
            stars: freshGame.stars - 1, // Decrement star count
            starProposal: null, // Clear proposal
            starVotes: {} // Clear votes
        };
        const discarded = ensureArray(freshGame.discardedCards);

        console.log('Descartando carta más baja de cada jugador:');
        // Get stable player list
         const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
         const roomPlayers = playersSnapshot.val();
         if (!roomPlayers) { console.error("useStar: No se encontraron jugadores."); return; }
         const playerList = Object.keys(roomPlayers);

        // Iterate through players to discard lowest card
        playerList.forEach(player => {
            const handValue = freshGame.hands ? freshGame.hands[player] : null;
            const hand = ensureArray(handValue);

            if (hand.length > 0) {
                const sorted = [...hand].sort((a, b) => a - b);
                const lowest = sorted[0];
                discarded.push(lowest); // Add to discarded pile
                const newHand = sorted.slice(1); // Remove lowest card
                // Send null if hand becomes empty
                updates[`hands/${player}`] = newHand.length > 0 ? newHand : null;
                console.log(`  ${player}: descarta ${lowest}`);
            } else {
                 console.log(`  ${player}: mano ya vacía`);
                 // Ensure player key exists with null if Firebase deleted it and hands object exists
                 if (freshGame.hands && !freshGame.hands.hasOwnProperty(player)) {
                      updates[`hands/${player}`] = null;
                 } else if (!freshGame.hands) {
                      // If hands object itself is missing, don't try to add null keys
                 }
            }
        });

        updates.discardedCards = discarded;

        // Apply updates to Firebase
        await update(gameRef, updates);
        alert('⭐ ¡Estrella ninja usada!\nCada jugador descartó su carta más baja.');
        console.log('✓ Estrella usada correctamente');

        // Check if level might be complete after using the star
        // Clear any pending check first
        if (checkLevelTimeout) {
            clearTimeout(checkLevelTimeout);
            checkLevelTimeout = null;
        }
        checkLevelTimeout = setTimeout(() => checkLevelComplete(), 1500);

    } catch (error) {
        console.error('ERROR en useStar:', error);
        alert('Error al usar estrella: ' + error.message);
    }
}


/**
 * Updates the UI elements related to the star proposal and voting based on fresh data.
 */
async function updateStarControl() { // Added async
    if (!gameState || !currentRoomId) return; // Need gameState and roomId

    const proposeBtn = document.getElementById('proposeStarBtn');
    const starVotesEl = document.getElementById('starVotes');
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');

    if (!proposeBtn || !starVotesEl || !starMessage || !starVoteStatus) return;

    // Disable proposal button based on local gameState (quick feedback)
    proposeBtn.disabled = gameState.stars <= 0 || gameState.starProposal !== null;

    if (gameState.starProposal) {
        proposeBtn.classList.add('hidden');
        starVotesEl.classList.remove('hidden');
        starMessage.textContent = `${escapeHtml(gameState.starProposal)} propone usar estrella`;

        // Get reliable player count for status display
        try {
            const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`)); // Await the promise
            const roomPlayers = playersSnapshot.val();
            const playerCount = roomPlayers ? Object.keys(roomPlayers).length : 0;
            const votes = gameState.starVotes || {};
            const voteCount = Object.keys(votes).length;
            starVoteStatus.textContent = `Votos: ${voteCount}/${playerCount}`;

            // Disable vote buttons if current player already voted (based on local state)
            const yesBtn = starVotesEl.querySelector('button:first-child');
            const noBtn = starVotesEl.querySelector('button:last-child');
            if (yesBtn && noBtn) {
                const alreadyVoted = votes[currentPlayer] === true;
                yesBtn.disabled = alreadyVoted;
                 // Allow voting No anytime to cancel, unless already voted No (implicitly)
                 // Or maybe disable No too once voted Yes? Let's disable both once voted.
                noBtn.disabled = alreadyVoted;
            }
        } catch(error) {
             console.error("Error fetching players for star status:", error);
             starVoteStatus.textContent = 'Votos: ?/?'; // Indicate error
        }

    } else {
        // No active star proposal
        proposeBtn.classList.remove('hidden');
        starVotesEl.classList.add('hidden');
        starMessage.textContent = '¿Usar estrella ninja?';
        starVoteStatus.textContent = ''; // Clear vote status
    }
}


// ============================================
// LEAVE ROOM & GAME OVER DISPLAY
// ============================================

/**
 * Handles the player leaving the room gracefully.
 * Removes the player node from Firebase. `onDisconnect` is a backup.
 */
async function leaveRoom() {
    try {
        console.log(`Saliendo de la sala ${currentRoomId}...`);
        if (currentRoomId && currentPlayer) {
            // Remove the onValue listener before removing the player node?
            // Firebase SDK might handle this, but explicit detachment is safer if possible.
            // For simplicity now, we rely on reload.

            const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
            await remove(playerRef); // Explicit removal
            console.log(`Jugador ${currentPlayer} eliminado.`);
        } else {
             console.log("No hay sala o jugador actual para salir.");
        }
    } catch (error) {
        console.error('Error al salir de la sala:', error);
    } finally {
        // Force reload regardless of success/failure to ensure clean state
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

    // Only proceed if elements and gameState exist
    if (!modal || !title || !message || !gameState) {
         console.warn("showGameOver: Elementos del modal o gameState no encontrados.");
         return;
    }

    // Ensure modal is visible if game is over
    if (gameState.gameOver) {
        modal.classList.remove('hidden');

        if (gameState.victory) {
            title.textContent = '🎉 ¡VICTORIA!';
            title.className = 'text-5xl font-bold mb-4 text-green-400'; // Ensure class is correct
            message.textContent = `¡Completaron todos los ${gameState.maxLevels || '?'} niveles! ¡Son uno con la mente!`;
        } else {
            title.textContent = '💔 GAME OVER';
            title.className = 'text-5xl font-bold mb-4 text-red-400'; // Ensure class is correct
            message.textContent = `Llegaron hasta el nivel ${gameState.level || '?'}. ¡Inténtenlo de nuevo!`;
        }
    } else {
         // Hide modal if game is somehow not over (safety check)
         modal.classList.add('hidden');
    }
}


// ============================================
// INITIALIZE LOBBY LISTENER
// ============================================

// Start listening for available rooms when the script loads
listenToRooms();
console.log("Game script loaded. Listening for rooms.");