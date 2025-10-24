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
let isAdvancing = false; // Prevenir múltiples llamadas simultáneas

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
            console.error('Sala cerrada');
            alert('La sala fue cerrada');
            location.reload();
            return;
        }
        if (room.status === 'waiting') {
            updateWaitingScreen(room);
        } else if (room.status === 'playing' && room.game) {
            gameState = room.game;
            console.log('Estado del juego actualizado:', gameState);
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
        console.log('Iniciando juego...');
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();
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
        
        console.log('✓ Juego iniciado');
    } catch (error) {
        console.error('ERROR al iniciar:', error);
        alert('Error al iniciar: ' + error.message);
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
        if (!gameState || !gameState.hands) {
            console.warn('updateGameUI: No hay gameState o hands');
            return;
        }
        
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
            console.log('Mostrando pantalla de Game Over');
            showGameOver();
        }
    } catch (error) {
        console.error('ERROR en updateGameUI:', error);
    }
}

async function playCard(cardValue) {
    try {
        console.log(`\n=== JUGANDO CARTA ${cardValue} ===`);
        
        const roomRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(roomRef);
        const freshGame = snapshot.val();
        
        if (!freshGame || !freshGame.hands) {
            console.error('❌ No hay juego activo. Estado:', freshGame);
            alert('Error: El juego no está activo. Recarga la página.');
            return;
        }
        
        console.log('Estado fresco obtenido:', {
            level: freshGame.level,
            hands: freshGame.hands,
            centralPile: freshGame.centralPile
        });
        
        const myHand = ensureArray(freshGame.hands[currentPlayer]);
        console.log(`Mi mano (${currentPlayer}):`, myHand);
        
        if (!myHand.includes(cardValue)) {
            console.warn(`❌ No tienes la carta ${cardValue}`);
            return;
        }
        
        const centralPile = freshGame.centralPile || [];
        if (centralPile.length > 0) {
            const lastCard = centralPile[centralPile.length - 1];
            if (cardValue < lastCard) {
                console.error(`❌ ERROR: ${cardValue} < ${lastCard}`);
                await handleError(cardValue, freshGame);
                return;
            }
        }
        
        const newHand = myHand.filter(c => c !== cardValue);
        const newPile = [...centralPile, cardValue];
        
        console.log('Actualizando Firebase:', {
            newHand,
            newPile
        });
        
        await update(roomRef, {
            [`hands/${currentPlayer}`]: newHand,
            centralPile: newPile
        });
        
        console.log(`✓ Carta ${cardValue} jugada correctamente`);
        
        // VERIFICAR NIVEL COMPLETO CON DELAY Y CHEQUEO CRÍTICO
        setTimeout(async () => {
            console.log('\n--- Verificando nivel completo ---');
            try {
                // Leer la SALA completa (más estable)
                const checkSnapshot = await get(ref(database, `rooms/${currentRoomId}`));
                const checkRoom = checkSnapshot.val();

                if (!checkRoom || checkRoom.status !== 'playing' || !checkRoom.game) {
                    console.error('❌ Sala o juego no válidos para verificar');
                    return;
                }

                const checkGame = checkRoom.game;
                
                if (checkGame.gameOver) {
                    console.log('⚠️ El juego ya terminó');
                    return;
                }
                
                // ¡CHEQUEO CRÍTICO! Verificar que hands existe
                if (!checkGame.hands) {
                    console.error('❌ La clave "hands" no existe en el estado del juego');
                    return;
                }
                
                console.log('Manos actuales:', checkGame.hands);
                
                const allEmpty = Object.keys(checkGame.hands).every(player => {
                    const handArray = ensureArray(checkGame.hands[player]);
                    console.log(`  ${player}: ${handArray.length} cartas`);
                    return handArray.length === 0;
                });
                
                console.log(`¿Todas vacías? ${allEmpty}`);
                
                if (allEmpty && !isAdvancing) {
                    console.log('✓ ¡Nivel completo! Avanzando...');
                    await advanceLevel();
                } else if (isAdvancing) {
                    console.log('⚠️ Ya se está avanzando de nivel');
                }
            } catch (error) {
                console.error('ERROR verificando nivel:', error);
            }
        }, 1500);
        
    } catch (error) {
        console.error('ERROR en playCard:', error);
        alert('Error al jugar carta: ' + error.message);
    }
}



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
        
        const updates = { lives: newLives };
        const discarded = freshGame.discardedCards || [];
        
        Object.keys(freshGame.hands).forEach(player => {
            const playerHand = ensureArray(freshGame.hands[player]);
            const toDiscard = playerHand.filter(c => c <= wrongCard);
            const newHand = playerHand.filter(c => c > wrongCard);
            console.log(`  ${player}: descartando ${toDiscard}, quedan ${newHand}`);
            discarded.push(...toDiscard);
            updates[`hands/${player}`] = newHand;
        });
        
        updates.discardedCards = discarded;
        
        await update(gameRef, updates);
        alert(`❌ Error! Carta ${wrongCard} fuera de orden.\nVidas: ${newLives}\nCartas ≤${wrongCard} descartadas.`);
        
        console.log('✓ Error manejado');
    } catch (error) {
        console.error('ERROR en handleError:', error);
    }
}

