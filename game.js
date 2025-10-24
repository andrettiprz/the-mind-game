// Import Firebase v9 modular SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBhgVTQXICNvQTZx2wHH9kAfK0c7ymTZPc",
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

let currentRoomId = null;
let currentPlayer = null;
let gameState = null;
let isAdvancing = false;
let checkLevelTimeout = null;

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

function ensureArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.values(value);
    return [value];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function generateDeck() {
    const deck = [];
    for (let i = 1; i <= 100; i++) deck.push(i);
    return shuffleArray(deck);
}

function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// ============================================
// EXPOSE FUNCTIONS TO WINDOW
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
// LOBBY & ROOMS
// ============================================

function listenToRooms() {
    const roomsRef = ref(database, 'rooms');
    onValue(roomsRef, (snapshot) => {
        const rooms = snapshot.val();
        displayRooms(rooms);
    });
}

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
    
    const openRooms = Object.entries(rooms).filter(([_, room]) => {
        if (!room || typeof room !== 'object') return false;
        if (!room.players || typeof room.players !== 'object') return false;
        if (room.status !== 'waiting') return false;
        
        const currentPlayers = Object.keys(room.players).length;
        const maxPlayers = room.maxPlayers || 0;
        
        return currentPlayers < maxPlayers;
    });
    
    if (openRooms.length === 0) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas abiertas</p>';
        return;
    }
    
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
                    <button class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg font-bold">
                        UNIRSE
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

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
        const newRoomRef = push(roomsRef);
        currentRoomId = newRoomRef.key;
        
        await set(newRoomRef, {
            name: roomName,
            maxPlayers: maxPlayers,
            status: 'waiting',
            host: playerName,
            players: { [playerName]: { connected: true, ready: false } },
            config: config
        });
        
        const playerRef = ref(database, `rooms/${currentRoomId}/players/${playerName}`);
        onDisconnect(playerRef).remove();
        
        showWaitingScreen();
        listenToRoom();
    } catch (error) {
        console.error('Error al crear sala:', error);
        alert('Error al crear sala: ' + error.message);
    }
}

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
        
        if (Object.keys(room.players).length >= room.maxPlayers) {
            alert('La sala está llena');
            return;
        }
        
        const playerRef = ref(database, `rooms/${roomId}/players/${playerName}`);
        await set(playerRef, { connected: true, ready: false });
        onDisconnect(playerRef).remove();
        
        showWaitingScreen();
        listenToRoom();
    } catch (error) {
        console.error('Error al unirse a la sala:', error);
        alert('Error al unirse: ' + error.message);
    }
}

function showWaitingScreen() {
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('waitingScreen').classList.remove('hidden');
}

function showGameScreen() {
    document.getElementById('waitingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
}

// ============================================
// ROOM LISTENER
// ============================================

function listenToRoom() {
    const roomRef = ref(database, `rooms/${currentRoomId}`);
    
    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();
        
        if (!room) {
            console.error('Sala cerrada');
            alert('La sala fue cerrada');
            location.reload();
            return;
        }
        
        if (room.status === 'waiting') {
            updateWaitingScreen(room);
        } else if (room.status === 'playing' && room.game) {
            gameState = room.game;
            showGameScreen();
            updateGameUI();
        }
    });
}

function updateWaitingScreen(room) {
    document.getElementById('waitingRoomName').textContent = room.name;
    
    const players = Object.keys(room.players);
    document.getElementById('waitingPlayersList').innerHTML = players.map(p => 
        `<p>${escapeHtml(p)} ${p === room.host ? '👑' : ''}</p>`
    ).join('');
    
    document.getElementById('waitingCount').textContent = players.length;
    document.getElementById('waitingMax').textContent = room.maxPlayers;
    
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.disabled = !(currentPlayer === room.host && players.length >= 2);
    }
}

// ============================================
// GAME START
// ============================================

