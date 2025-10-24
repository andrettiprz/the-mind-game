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

// FUNCIÓN HELPER: Siempre convierte a array
function ensureArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
}

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startGameFromWaiting = startGameFromWaiting;
window.leaveRoom = leaveRoom;
window.playCard = playCard;
window.proposeStar = proposeStar;
window.voteStarYes = voteStarYes;
window.voteStarNo = voteStarNo;

function listenToRooms() {
    const roomsRef = ref(database, 'rooms');
    onValue(roomsRef, (snapshot) => {
        const rooms = snapshot.val();
        displayRooms(rooms);
    });
}

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
                <button class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg font-bold">UNIRSE</button>
            </div>
        </div>
    `).join('');
}

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
        players: { [playerName]: { connected: true, ready: false } },
        config: config
    });
    const playerRef = ref(database, `rooms/${currentRoomId}/players/${playerName}`);
    onDisconnect(playerRef).remove();
    showWaitingScreen();
    listenToRoom();
}

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
    await set(playerRef, { connected: true, ready: false });
    onDisconnect(playerRef).remove();
    showWaitingScreen();
    listenToRoom();
}

function showWaitingScreen() {
    document.getElementById('lobbyScreen').classList.add('hidden');
    document.getElementById('waitingScreen').classList.remove('hidden');
}

function listenToRoom() {
    const roomRef = ref(database, `rooms/${currentRoomId}`);
    onValue(roomRef, (snapshot) => {
        const room = snapshot.val();
        if (!room) {
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
        `<p>${p} ${p === room.host ? '👑' : ''}</p>`
    ).join('');
    document.getElementById('waitingCount').textContent = players.length;
    document.getElementById('waitingMax').textContent = room.maxPlayers;
    const startBtn = document.getElementById('startBtn');
    startBtn.disabled = !(currentPlayer === room.host && players.length >= 2);
}

async function startGameFromWaiting() {
    try {
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();
        const players = Object.keys(room.players);
        const deck = generateDeck();
        const hands = {};
        
        players.forEach(player => {
            hands[player] = [deck.pop()];
        });
        
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
    } catch (error) {
        console.error('Error:', error);
    }
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

function showGameScreen() {
    document.getElementById('waitingScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
}

function updateGameUI() {
    try {
        if (!gameState || !gameState.hands) return;
        
        document.getElementById('livesDisplay').innerHTML = '❤️'.repeat(gameState.lives || 0);
        document.getElementById('levelDisplay').textContent = gameState.level || 1;
        document.getElementById('starsDisplay').innerHTML = '⭐'.repeat(gameState.stars || 0);
        
        const centralPile = document.getElementById('centralPile');
        if (!gameState.centralPile || gameState.centralPile.length === 0) {
            centralPile.innerHTML = '<p class="text-6xl opacity-30">---</p><p class="text-sm mt-4 opacity-60">Esperando primera carta...</p>';
        } else {
            const lastCard = gameState.centralPile[gameState.centralPile.length - 1];
            centralPile.innerHTML = `<div class="text-8xl font-bold">${lastCard}</div>`;
        }
        
        const cardsPlayedList = document.getElementById('cardsPlayedList');
        if (gameState.centralPile && gameState.centralPile.length > 0) {
            cardsPlayedList.innerHTML = gameState.centralPile.map(card => 
                `<div class="bg-white/20 px-3 py-1 rounded text-sm">${card}</div>`
            ).join('');
        } else {
            cardsPlayedList.innerHTML = '';
        }
        
        // USAR ensureArray para manejar el problema de Firebase
        const myHand = ensureArray(gameState.hands[currentPlayer]);
        const handDiv = document.getElementById('playerHand');
        
        if (myHand.length === 0) {
            handDiv.innerHTML = '<p class="text-center opacity-60 py-8">No tienes cartas</p>';
        } else {
            const sortedHand = [...myHand].sort((a, b) => a - b);
            handDiv.innerHTML = sortedHand.map(card => 
                `<button onclick="playCard(${card})" class="bg-gradient-to-br from-orange-400 to-red-500 hover:from-orange-500 hover:to-red-600 rounded-xl p-6 min-w-[100px] text-4xl font-bold transform transition hover:scale-110 shadow-xl">
                    ${card}
                </button>`
            ).join('');
        }
        
        updateStarControl();
        
        if (gameState.gameOver) {
            showGameOver();
        }
    } catch (error) {
        console.error('Error UI:', error);
    }
}

async function playCard(cardValue) {
    try {
        const roomRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(roomRef);
        const freshGame = snapshot.val();
        
        if (!freshGame || !freshGame.hands) return;
        
        // USAR ensureArray
        const myHand = ensureArray(freshGame.hands[currentPlayer]);
        
        if (!myHand.includes(cardValue)) return;
        
        const centralPile = freshGame.centralPile || [];
        
        // Verificar si es válido
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            if (cardValue < lastCard) {
                // ERROR: NO actualizamos la mano aquí, llamamos handleError con la carta que se intentó jugar
                await handleError(cardValue, freshGame);
                return;
            }
        }
        
        // Jugar la carta (quitar de mano y agregar a pila)
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];
        
        await update(roomRef, {
            [`hands/${currentPlayer}`]: newHand,
            centralPile: newPile
        });
        
        // Verificar si el nivel se completó
        setTimeout(async () => {
            const checkSnapshot = await get(ref(database, `rooms/${currentRoomId}/game`));
            const checkGame = checkSnapshot.val();
            
            if (checkGame && checkGame.hands) {
                const allEmpty = Object.values(checkGame.hands).every(hand => {
                    const handArray = ensureArray(hand);
                    return handArray.length === 0;
                });
                
                if (allEmpty) {
                    await advanceLevel();
                }
            }
        }, 1000);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

async function handleError(wrongCard, freshGame) {
    try {
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        const newLives = freshGame.lives - 1;
        
        if (newLives <= 0) {
            await update(gameRef, {
                lives: 0,
                gameOver: true,
                victory: false
            });
            alert('💔 Se acabaron las vidas. Game Over.');
            return;
        }
        
        const updates = { lives: newLives };
        const discarded = freshGame.discardedCards || [];
        
        // Descartar TODAS las cartas <= wrongCard de TODAS las manos
        Object.keys(freshGame.hands).forEach(player => {
            const playerHand = ensureArray(freshGame.hands[player]);
            
            // Cartas a descartar: <= wrongCard
            const toDiscard = playerHand.filter(c => c <= wrongCard);
            // Nueva mano: solo cartas > wrongCard
            const newHand = playerHand.filter(c => c > wrongCard);
            
            discarded.push(...toDiscard);
            updates[`hands/${player}`] = newHand;
        });
        
        updates.discardedCards = discarded;
        
        await update(gameRef, updates);
        alert(`❌ ¡Error! Carta ${wrongCard} jugada fuera de orden.\nPerdieron 1 vida. Se descartaron cartas ≤ ${wrongCard}.`);
        
    } catch (error) {
        console.error('Error handler:', error);
    }
}

async function advanceLevel() {
    try {
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();
        
        if (!room || !room.game) return;
        
        const currentGame = room.game;
        const nextLevel = currentGame.level + 1;
        
        if (nextLevel > currentGame.maxLevels) {
            const gameRef = ref(database, `rooms/${currentRoomId}/game`);
            await update(gameRef, {
                gameOver: true,
                victory: true
            });
            return;
        }
        
        let newLives = currentGame.lives;
        let newStars = currentGame.stars;
        
        const reward = LEVEL_REWARDS[currentGame.level];
        if (reward === 'life' && newLives < 5) newLives++;
        if (reward === 'star' && newStars < 3) newStars++;
        
        const deck = generateDeck();
        const hands = {};
        const players = Object.keys(currentGame.hands);
        
        players.forEach(player => {
            const hand = [];
            for (let i = 0; i < nextLevel; i++) {
                if (deck.length > 0) {
                    hand.push(deck.pop());
                }
            }
            hands[player] = hand;
        });
        
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
        
        let rewardText = '';
        if (reward === 'life') rewardText = ' +1 ❤️';
        if (reward === 'star') rewardText = ' +1 ⭐';
        
        alert(`✅ ¡Nivel ${currentGame.level} completado!${rewardText}\n\nAvanzando al nivel ${nextLevel}...`);
        
    } catch (error) {
        console.error('Error advance:', error);
    }
}

async function proposeStar() {
    if (!gameState || gameState.stars <= 0) return;
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, {
        starProposal: currentPlayer,
        starVotes: {}
    });
}

async function voteStarYes() {
    const gameRef = ref(database, `rooms/${currentRoomId}/game/starVotes/${currentPlayer}`);
    await set(gameRef, true);
    setTimeout(() => checkStarVotes(), 500);
}

async function voteStarNo() {
    const gameRef = ref(database, `rooms/${currentRoomId}/game`);
    await update(gameRef, {
        starProposal: null,
        starVotes: {}
    });
}

async function checkStarVotes() {
    if (!gameState || !gameState.starProposal || !gameState.hands) return;
    
    const players = Object.keys(gameState.hands);
    const votes = Object.keys(gameState.starVotes || {});
    
    if (votes.length === players.length && votes.every(p => gameState.starVotes[p])) {
        await useStar();
    }
}

async function useStar() {
    try {
        const roomRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(roomRef);
        const freshGame = snapshot.val();
        
        if (!freshGame) return;
        
        const updates = {
            stars: freshGame.stars - 1,
            starProposal: null,
            starVotes: {}
        };
        
        const discarded = freshGame.discardedCards || [];
        
        Object.keys(freshGame.hands).forEach(player => {
            const hand = ensureArray(freshGame.hands[player]);
            if (hand.length > 0) {
                const sorted = [...hand].sort((a, b) => a - b);
                const lowest = sorted[0];
                discarded.push(lowest);
                updates[`hands/${player}`] = sorted.slice(1);
            }
        });
        
        updates.discardedCards = discarded;
        
        await update(roomRef, updates);
        alert('⭐ Estrella ninja usada! Cada jugador descartó su carta más baja.');
        
    } catch (error) {
        console.error('Error star:', error);
    }
}

function updateStarControl() {
    if (!gameState) return;
    
    const proposeBtn = document.getElementById('proposeStarBtn');
    const starVotes = document.getElementById('starVotes');
    const starMessage = document.getElementById('starMessage');
    const starVoteStatus = document.getElementById('starVoteStatus');
    
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

async function leaveRoom() {
    if (currentRoomId && currentPlayer) {
        const playerRef = ref(database, `rooms/${currentRoomId}/players/${currentPlayer}`);
        await remove(playerRef);
    }
    location.reload();
}

function showGameOver() {
    const modal = document.getElementById('gameOverModal');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');
    
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

listenToRooms();
