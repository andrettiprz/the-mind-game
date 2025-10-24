// Import Firebase v9 modular SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, update, onValue, get, push, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Tu configuración de Firebase
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

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Variables globales
let currentRoomId = null;
let currentPlayer = null;
let gameState = null;

// Configuración según número de jugadores
const GAME_CONFIG = {
    2: { levels: 12, lives: 2, stars: 1 },
    3: { levels: 10, lives: 3, stars: 1 },
    4: { levels: 8, lives: 4, stars: 1 }
};

// Recompensas por nivel (vidas o estrellas)
const LEVEL_REWARDS = {
    2: 'star',
    3: 'life',
    5: 'star',
    6: 'life',
    8: 'star',
    9: 'life'
};

// Hacer funciones globales
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGameFromWaiting = startGameFromWaiting;
window.leaveRoom = leaveRoom;
window.playCard = playCard;
window.proposeStar = proposeStar;
window.voteStarYes = voteStarYes;
window.voteStarNo = voteStarNo;

// Escuchar salas disponibles
function listenToRooms() {
    const roomsRef = ref(database, 'rooms');
    onValue(roomsRef, (snapshot) => {
        const rooms = snapshot.val();
        displayRooms(rooms);
    });
}

// Mostrar salas disponibles
function displayRooms(rooms) {
    const roomsList = document.getElementById('roomsList');
    
    if (!rooms) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas disponibles</p>';
        return;
    }
    
    const openRooms = Object.entries(rooms).filter(([_, room]) => 
        room.status === 'waiting' && Object.keys(room.players).length < room.maxPlayers
    );
    
    if (openRooms.length === 0) {
        roomsList.innerHTML = '<p class="text-center opacity-60 py-8">No hay salas abiertas</p>';
        return;
    }
    
    roomsList.innerHTML = openRooms.map(([roomId, room]) => `
        <div class="bg-white/10 p-4 rounded-lg hover:bg-white/20 transition cursor-pointer border border-white/20" onclick="joinRoom('${roomId}')">
            <div class="flex justify-between items-center">
                <div>
                    <p class="font-bold text-lg">${room.name}</p>
                    <p class="text-sm opacity-75">${Object.keys(room.players).length}/${room.maxPlayers} jugadores</p>
                </div>
                <button class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg font-bold">
                    UNIRSE
                </button>
            </div>
        </div>
    `).join('');
}

// Crear sala
async function createRoom() {
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
        players: {
            [playerName]: {
                connected: true,
                ready: false
            }
        },
        config: config
    });
    
    // Configurar desconexión
    const playerRef = ref(database, `rooms/${currentRoomId}/players/${playerName}`);
    onDisconnect(playerRef).remove();
    
    showWaitingScreen();
    listenToRoom();
}

// Unirse a sala
async function joinRoom(roomId) {
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
    await set(playerRef, {
        connected: true,
        ready: false
    });
    
    onDisconnect(playerRef).remove();
    
    showWaitingScreen();
    listenToRoom();
}

// Mostrar pantalla de espera
function showWaitingScreen() {
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('waitingScreen').classList.remove('hidden');
}

// Escuchar cambios en la sala
// Escuchar cambios en la sala
function listenToRoom() {
    const roomRef = ref(database, `rooms/${currentRoomId}`);
    
    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();
        
        if (!room) {
            alert('La sala fue cerrada');
            location.reload();
            return;
        }
        
        console.log('Estado de la sala:', room.status);
        
        if (room.status === 'waiting') {
            updateWaitingScreen(room);
        } else if (room.status === 'playing') {
            console.log('Juego iniciado, datos:', room.game);
            gameState = room.game;
            showGameScreen();
            updateGameUI();
        }
    });
}


// Actualizar pantalla de espera
function updateWaitingScreen(room) {
    document.getElementById('waitingRoomName').textContent = room.name;
    const players = Object.keys(room.players);
    document.getElementById('waitingPlayersList').innerHTML = players.map(p => 
        `<p>${p} ${p === room.host ? '👑' : ''}</p>`
    ).join('');
    document.getElementById('waitingCount').textContent = players.length;
    document.getElementById('waitingMax').textContent = room.maxPlayers;
    
    const startBtn = document.getElementById('startBtn');
    startBtn.disabled = !(currentPlayer === room.host && players.length >= 2);
}