async function startGameFromWaiting() {
    try {
        console.log('Iniciando juego...');
        
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();
        
        if (!room) {
            throw new Error('Sala no encontrada');
        }
        
        const players = Object.keys(room.players);
        const deck = generateDeck();
        const hands = {};
        
        players.forEach(player => {
            hands[player] = [deck.pop()];
        });
        
        console.log('Manos iniciales:', hands);
        
        await update(roomRef, {
            status: 'playing',
            game: {
                level: 1,
                lives: room.config.lives,
                stars: room.config.stars,
                maxLevels: room.config.levels,
                deck: deck,
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
// GAME UI
// ============================================

function updateGameUI() {
    try {
        if (!gameState) {
            console.warn('No hay gameState');
            return;
        }
        
        if (!gameState.hands) {
            console.warn('gameState.hands no está disponible, esperando...');
            return;
        }
        
        // Vidas
        const livesDisplay = document.getElementById('livesDisplay');
        if (livesDisplay) {
            livesDisplay.innerHTML = '❤️'.repeat(gameState.lives || 0);
        }
        
        // Nivel
        const levelDisplay = document.getElementById('levelDisplay');
        if (levelDisplay) {
            levelDisplay.textContent = gameState.level || 1;
        }
        
        // Estrellas
        const starsDisplay = document.getElementById('starsDisplay');
        if (starsDisplay) {
            starsDisplay.innerHTML = '⭐'.repeat(gameState.stars || 0);
        }
        
        // Pila central
        const centralPile = document.getElementById('centralPile');
        if (centralPile) {
            if (!gameState.centralPile || gameState.centralPile.length === 0) {
                centralPile.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
            } else {
                const lastCard = gameState.centralPile[gameState.centralPile.length - 1];
                centralPile.innerHTML = `<div class="text-8xl font-bold">${lastCard}</div>`;
            }
        }
        
        // Historial de cartas jugadas
        const cardsPlayedList = document.getElementById('cardsPlayedList');
        if (cardsPlayedList) {
            if (gameState.centralPile && gameState.centralPile.length > 0) {
                cardsPlayedList.innerHTML = gameState.centralPile.map(card => 
                    `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
                ).join('');
            } else {
                cardsPlayedList.innerHTML = '';
            }
        }
        
        // Mano del jugador
        const myHand = ensureArray(gameState.hands[currentPlayer]);
        const handDiv = document.getElementById('playerHand');
        
        if (handDiv) {
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
        
        // Control de estrellas
        updateStarControl();
        
        // Game Over
        if (gameState.gameOver) {
            console.log('Mostrando pantalla de Game Over');
            showGameOver();
        }
    } catch (error) {
        console.error('ERROR en updateGameUI:', error);
    }
}

// ============================================
// PLAY CARD
// ============================================

// ============================================
// PLAY CARD (MODIFICADA PARA USAR EL CHEQUEO ESTABLE)
// ============================================

async function playCard(cardValue) {
    try {
        console.log(`\n=== JUGANDO CARTA ${cardValue} ===`);
        
        // Cancelar verificación pendiente
        if (checkLevelTimeout) {
            clearTimeout(checkLevelTimeout);
            checkLevelTimeout = null;
        }
        
        // Obtener estado fresco
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(gameRef);
        const freshGame = snapshot.val();
        
        if (!freshGame || !freshGame.hands) {
            console.error('❌ No hay juego activo.');
            alert('Error: El juego no está activo. Recarga la página.');
            return;
        }
        
        // Verificar que tenemos la carta
        const myHand = ensureArray(freshGame.hands[currentPlayer]);
        if (!myHand.includes(cardValue)) {
            console.warn(`❌ No tienes la carta ${cardValue}`);
            return;
        }
        
        // Verificar orden correcto
        const centralPile = ensureArray(freshGame.centralPile);
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            if (cardValue < lastCard) {
                console.error(`❌ ERROR: ${cardValue} < ${lastCard}`);
                await handleError(cardValue, freshGame);
                return;
            }
        }
        
        // Actualizar estado (se deja que Firebase borre la clave si la mano queda vacía)
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];
        
        await update(gameRef, {
            [`hands/${currentPlayer}`]: newHand,
            centralPile: newPile
        });
        
        console.log(`✓ Carta ${cardValue} jugada correctamente`);
        
        // Programar verificación de nivel completo (se llama a la función estable)
        checkLevelTimeout = setTimeout(() => {
            checkLevelComplete();
        }, 2000); 
        
    } catch (error) {
        console.error('ERROR en playCard:', error);
        alert('Error al jugar carta: ' + error.message);
    }
}

// ============================================
// CHECK LEVEL COMPLETE (SOLUCIÓN DEFINITIVA)
// ============================================

async function checkLevelComplete() {
    if (isAdvancing) {
        console.log('⚠️ Ya hay un avance en progreso');
        return;
    }
    
    try {
        console.log('\n--- Verificando si el nivel está completo (Estable) ---');
        
        // 1. Obtener el estado del juego
        const gameSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const checkGame = gameSnapshot.val();
        
        // 2. Obtener la lista de jugadores estables (desde /rooms/{id}/players)
        const playersSnapshot = await get(ref(database, `rooms/${currentRoomId}/players`));
        const roomPlayers = playersSnapshot.val();
        
        if (!checkGame || checkGame.gameOver || !roomPlayers) {
            console.log('⚠️ Juego no válido o ya terminado');
            return;
        }
        
        const playerList = Object.keys(roomPlayers);
        let totalCards = 0;
        
        // 3. Iterar sobre la lista estable de jugadores y CONTAR cartas
        for (const player of playerList) {
            // CRÍTICO: Si checkGame.hands[player] es null/undefined (borrado por Firebase), ensureArray devuelve [].
            const handValue = checkGame.hands ? checkGame.hands[player] : null;
            const hand = ensureArray(handValue);
            totalCards += hand.length;
            console.log(`  ${player}: ${hand.length} cartas`);
        }
        
        console.log(`Total de cartas restantes: ${totalCards}`);
        
        // 4. Avance de Nivel
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

// **Nota:** El resto de tus funciones (`advanceLevel`, `handleError`, etc.) son correctas y estables.
// ============================================
// HANDLE ERROR
// ============================================

async function handleError(wrongCard, freshGame) {
    try {
        console.log(`\n=== MANEJANDO ERROR (carta ${wrongCard}) ===`);
        
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const newLives = freshGame.lives - 1;
        
        console.log(`Vidas: ${freshGame.lives} → ${newLives}`);
        
        if (newLives <= 0) {
            console.log('💔 GAME OVER');
            await update(gameRef, {
                lives: 0,
                gameOver: true,
                victory: false
            });
            alert('💔 Se acabaron las vidas. Game Over.');
            return;
        }
        
        // Descartar todas las cartas <= wrongCard
        const updates = { lives: newLives };
        const discarded = ensureArray(freshGame.discardedCards);
        
        Object.keys(freshGame.hands).forEach(player => {
            const playerHand = ensureArray(freshGame.hands[player]);
            const toDiscard = playerHand.filter(c => c <= wrongCard);
            const newHand = playerHand.filter(c => c > wrongCard);
            
            console.log(`  ${player}: descartando [${toDiscard.join(', ')}], quedan [${newHand.join(', ')}]`);
            
            discarded.push(...toDiscard);
            updates[`hands/${player}`] = newHand;
        });
        
        updates.discardedCards = discarded;
        
        await update(gameRef, updates);
        alert(`❌ ¡Error! Carta ${wrongCard} fuera de orden.\n\nVidas restantes: ${newLives}\nCartas ≤${wrongCard} descartadas.`);
        
        console.log('✓ Error manejado correctamente');
        
        // Verificar si el nivel se completó después del error
        setTimeout(() => checkLevelComplete(), 1000);
        
    } catch (error) {
        console.error('ERROR en handleError:', error);
        alert('Error al manejar el error: ' + error.message);
    }
}

// ============================================
// ADVANCE LEVEL
// ============================================

async function advanceLevel() {
    if (isAdvancing) {
        console.log('⚠️ Ya hay un avance en progreso');
        return;
    }
    
    isAdvancing = true;
    
    try {
        console.log('\n=== AVANZANDO DE NIVEL ===');
        
        const snapshot = await get(ref(database, `rooms/${currentRoomId}`));
        const room = snapshot.val();
        
        if (!room || !room.game) {
            console.error('❌ No hay sala/juego');
            isAdvancing = false;
            return;
        }
        
        const currentGame = room.game;
        const currentLevel = currentGame.level;
        const nextLevel = currentLevel + 1;
        
        console.log(`Nivel: ${currentLevel} → ${nextLevel}`);
        
        // Verificar victoria
        if (nextLevel > currentGame.maxLevels) {
            console.log('🎉 ¡VICTORIA!');
            const gameRef = ref(database, `rooms/${currentRoomId}/game`);
            await update(gameRef, {
                gameOver: true,
                victory: true
            });
            isAdvancing = false;
            return;
        }
        
        // Calcular recompensas
        let newLives = currentGame.lives;
        let newStars = currentGame.stars;
        
        const reward = LEVEL_REWARDS[currentLevel];
        if (reward === 'life' && newLives < 5) {
            newLives++;
            console.log(`Recompensa: +1 ❤️ (total: ${newLives})`);
        }
        if (reward === 'star' && newStars < 3) {
            newStars++;
            console.log(`Recompensa: +1 ⭐ (total: ${newStars})`);
        }
        
        // Generar nuevo mazo y repartir
        const deck = generateDeck();
        const hands = {};
        const players = Object.keys(room.players);
        
        console.log(`Repartiendo ${nextLevel} cartas a ${players.length} jugadores`);
        
        players.forEach(player => {
            const hand = [];
            for (let i = 0; i < nextLevel; i++) {
                if (deck.length > 0) {
                    hand.push(deck.pop());
                }
            }
            hands[player] = hand;
            console.log(`  ${player}: [${hand.sort((a, b) => a - b).join(', ')}]`);
        });
        
        // Actualizar en Firebase (una sola vez)
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        
        await update(gameRef, {
            level: nextLevel,
            lives: newLives,
            stars: newStars,
            deck: deck,
            hands: hands,
            centralPile: [],
            discardedCards: [],
            starProposal: null,
            starVotes: {}
        });
        
        console.log('✓ Nivel actualizado correctamente');
        
        // Mensaje de recompensa
        let rewardText = '';
        if (reward === 'life') rewardText = '\n¡+1 ❤️!';
        if (reward === 'star') rewardText = '\n¡+1 ⭐!';
        
        alert(`✅ ¡Nivel ${currentLevel} completado!${rewardText}\n\nAvanzando al nivel ${nextLevel}...`);
        
        isAdvancing = false;
        console.log('✓ Avance completado\n');
        
    } catch (error) {
        console.error('ERROR en advanceLevel:', error);
        alert('Error al avanzar de nivel: ' + error.message);
        isAdvancing = false;
    }
}

// ============================================
// STAR MECHANICS
// ============================================

async function proposeStar() {
    try {
        if (!gameState || gameState.stars <= 0) {
            alert('No tienes estrellas disponibles');
            return;
        }
        
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, {
            starProposal: currentPlayer,
            starVotes: {}
        });
    } catch (error) {
        console.error('Error al proponer estrella:', error);
    }
}

async function voteStarYes() {
    try {
        const gameRef = ref(database, `rooms/${currentRoomId}/game/starVotes/${currentPlayer}`);
        await set(gameRef, true);
        
        setTimeout(() => checkStarVotes(), 500);
    } catch (error) {
        console.error('Error al votar sí:', error);
    }
}

async function voteStarNo() {
    try {
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, {
            starProposal: null,
            starVotes: {}
        });
    } catch (error) {
        console.error('Error al votar no:', error);
    }
}

async function checkStarVotes() {
    try {
        const snapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const freshGame = snapshot.val();

        if (!freshGame || !freshGame.starProposal || !freshGame.hands) return;
        
        const players = Object.keys(freshGame.hands);
        const votes = Object.keys(freshGame.starVotes || {});
        
        console.log(`Votos de estrella: ${votes.length}/${players.length}`);
        
        if (votes.length === players.length) {
            await useStar();
        }
    } catch (error) {
        console.error('Error en checkStarVotes:', error);
    }
}

async function useStar() {
    try {
        console.log('\n=== USANDO ESTRELLA ===');
        
        const snapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
        const freshGame = snapshot.val();
        
        if (!freshGame) return;
        
        const updates = {
            stars: freshGame.stars - 1,
            starProposal: null,
            starVotes: {}
        };
        
        const discarded = ensureArray(freshGame.discardedCards);
        
        // Cada jugador descarta su carta más baja
        Object.keys(freshGame.hands).forEach(player => {
            const hand = ensureArray(freshGame.hands[player]);
            if (hand.length > 0) {
                const sorted = [...hand].sort((a, b) => a - b);
                const lowest = sorted[0];
                discarded.push(lowest);
                updates[`hands/${player}`] = sorted.slice(1);
                console.log(`  ${player}: descarta ${lowest}`);
            }
        });
        
        updates.discardedCards = discarded;
        
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, updates);
        
        alert('⭐ ¡Estrella ninja usada!\nCada jugador descartó su carta más baja.');
        console.log('✓ Estrella usada correctamente');
        
        // Verificar si el nivel se completó después de usar la estrella
        setTimeout(() => checkLevelComplete(), 1000);
        
    } catch (error) {
        console.error('ERROR en useStar:', error);
        alert('Error al usar estrella: ' + error.message);
    }
}

function updateStarControl() {
    if (!gameState) return;
    
    const proposeBtn = document.getElementById('proposeStarBtn');
    const starVotes = document.getElementById('starVotes');
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');
    
    if (!proposeBtn || !starVotes || !starMessage || !starVoteStatus) return;
    
    proposeBtn.disabled = gameState.stars <= 0 || gameState.starProposal !== null;
    
    if (gameState.starProposal) {
        proposeBtn.classList.add('hidden');
        starVotes.classList.remove('hidden');
        starMessage.textContent = `${gameState.starProposal} propone usar una estrella`;
        
        if (gameState.hands) {
            const players = Object.keys(gameState.hands);
            const votes = Object.keys(gameState.starVotes || {});
            starVoteStatus.textContent = `Votos: ${votes.length}/${players.length}`;
        }
    } else {
        proposeBtn.classList.remove('hidden');
        starVotes.classList.add('hidden');
        starMessage.textContent = '¿Usar estrella ninja?';
        starVoteStatus.textContent = '';
    }
}

// ============================================
// LEAVE ROOM & GAME OVER
// ============================================

async function leaveRoom() {
    try {
        if (currentRoomId && currentPlayer) {
            const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
            await remove(playerRef);
        }
        location.reload();
    } catch (error) {
        console.error('Error al salir:', error);
        location.reload();
    }
}

function showGameOver() {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');
    
    if (!modal || !title || !message) return;
    
    modal.classList.remove('hidden');
    
    if (gameState.victory) {
        title.textContent = '🎉 ¡VICTORIA!';
        title.className = 'text-5xl font-bold mb-4 text-green-400';
        message.textContent = `¡Completaron todos los ${gameState.maxLevels} niveles! ¡Son uno con la mente!`;
    } else {
        title.textContent = '💔 GAME OVER';
        title.className = 'text-5xl font-bold mb-4 text-red-400';
        message.textContent = `Llegaron al nivel ${gameState.level} de ${gameState.maxLevels}. ¡Inténtenlo de nuevo!`;
    }
}

// ============================================
// INITIALIZE
// ============================================

listenToRooms();