async function advanceLevel() {
    if (isAdvancing) {
        console.log('⚠️ Ya hay un avance en progreso');
        return;
    }
    
    isAdvancing = true;
    
    try {
        console.log('\n=== AVANZANDO DE NIVEL ===');
        
        const roomRef = ref(database, `rooms/${currentRoomId}`);
        const snapshot = await get(roomRef);
        const room = snapshot.val();
        
        if (!room || !room.game) {
            console.error('❌ No hay sala/juego');
            isAdvancing = false;
            return;
        }
        
        const currentGame = room.game;
        const currentLevel = currentGame.level;
        const nextLevel = currentLevel + 1;
        
        console.log(`Nivel actual: ${currentLevel}, siguiente: ${nextLevel}`);
        console.log(`Max niveles: ${currentGame.maxLevels}`);
        
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
            console.log(`Recompensa: +1 vida (${newLives})`);
        }
        if (reward === 'star' && newStars < 3) {
            newStars++;
            console.log(`Recompensa: +1 estrella (${newStars})`);
        }
        
        // Generar NUEVO MAZO y repartir cartas
        const deck = generateDeck();
        const hands = {};
        const players = Object.keys(currentGame.hands);
        
        console.log(`Repartiendo ${nextLevel} cartas a ${players.length} jugadores`);
        
        players.forEach(player => {
            const hand = [];
            for (let i = 0; i < nextLevel; i++) {
                if (deck.length > 0) {
                    hand.push(deck.pop());
                }
            }
            hands[player] = hand;
            console.log(`  ${player}: [${hand.join(', ')}]`);
        });
        
        const gameRef = ref(database, `rooms/${currentRoomId}/game`);
        
        console.log('Actualizando Firebase...');
        
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
        
        console.log('✓ Nivel actualizado en Firebase');
        
        let rewardText = '';
        if (reward === 'life') rewardText = '\n¡+1 ❤️!';
        if (reward === 'star') rewardText = '\n¡+1 ⭐!';
        
        alert(`✅ ¡Nivel ${currentLevel} completado!${rewardText}\n\nAvanzando al nivel ${nextLevel}...`);
        
        isAdvancing = false;
        console.log('✓ Avance completado\n');
        
    } catch (error) {
        console.error('ERROR CRÍTICO en advanceLevel:', error);
        alert('Error al avanzar de nivel: ' + error.message);
        isAdvancing = false;
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
    try {
        const roomRef = ref(database, `rooms/${currentRoomId}/game`);
        const snapshot = await get(roomRef);
        const freshGame = snapshot.val();

        if (!freshGame || !freshGame.starProposal || !freshGame.hands) return;
        
        const players = Object.keys(freshGame.hands);
        const votes = Object.keys(freshGame.starVotes || {});
        
        if (votes.length === players.length) {
            await useStar();
        }
    } catch (error) {
        console.error('ERROR en checkStarVotes:', error);
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
        console.error('ERROR en useStar:', error);
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
