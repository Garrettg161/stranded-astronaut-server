const express = require('express');
const http = require('http');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
require('dotenv').config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Apply middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/game_db')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define schemas
const GameSessionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  startTime: { type: Date, default: Date.now },
  lastUpdateTime: { type: Date, default: Date.now },
  gameFacts: { type: Object, default: {} }
});

const PlayerSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  sessionId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  role: { type: String, default: 'Astronaut' },
  isHuman: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  currentLocation: { type: String, required: true, default: "0,1,2,1,2" }, // Default to CryoPod
  inventory: { type: Map, of: Number, default: {} },
  lastActivity: { type: Date, default: Date.now }
});

// Create models
const GameSession = mongoose.model('GameSession', GameSessionSchema);
const Player = mongoose.model('Player', PlayerSchema);

// Basic endpoints

// 1. Join/Create Game
app.post('/api/join', async (req, res) => {
  try {
    const { sessionId, playerName, role } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // If sessionId provided, join existing game; otherwise, create new
    let session;
    if (sessionId) {
      session = await GameSession.findOne({ id: sessionId });
      if (!session) {
        return res.status(404).json({ error: 'Game session not found' });
      }
    } else {
      // Create new session with default game facts
      const newSessionId = uuidv4();
      session = new GameSession({
        id: newSessionId,
        gameFacts: {
          planetName: "Zeta Proxima b",
          atmosphere: "Thin, breathable with assistance",
          gravity: "0.8 Earth gravity",
          temperature: "Variable, generally cool",
          terrain: "Rocky plains with scattered crystalline formations",
          timeElapsed: "0 hours",
          year: "2174"
        }
      });
      await session.save();
    }
    
    // Create player
    const player = new Player({
      id: uuidv4(),
      sessionId: session.id,
      name: playerName,
      role: role || 'Astronaut',
      isHuman: true,
      isActive: true,
      inventory: { "Data Tablet": 1, "Emergency Kit": 1 }
    });
    
    await player.save();
    
    // Notify other players via Socket.io
    io.to(session.id).emit('playerJoined', {
      id: player.id,
      name: player.name,
      role: player.role
    });
    
    res.json({
      player: {
        id: player.id,
        name: player.name,
        role: player.role,
        currentLocation: player.currentLocation,
        inventory: Object.fromEntries(player.inventory)
      },
      sessionId: session.id
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Failed to join game' });
  }
});

// 2. Leave Game
app.post('/api/leave', async (req, res) => {
  try {
    const { sessionId, playerId } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const player = await Player.findOne({ id: playerId, sessionId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Update player status
    player.isHuman = false;
    player.isActive = false;
    player.lastActivity = new Date();
    await player.save();
    
    // Notify other players
    io.to(sessionId).emit('playerLeft', { 
      id: playerId, 
      name: player.name 
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error leaving game:', error);
    res.status(500).json({ error: 'Failed to leave game' });
  }
});

// 3. Sync Game State
app.post('/api/sync', async (req, res) => {
  try {
    const { sessionId, playerId } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get session and player
    const session = await GameSession.findOne({ id: sessionId });
    const player = await Player.findOne({ id: playerId, sessionId });
    
    if (!session || !player) {
      return res.status(404).json({ error: 'Session or player not found' });
    }
    
    // Get all active players in this session
    const allPlayers = await Player.find({ sessionId, isActive: true });
    
    // Format response
    const syncData = {
      player: {
        id: player.id,
        name: player.name,
        role: player.role,
        currentLocation: player.currentLocation,
        inventory: Object.fromEntries(player.inventory)
      },
      allPlayers: allPlayers.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        isHuman: p.isHuman,
        currentLocation: p.currentLocation
      })),
      gameFacts: session.gameFacts
    };
    
    // Update last activity
    player.lastActivity = new Date();
    await player.save();
    
    res.json(syncData);
  } catch (error) {
    console.error('Error syncing game state:', error);
    res.status(500).json({ error: 'Failed to sync game state' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('join', ({ sessionId, playerId }) => {
    if (sessionId && playerId) {
      socket.join(sessionId);
      socket.playerId = playerId;
      socket.sessionId = sessionId;
      console.log(`Player ${playerId} connected to session ${sessionId}`);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
