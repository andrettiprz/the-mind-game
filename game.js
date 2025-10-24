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

const GAME_CONFIG = {
    2: { levels: 12, lives: 2, stars: 1 },
    3: { levels: 10, lives: 3, stars: 1 },
    4: { levels: 8, lives: 4, stars: 1 }
};

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
 * Needed due to Firebase sometimes returning single values instead of arrays.
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
        const maxPlayers = parseInt(document.getElementById('playerCount').value);

        if (!roomName || !playerName) {
            alert('Por favor completa todos los campos');
            return;
        }

        currentPlayer = playerName;
        const config = GAME_CONFIG[maxPlayers];
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

        currentPlayer = playerName;
        currentRoomId = roomId;

        const roomRef = ref(database, `rooms/${roomId}`);
        const snapshot = await get(roomRef);

        if (!snapshot.exists()) {
            alert('La sala no existe');
            return;
        }

        const room = snapshot.val();

        // Check if room is full
        if (!room.players || Object.keys(room.players).length >= room.maxPlayers) {
            alert('La sala está llena');
            return;
        }
         // Check if player name is already taken
        if (room.players[playerName]) {
            alert('Ya existe un jugador con ese nombre en esta sala.');
            return;
        }


        // Add player to the room
        const playerRef = ref(database, `rooms/${roomId}/players/${playerName}`);
        await set(playerRef, { connected: true, ready: false });
        onDisconnect(playerRef).remove(); // Setup disconnect handler

        showWaitingScreen();
        listenToRoom(); // Start listening to this specific room
    } catch (error) {
        console.error('Error al unirse a la sala:', error);
        alert('Error al unirse: ' + error.message);
    }
}

/**
 * Switches the UI to the waiting screen.
 */
function showWaitingScreen() {
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('waitingScreen').classList.remove('hidden');
    document.getElementById('gameScreen').classList.add('hidden'); // Ensure game screen is hidden
}

/**
 * Switches the UI to the game screen.
 */
function showGameScreen() {
    document.getElementById('waitingScreen').classList.add('hidden');
    document.getElementById('lobbyScreen').classList.add('hidden'); // Ensure lobby screen is hidden
    document.getElementById('gameScreen').classList.remove('hidden');
}

// ============================================
// ROOM LISTENER & WAITING SCREEN
// ============================================

/**
 * Listens for real-time updates to the current room.
 */