// Iniciar partida desde sala de espera
async function startGameFromWaiting() {
    try {
        console.log('Iniciando partida...');
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();
        
        console.log('Datos de la sala:', room);
        
        const players = Object.keys(room.players);
        const deck = generateDeck();
        const hands = {};
        
        // Repartir 1 carta a cada jugador (nivel 1)
        players.forEach(player => {
            hands[player] = [deck.pop()];
            console.log(`Carta para ${player}:`, hands[player]);
        });
        
        console.log('Actualizando sala...');
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
                starProposal: null,
                starVotes: {},
                gameOver: false,
                victory: false
            }
        });
        
        console.log('Partida iniciada correctamente!');
    } catch (error) {
        console.error('Error al iniciar partida:', error);
        alert('Error al iniciar: ' + error.message);
    }
}


// Generar mazo de 100 cartas
function generateDeck() {
    const deck = [];
    for (let i = 1; i <= 100; i++) {
        deck.push(i);
    }
    return shuffleArray(deck);
}

// Mezclar array
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Mostrar pantalla de juego
function showGameScreen() {
    document.getElementById('waitingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
}

// Actualizar UI del juego
// Actualizar UI del juego
// Actualizar UI del juego
function updateGameUI() {
    if (!gameState) {
        console.log('No hay gameState todavía');
        return;
    }
    
    console.log('Actualizando UI con mano:', gameState.hands[currentPlayer]);
    
    // Actualizar vidas
    document.getElementById('livesDisplay').innerHTML = '❤️'.repeat(gameState.lives || 0);
    
    // Actualizar nivel  
    document.getElementById('levelDisplay').textContent = gameState.level || 1;
    
    // Actualizar estrellas
    document.getElementById('starsDisplay').innerHTML = '⭐'.repeat(gameState.stars || 0);
    
    // Actualizar pila central
    const centralPile = document.getElementById('centralPile');
    if (!gameState.centralPile || gameState.centralPile.length === 0) {
        centralPile.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
    } else {
        const lastCard = gameState.centralPile[gameState.centralPile.length - 1];
        centralPile.innerHTML = `<div class="text-8xl font-bold">${lastCard}</div>`;
    }
    
    // Mostrar todas las cartas jugadas
    const cardsPlayedList = document.getElementById('cardsPlayedList');
    if (gameState.centralPile && gameState.centralPile.length > 0) {
        cardsPlayedList.innerHTML = gameState.centralPile.map(card => 
            `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
        ).join('');
    } else {
        cardsPlayedList.innerHTML = '';
    }
    
    // Actualizar mano del jugador
    const myHand = gameState.hands && gameState.hands[currentPlayer] ? gameState.hands[currentPlayer] : [];
    const handDiv = document.getElementById('playerHand');
    
    console.log('Mi mano:', myHand);
    
    if (myHand.length === 0) {
        handDiv.innerHTML = '<p class="text-center opacity-60 py-8">No tienes cartas</p>';
    } else {
        handDiv.innerHTML = myHand.sort((a, b) => a - b).map(card => 
            `<button onclick="playCard(${card})" class="bg-gradient-to-br from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 rounded-xl p-6 min-w-[100px] text-4xl font-bold transform transition hover:scale-110 shadow-xl">
                ${card}
            </button>`
        ).join('');
    }
    
    // Control de estrella
    updateStarControl();
    
    // Verificar game over
    if (gameState.gameOver) {
        showGameOver();
    }
}



// Jugar una carta
async function playCard(cardValue) {
    if (!gameState) return;
    
    const myHand = gameState.hands[currentPlayer];
    if (!myHand || !myHand.includes(cardValue)) return;
    
    // Verificar si la carta es correcta
    const centralPile = gameState.centralPile;
    if (centralPile.length > 0) {
        const lastCard = centralPile[centralPile.length - 1];
        if (cardValue < lastCard) {
            // ERROR: carta menor que la última jugada
            await handleError(cardValue);
            return;
        }
    }
    
    // Jugar la carta
    const newHand = myHand.filter(c => c !== cardValue);
    const newPile = [...centralPile, cardValue];
    
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, {
        [`hands/${currentPlayer}`]: newHand,
        centralPile: newPile
    });
    
    // Verificar si todos terminaron sus cartas
    await checkLevelComplete();
}

// Manejar error (carta jugada fuera de orden)
async function handleError(wrongCard) {
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    
    // Perder una vida
    const newLives = gameState.lives - 1;
    
    if (newLives <= 0) {
        // Game over
        await update(gameRef, {
            lives: 0,
            gameOver: true,
            victory: false
        });
        return;
    }
    
    // Descartar cartas menores que la jugada
    const lastCorrectCard = gameState.centralPile[gameState.centralPile.length - 1] || 0;
    const updates = { lives: newLives };
    
    Object.keys(gameState.hands).forEach(player => {
        const newHand = gameState.hands[player].filter(c => c > lastCorrectCard);
        updates[`hands/${player}`] = newHand;
    });
    
    await update(gameRef, updates);
    
    alert(`❌ Error! Carta ${wrongCard} jugada incorrectamente. -1 vida`);
}

// Verificar si se completó el nivel
async function checkLevelComplete() {
    const allHandsEmpty = Object.values(gameState.hands).every(hand => hand.length === 0);
    
    if (allHandsEmpty) {
        await advanceLevel();
    }
}

// Avanzar al siguiente nivel
async function advanceLevel() {
    const nextLevel = gameState.level + 1;
    
    if (nextLevel > gameState.maxLevels) {
        // Victoria!
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        await update(gameRef, {
            gameOver: true,
            victory: true
        });
        return;
    }
    
    // Aplicar recompensa del nivel actual
    let newLives = gameState.lives;
    let newStars = gameState.stars;
    
    const reward = LEVEL_REWARDS[gameState.level];
    if (reward === 'life' && newLives < 5) newLives++;
    if (reward === 'star' && newStars < 3) newStars++;
    
    // Repartir cartas para el nuevo nivel
    const deck = generateDeck();
    const hands = {};
    const players = Object.keys(gameState.hands);
    
    players.forEach(player => {
        hands[player] = [];
        for (let i = 0; i < nextLevel; i++) {
            hands[player].push(deck.pop());
        }
    });
    
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, {
        level: nextLevel,
        lives: newLives,
        stars: newStars,
        deck: deck,
        hands: hands,
        centralPile: [],
        starProposal: null,
        starVotes: {}
    });
    
    alert(`✅ ¡Nivel ${gameState.level} completado! Avanzando al nivel ${nextLevel}...`);
}

// Proponer usar estrella
async function proposeStar() {
    if (gameState.stars <= 0) return;
    
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, {
        starProposal: currentPlayer,
        starVotes: {}
    });
}

// Votar SÍ a la estrella
async function voteStarYes() {
    const gameRef = ref(database, `rooms/${currentRoomId}/game/starVotes/${currentPlayer}`);
    await set(gameRef, true);
    
    checkStarVotes();
}

// Votar NO a la estrella
async function voteStarNo() {
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, {
        starProposal: null,
        starVotes: {}
    });
}

// Verificar votos de estrella
async function checkStarVotes() {
    if (!gameState.starProposal) return;
    
    const players = Object.keys(gameState.hands);
    const votes = Object.keys(gameState.starVotes || {});
    
    if (votes.length === players.length && votes.every(p => gameState.starVotes[p])) {
        // Todos votaron SÍ, usar estrella
        await useStar();
    }
}

// Usar estrella ninja
async function useStar() {
    const updates = {
        stars: gameState.stars - 1,
        starProposal: null,
        starVotes: {}
    };
    
    // Cada jugador descarta su carta más baja
    Object.keys(gameState.hands).forEach(player => {
        const hand = gameState.hands[player];
        if (hand.length > 0) {
            const sorted = [...hand].sort((a, b) => a - b);
            updates[`hands/${player}`] = sorted.slice(1);
        }
    });
    
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, updates);
}

// Actualizar control de estrella
function updateStarControl() {
    const proposeBtn = document.getElementById('proposeStarBtn');
    const starVotes = document.getElementById('starVotes');
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');
    
    proposeBtn.disabled = gameState.stars <= 0 || gameState.starProposal !== null;
    
    if (gameState.starProposal) {
        proposeBtn.classList.add('hidden');
        starVotes.classList.remove('hidden');
        starMessage.textContent = `${gameState.starProposal} propone usar una estrella. ¿Todos de acuerdo?`;
        
        const players = Object.keys(gameState.hands);
        const votes = Object.keys(gameState.starVotes || {});
        starVoteStatus.textContent = `Votos: ${votes.length}/${players.length}`;
    } else {
        proposeBtn.classList.remove('hidden');
        starVotes.classList.add('hidden');
        starMessage.textContent = '¿Usar estrella ninja? Todos deben estar de acuerdo';
        starVoteStatus.textContent = '';
    }
}

// Salir de la sala
async function leaveRoom() {
    if (currentRoomId && currentPlayer) {
        const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
        await remove(playerRef);
    }
    location.reload();
}

// Mostrar game over
function showGameOver() {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');
    
    modal.classList.remove('hidden');
    
    if (gameState.victory) {
        title.textContent = '🎉 ¡VICTORIA!';
        title.className = 'text-5xl font-bold mb-4 text-green-400';
        message.textContent = `¡Completaron todos los ${gameState.maxLevels} niveles!`;
    } else {
        title.textContent = '💔 GAME OVER';
        title.className = 'text-5xl font-bold mb-4 text-red-400';
        message.textContent = `Llegaron al nivel ${gameState.level}. ¡Inténtenlo de nuevo!`;
    }
}

// Iniciar escuchando salas
listenToRooms();