function listenToRoom() {
    const roomRef = ref(database, `rooms/${currentRoomId}`);

    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();

        // Handle room closure or unexpected deletion
        if (!room) {
            console.error('Sala cerrada o no encontrada');
            // Avoid alert loop if already closed intentionally
            if (document.body.contains(document.getElementById('waitingScreen')) || document.body.contains(document.getElementById('gameScreen'))) {
                 alert('La sala fue cerrada o ya no existe.');
                 location.reload();
            }
            return;
        }

        // Update UI based on room status
        if (room.status === 'waiting') {
            // If game was previously active, reset and show waiting screen
            if (document.getElementById('gameScreen').classList.contains('hidden')) {
                 showWaitingScreen();
            }
            updateWaitingScreen(room);
        } else if (room.status === 'playing' && room.game) {
            gameState = room.game; // Update local game state
            showGameScreen();
            updateGameUI(); // Update game UI with new state
        } else if (room.status === 'playing' && !room.game) {
             console.warn("Room status is playing but game object is missing.");
             // Potentially handle this case, e.g., show a loading or error state
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
    
    if (playersListEl && room.players) {
        const players = Object.keys(room.players);
        playersListEl.innerHTML = players.map(p =>
            `<p>${escapeHtml(p)} ${p === room.host ? '👑' : ''}</p>`
        ).join('');
        if (countEl) countEl.textContent = players.length;
    } else if (playersListEl) {
         playersListEl.innerHTML = ''; // Clear list if no players
         if (countEl) countEl.textContent = 0;
    }
    
    if (maxEl) maxEl.textContent = room.maxPlayers || 0;

    // Enable start button only for the host when enough players are present
    if (startBtn && room.players) {
        const players = Object.keys(room.players);
        startBtn.disabled = !(currentPlayer === room.host && players.length >= 2);
    } else if (startBtn) {
         startBtn.disabled = true;
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

        if (!room || !room.players) {
            throw new Error('Sala o jugadores no encontrados');
        }

        const players = Object.keys(room.players);
        const deck = generateDeck();
        const hands = {};

        // Deal 1 card to each player for level 1
        players.forEach(player => {
             if (deck.length > 0) {
                 hands[player] = [deck.pop()];
             } else {
                  hands[player] = []; // Should not happen with 1 card
             }
        });

        console.log('Manos iniciales:', hands);

        // Set the initial game state in Firebase
        await update(roomRef, {
            status: 'playing',
            game: {
                level: 1,
                lives: room.config.lives,
                stars: room.config.stars,
                maxLevels: room.config.levels,
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
        // Ensure gameState and critical properties exist
        if (!gameState) {
            console.warn('updateGameUI: No hay gameState');
            return;
        }

        // Display lives, level, stars
        const livesDisplay = document.getElementById('livesDisplay');
        if (livesDisplay) livesDisplay.innerHTML = '❤️'.repeat(gameState.lives || 0);

        const levelDisplay = document.getElementById('levelDisplay');
        if (levelDisplay) levelDisplay.textContent = gameState.level || 1;

        const starsDisplay = document.getElementById('starsDisplay');
        if (starsDisplay) starsDisplay.innerHTML = '⭐'.repeat(gameState.stars || 0);

        // Display central pile (last card played)
        const centralPileEl = document.getElementById('centralPile');
        if (centralPileEl) {
            const centralPile = ensureArray(gameState.centralPile); // Use ensureArray
            if (centralPile.length === 0) {
                centralPileEl.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
            } else {
                const lastCard = centralPile[centralPile.length - 1];
                centralPileEl.innerHTML = `<div class="text-8xl font-bold">${lastCard}</div>`;
            }
        }

        // Display history of played cards
        const cardsPlayedList = document.getElementById('cardsPlayedList');
        if (cardsPlayedList) {
            const centralPile = ensureArray(gameState.centralPile); // Use ensureArray
            if (centralPile.length > 0) {
                cardsPlayedList.innerHTML = centralPile.map(card =>
                    `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
                ).join('');
            } else {
                cardsPlayedList.innerHTML = '';
            }
        }

        // Display player's hand
        const handDiv = document.getElementById('playerHand');
        if (handDiv) {
             // Handle case where hands might be temporarily null/undefined during state transition
            const currentHandValue = gameState.hands ? gameState.hands[currentPlayer] : null;
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

        // Update star proposal controls
        updateStarControl();

        // Show Game Over modal if game has ended
        if (gameState.gameOver) {
            console.log('Mostrando pantalla de Game Over/Victoria');
            showGameOver();
        }

    } catch (error) {
        console.error('ERROR en updateGameUI:', error);
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
    try {
        console.log(`\n=== JUGANDO CARTA ${cardValue} ===`);

        // Cancel any pending level completion check
        if (checkLevelTimeout) {
            clearTimeout(checkLevelTimeout);
            checkLevelTimeout = null;
        }

        // Get the most recent game state
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();

        // Validate game state
        if (!freshGame || freshGame.gameOver) {
            console.error('❌ No hay juego activo o ya terminó.');
            // alert('Error: El juego no está activo o ya terminó.'); // Avoid alert if game over is expected
            return;
        }
         if (!freshGame.hands) {
             console.error('❌ Estado inválido: No hay manos (hands).');
             return;
         }


        // Verify the player has the card
        const myHand = ensureArray(freshGame.hands[currentPlayer]);
        if (!myHand.includes(cardValue)) {
            console.warn(`❌ No tienes la carta ${cardValue}`);
            return; // Exit silently, maybe card was already played/discarded
        }

        // --- VALIDATION 1: Explicit Error (Card < Last Played) ---
        const centralPile = ensureArray(freshGame.centralPile);
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            if (cardValue < lastCard) {
                console.error(`❌ ERROR EXPLÍCITO: ${cardValue} < ${lastCard}`);
                await handleError(cardValue, freshGame); // Pass played card for discard logic
                return;
            }
        }

        // --- VALIDATION 2: Implicit Error (Skipped a Lower Card) ---
        let allRemainingCards = [];
        Object.keys(freshGame.hands).forEach(player => {
            const hand = ensureArray(freshGame.hands[player]);
            // Exclude the card being played *only* from the current player's hand
            const cardsToCheck = (player === currentPlayer)
                ? hand.filter(c => c !== cardValue)
                : hand;
            allRemainingCards.push(...cardsToCheck);
        });

        if (allRemainingCards.length > 0) {
            const lowestRemainingCard = Math.min(...allRemainingCards);
            if (cardValue > lowestRemainingCard) {
                console.error(`❌ ERROR IMPLÍCITO: ${cardValue} jugada, pero ${lowestRemainingCard} sigue en juego.`);
                // CRITICAL: Call handleError with the card that *should* have been played (the lowest one)
                await handleError(lowestRemainingCard, freshGame);
                return;
            }
        }

        // --- PLAY IS VALID ---
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];

        // Update Firebase state (remove card from hand, add to pile)
        // Firebase automatically handles removing the player's hand key if newHand is empty
        await update(gameRef, {
            [`hands/${currentPlayer}`]: newHand.length > 0 ? newHand : null, // Send null to remove key if empty
            centralPile: newPile
        });

        console.log(`✓ Carta ${cardValue} jugada correctamente`);

        // Schedule the level completion check
        checkLevelTimeout = setTimeout(() => {
            checkLevelComplete();
        }, 2000); // 2-second delay allows Firebase to sync

    } catch (error) {
        console.error('ERROR en playCard:', error);
        alert('Error al jugar carta: ' + error.message);
    }
}


// ============================================
// CHECK LEVEL COMPLETE (STABLE VERSION)
// ============================================

/**
 * Checks if all players have empty hands to advance the level.
 * Reads the stable player list from /players, not /game/hands.
 */
async function checkLevelComplete() {
    // Prevent check if already advancing or timeout was cleared
    if (isAdvancing || !checkLevelTimeout) return;
    checkLevelTimeout = null; // Mark timeout as consumed

    try {
        console.log('\n--- Verificando si el nivel está completo (Estable) ---');

        // 1. Get current game state
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const checkGame = gameSnapshot.val();

        // 2. Get stable player list from /players
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        // Exit if game ended, invalid state, or no players found
        if (!checkGame || checkGame.gameOver || !roomPlayers) {
            console.log('⚠️ Juego no válido, terminado, o sin jugadores.');
            return;
        }

        const playerList = Object.keys(roomPlayers);
        let totalCards = 0;

        // 3. Iterate through STABLE player list and count cards
        console.log('Contando cartas restantes:');
        for (const player of playerList) {
            // Check hand in game state (might be null/undefined if Firebase removed it)
            const handValue = checkGame.hands ? checkGame.hands[player] : null;
            const hand = ensureArray(handValue); // ensureArray handles null/undefined correctly
            totalCards += hand.length;
            console.log(`  ${player}: ${hand.length} cartas`);
        }

        console.log(`Total de cartas restantes: ${totalCards}`);

        // 4. Advance level if no cards remain
        if (totalCards === 0) {
            console.log('✅ ¡Todas las manos vacías! Avanzando nivel...');
            await advanceLevel();
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
 * Reduces lives, discards cards <= error card, checks for Game Over.
 */
async function handleError(errorCard, freshGame) {
    try {
        console.log(`\n=== MANEJANDO ERROR (referencia: carta ${errorCard}) ===`);

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
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Reset room state to waiting, clearing the game object
            await update(roomRef, {
                status: 'waiting',
                game: null
            });

             // The onValue listener will handle UI change back to waiting screen
            alert('💔 Se acabaron las vidas. Game Over. Volviendo al lobby.');
            return; // Stop execution here
        }

        // --- CONTINUE GAME (LOSE LIFE & DISCARD) ---
        const updates = { lives: newLives };
        const discarded = ensureArray(freshGame.discardedCards); // Ensure discarded is array

        console.log('Descartando cartas <=', errorCard);
        Object.keys(freshGame.hands).forEach(player => {
            const playerHand = ensureArray(freshGame.hands[player]);
            const toDiscard = playerHand.filter(c => c <= errorCard);
            const newHand = playerHand.filter(c => c > errorCard);

            console.log(`  ${player}: descarta [${toDiscard.join(', ')}], quedan [${newHand.join(', ')}]`);

            discarded.push(...toDiscard);
            // Send null to remove hand key if empty after discard
            updates[`hands/${player}`] = newHand.length > 0 ? newHand : null;
        });

        updates.discardedCards = discarded;

        // Apply updates to Firebase
        await update(gameRef, updates);
        alert(`❌ ¡Error! Carta fuera de orden (ref: ${errorCard}).\n\nVidas restantes: ${newLives}\nCartas ≤${errorCard} descartadas.`);

        console.log('✓ Error manejado correctamente');

        // Check if level might be complete *after* discarding cards due to error
        setTimeout(() => checkLevelComplete(), 1000);

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
 * Calculates rewards, deals new cards, handles victory.
 */
async function advanceLevel() {
    if (isAdvancing) {
        console.log('⚠️ Ya hay un avance en progreso, ignorando llamada duplicada.');
        return;
    }
    isAdvancing = true; // Set flag to prevent concurrent execution

    try {
        console.log('\n=== AVANZANDO DE NIVEL ===');

        // Get fresh room state (includes players list)
        const roomSnapshot = await get(ref(database, `rooms/${currentRoomId}`));
        const room = roomSnapshot.val();

        if (!room || !room.game || !room.players) {
            console.error('❌ No hay sala/juego/jugadores válidos para avanzar');
            isAdvancing = false;
            return;
        }

        const currentGame = room.game;
        const currentLevel = currentGame.level;
        const nextLevel = currentLevel + 1;

        console.log(`Nivel: ${currentLevel} → ${nextLevel} (Max: ${currentGame.maxLevels})`);

        // --- CHECK FOR VICTORY ---
        if (nextLevel > currentGame.maxLevels) {
            console.log('🎉 ¡VICTORIA!');
            const gameRef = ref(database, `rooms/${currentRoomId}/game`);
            const roomRef = ref(database, `rooms/${currentRoomId}`);

            // Mark victory in Firebase
            await update(gameRef, {
                gameOver: true,
                victory: true
            });

            // Wait briefly for UI update/modal
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Reset room state to waiting
            await update(roomRef, {
                status: 'waiting',
                game: null
            });
             // onValue listener handles UI change
            isAdvancing = false;
            return; // Stop execution
        }

        // --- CALCULATE REWARDS ---
        let newLives = currentGame.lives;
        let newStars = currentGame.stars;
        let rewardText = '';
        const reward = LEVEL_REWARDS[currentLevel];

        if (reward === 'life' && newLives < 5) { // Assuming max 5 lives
            newLives++;
            rewardText = '\n¡+1 ❤️!';
            console.log(`Recompensa: +1 ❤️ (total: ${newLives})`);
        }
        if (reward === 'star' && newStars < 3) { // Assuming max 3 stars
            newStars++;
            rewardText = '\n¡+1 ⭐!';
            console.log(`Recompensa: +1 ⭐ (total: ${newStars})`);
        }

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
                }
            }
            hands[player] = hand.length > 0 ? hand : null; // Send null if hand is empty (shouldn't happen here)
            console.log(`  ${player}: [${hand.sort((a, b) => a - b).join(', ')}]`);
        });

        // --- UPDATE FIREBASE (Single atomic update) ---
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        console.log('Actualizando Firebase para el nuevo nivel...');

        await update(gameRef, {
            level: nextLevel,
            lives: newLives,
            stars: newStars,
            deck: deck, // Remaining deck
            hands: hands, // New hands
            centralPile: [], // Reset pile
            discardedCards: [], // Reset discards
            starProposal: null, // Reset star proposal
            starVotes: {} // Reset votes
            // gameOver and victory remain false
        });

        console.log('✓ Nivel actualizado correctamente');
        alert(`✅ ¡Nivel ${currentLevel} completado!${rewardText}\n\nAvanzando al nivel ${nextLevel}...`);

    } catch (error) {
        console.error('ERROR CRÍTICO en advanceLevel:', error);
        alert('Error al avanzar de nivel: ' + error.message);
    } finally {
        isAdvancing = false; // Always release the flag
        console.log('✓ Avance completado\n');
    }
}


// ============================================
// STAR MECHANICS
// ============================================

/**
 * Initiates a proposal to use a ninja star.
 */
async function proposeStar() {
    try {
        if (!gameState || gameState.stars <= 0) {
            alert('No tienes estrellas disponibles o el juego no está activo.');
            return;
        }
        if (gameState.starProposal) {
             alert('Ya hay una propuesta de estrella en curso.');
             return;
        }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, {
            starProposal: currentPlayer, // Mark who proposed
            starVotes: { [currentPlayer]: true } // Automatically vote yes for proposer
        });
        console.log(`${currentPlayer} propone usar una estrella.`);
        // Immediately check if votes are complete (e.g., in a 2-player game after proposer votes)
         setTimeout(() => checkStarVotes(), 500);

    } catch (error) {
        console.error('Error al proponer estrella:', error);
    }
}

/**
 * Registers a "yes" vote for using a ninja star.
 */
async function voteStarYes() {
    try {
         // Prevent voting if no proposal or already voted
         if (!gameState || !gameState.starProposal || (gameState.starVotes && gameState.starVotes[currentPlayer])) {
              console.warn("No se puede votar sí: no hay propuesta o ya votaste.");
              return;
         }

        const voteRef = ref(database, `rooms/${currentRoomId}/game/starVotes/${currentPlayer}`);
        await set(voteRef, true); // Set vote to true
        console.log(`${currentPlayer} votó SÍ para la estrella.`);

        // Check if all players have voted after a short delay
        setTimeout(() => checkStarVotes(), 500);
    } catch (error) {
        console.error('Error al votar sí:', error);
    }
}

/**
 * Cancels the current star proposal (registers a "no" vote implicitly).
 */
async function voteStarNo() {
    try {
         if (!gameState || !gameState.starProposal) {
              console.warn("No hay propuesta de estrella para cancelar.");
              return;
         }

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        // Reset proposal and votes
        await update(gameRef, {
            starProposal: null,
            starVotes: {}
        });
        console.log(`${currentPlayer} votó NO, cancelando la propuesta de estrella.`);
    } catch (error) {
        console.error('Error al votar no:', error);
    }
}

/**
 * Checks if all players have voted "yes" to use the star.
 */
async function checkStarVotes() {
    try {
        // Get fresh game and player data
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const freshGame = gameSnapshot.val();
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();

        // Exit if no active proposal, game state invalid, or no players
        if (!freshGame || !freshGame.starProposal || !roomPlayers) return;

        const playerList = Object.keys(roomPlayers);
        const votes = freshGame.starVotes || {};
        const voteCount = Object.keys(votes).length;

        console.log(`Votos de estrella: ${voteCount}/${playerList.length}`);

        // Check if vote count matches player count (everyone voted yes implicitly)
        if (voteCount === playerList.length) {
            console.log("Todos votaron sí. Usando estrella...");
            await useStar();
        }
    } catch (error) {
        console.error('Error en checkStarVotes:', error);
    }
}

/**
 * Executes the star action: discards lowest card from each player's hand.
 */
async function useStar() {
    try {
        console.log('\n=== USANDO ESTRELLA NINJA ===');

        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();

        if (!freshGame || freshGame.stars <= 0) {
             console.warn("No se puede usar estrella: no hay estrellas o juego inválido.");
             // Reset proposal just in case state is inconsistent
             await update(gameRef, { starProposal: null, starVotes: {} });
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
         if (!roomPlayers) return; // Should not happen if game is active
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
                 // Ensure player key exists with null if Firebase deleted it
                 if (freshGame.hands && !freshGame.hands.hasOwnProperty(player)) {
                      updates[`hands/${player}`] = null;
                 }
            }
        });

        updates.discardedCards = discarded;

        // Apply updates to Firebase
        await update(gameRef, updates);
        alert('⭐ ¡Estrella ninja usada!\nCada jugador descartó su carta más baja.');
        console.log('✓ Estrella usada correctamente');

        // Check if level might be complete after using the star
        setTimeout(() => checkLevelComplete(), 1000);

    } catch (error) {
        console.error('ERROR en useStar:', error);
        alert('Error al usar estrella: ' + error.message);
    }
}


/**
 * Updates the UI elements related to the star proposal and voting.
 */
async function updateStarControl() {
    if (!gameState) return;

    const proposeBtn = document.getElementById('proposeStarBtn');
    const starVotesEl = document.getElementById('starVotes'); // Container for Yes/No buttons
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');

    // Ensure elements exist
    if (!proposeBtn || !starVotesEl || !starMessage || !starVoteStatus) return;

    // Disable proposal button if no stars or proposal active
    proposeBtn.disabled = gameState.stars <= 0 || gameState.starProposal !== null;

    if (gameState.starProposal) {
        // Star proposal is active
        proposeBtn.classList.add('hidden'); // Hide propose button
        starVotesEl.classList.remove('hidden'); // Show vote buttons
        starMessage.textContent = `${escapeHtml(gameState.starProposal)} propone usar una estrella`;

        // Update vote status
        const votes = gameState.starVotes || {};
        const voteCount = Object.keys(votes).length;
        
        // Get player count reliably
         const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
         const roomPlayers = playersSnapshot.val();
         const playerCount = roomPlayers ? Object.keys(roomPlayers).length : 0; // Use room player count


        starVoteStatus.textContent = `Votos: ${voteCount}/${playerCount}`;

         // Disable vote buttons if current player already voted
         const yesBtn = starVotesEl.querySelector('button:first-child');
         const noBtn = starVotesEl.querySelector('button:last-child');
         if (yesBtn && noBtn) {
              const alreadyVoted = votes[currentPlayer] === true;
              yesBtn.disabled = alreadyVoted;
              noBtn.disabled = alreadyVoted; // Can still vote no to cancel even if voted yes? Rule check needed. Typically NO cancels.
         }


    } else {
        // No active star proposal
        proposeBtn.classList.remove('hidden'); // Show propose button
        starVotesEl.classList.add('hidden'); // Hide vote buttons
        starMessage.textContent = '¿Usar estrella ninja?';
        starVoteStatus.textContent = ''; // Clear vote status
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
        console.log('Saliendo de la sala...');
        if (currentRoomId && currentPlayer) {
            const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
            // Remove listener first to avoid reacting to own removal
            // Ideally, detach the onValue listener here if possible, otherwise rely on reload
            await remove(playerRef); // Firebase `onDisconnect` should also trigger, but this is explicit
        }
    } catch (error) {
        console.error('Error al salir de la sala:', error);
    } finally {
        location.reload(); // Force reload to go back to lobby
    }
}

/**
 * Displays the Game Over / Victory modal.
 */
function showGameOver() {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');

    if (!modal || !title || !message || !gameState) return; // Ensure elements and state exist

    modal.classList.remove('hidden'); // Make modal visible

    if (gameState.victory) {
        title.textContent = '🎉 ¡VICTORIA!';
        title.className = 'text-5xl font-bold mb-4 text-green-400';
        message.textContent = `¡Completaron todos los ${gameState.maxLevels} niveles! ¡Son uno con la mente!`;
    } else {
        title.textContent = '💔 GAME OVER';
        title.className = 'text-5xl font-bold mb-4 text-red-400';
        message.textContent = `Llegaron hasta el nivel ${gameState.level}. ¡Inténtenlo de nuevo!`;
    }

     // Button in modal already handles reload via onclick="location.reload()"
}


// ============================================
// INITIALIZE LOBBY LISTENER
// ============================================

listenToRooms(); // Start listening for available rooms when the script loads
console.log("Game script loaded. Listening for rooms.");