const express = require('express');
const http = require('http');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
require('dotenv').config();

// Server version for tracking
const SERVER_VERSION = "1.1.0";

// Generate a short, human-friendly session ID
function generateShortId() {
    // Define character sets for different parts of the ID
    const alphaPart = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I or O to avoid confusion
    const numericPart = '23456789'; // No 0 or 1 to avoid confusion
    
    // Create a random 6-character code: 3 letters + 3 numbers
    let id = '';
    for (let i = 0; i < 3; i++) {
        id += alphaPart.charAt(Math.floor(Math.random() * alphaPart.length));
    }
    for (let i = 0; i < 3; i++) {
        id += numericPart.charAt(Math.floor(Math.random() * numericPart.length));
    }
    
    return id;
}

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
  shortId: { type: String, unique: true }, // Added for human-friendly IDs
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

const MessageSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  sessionId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  senderName: { type: String, required: true },
  targetId: { type: String },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isSystemMessage: { type: Boolean, default: false }
});

// Create models
const GameSession = mongoose.model('GameSession', GameSessionSchema);
const Player = mongoose.model('Player', PlayerSchema);
const Message = mongoose.model('Message', MessageSchema);

// Basic endpoints

// 1. Join/Create Game
app.post('/join', async (req, res) => {
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
      // Try to find by short ID first
      session = await GameSession.findOne({ shortId: sessionId });
      
      // If not found, try by regular ID
      if (!session) {
        session = await GameSession.findOne({ id: sessionId });
      }
      
      if (!session) {
        return res.status(404).json({ error: 'Game session not found' });
      }
    } else {
      // Create new session with default game facts and a short ID
      const newSessionId = uuidv4();
      const shortId = generateShortId();
      session = new GameSession({
        id: newSessionId,
        shortId: shortId,
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
    
    // Create a system message about player joining
    const joinMessage = new Message({
      id: uuidv4(),
      sessionId: session.id,
      senderId: 'system',
      senderName: 'System',
      content: `${playerName} has joined the game.`,
      isSystemMessage: true
    });
    
    await joinMessage.save();
    
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
      sessionId: session.id,
      shortId: session.shortId // Include the short ID in the response
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Failed to join game' });
  }
});

// 2. Leave Game
app.post('/leave', async (req, res) => {
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
    
    // Create system message about player leaving
    const leaveMessage = new Message({
      id: uuidv4(),
      sessionId: sessionId,
      senderId: 'system',
      senderName: 'System',
      content: `${player.name} has left the game.`,
      isSystemMessage: true
    });
    
    await leaveMessage.save();
    
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

// 3. Sync Game State - Now just providing data, not processing logic
app.post('/sync', async (req, res) => {
  try {
    const { sessionId, playerId, currentLocation, inventory } = req.body;
    
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
    
    // Update player state if provided
    if (currentLocation) {
      player.currentLocation = currentLocation;
    }
    
    if (inventory) {
      // Convert inventory object to Map for storage
      player.inventory = new Map(Object.entries(inventory));
    }
    
    player.lastActivity = new Date();
    await player.save();
    
    // Get all active players in this session
    const allPlayers = await Player.find({ sessionId, isActive: true });
    
    // Get players in same location as current player
    const playersInLocation = await Player.find({
      sessionId,
      isActive: true,
      currentLocation: player.currentLocation
    });
    
    // Get recent messages for this session
    const messages = await Message.find({ sessionId })
      .sort({ timestamp: -1 })
      .limit(50);
    
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
      playersInLocation: playersInLocation.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role
      })),
      messages: messages.map(m => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        targetId: m.targetId,
        content: m.content,
        timestamp: m.timestamp.getTime(),
        isSystemMessage: m.isSystemMessage
      })),
      gameFacts: session.gameFacts
    };
    
    res.json(syncData);
  } catch (error) {
    console.error('Error syncing game state:', error);
    res.status(500).json({ error: 'Failed to sync game state' });
  }
});

// 4. Process Game Action - Simplified to just broadcast events
app.post('/action', async (req, res) => {
  try {
    const { sessionId, playerId, action, result } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get player
    const player = await Player.findOne({ id: playerId, sessionId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Update player's last activity
    player.lastActivity = new Date();
    await player.save();
    
    // Notify others in the same location about the action
    io.to(sessionId).emit('playerAction', {
      playerId: player.id,
      playerName: player.name,
      action: action,
      location: player.currentLocation
    });
    
    // Just return success - client handles the actual response
    res.json({ 
      success: true,
      result: result || "Action received by server"
    });
    
  } catch (error) {
    console.error('Error processing action:', error);
    res.status(500).json({ error: 'Failed to process action' });
  }
});

// 5. Send Message between players
app.post('/message', async (req, res) => {
  try {
    const { sessionId, senderId, content, targetId } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get sender
    const sender = await Player.findOne({ id: senderId, sessionId });
    if (!sender) {
      return res.status(404).json({ error: 'Sender not found' });
    }
    
    // Create message
    const message = new Message({
      id: uuidv4(),
      sessionId,
      senderId,
      senderName: sender.name,
      targetId,
      content,
      timestamp: new Date(),
      isSystemMessage: false
    });
    
    await message.save();
    
    // Update sender's last activity
    sender.lastActivity = new Date();
    await sender.save();
    
    // Notify players in session
    io.to(sessionId).emit('newMessage', {
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
      targetId: message.targetId,
      content: message.content,
      timestamp: message.timestamp.getTime(),
      isSystemMessage: message.isSystemMessage
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// 6. Transfer item between players
app.post('/transferItem', async (req, res) => {
  try {
    const { sessionId, fromPlayerId, toPlayerId, item, quantity } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get players
    const fromPlayer = await Player.findOne({ id: fromPlayerId, sessionId });
    const toPlayer = await Player.findOne({ id: toPlayerId, sessionId });
    
    if (!fromPlayer || !toPlayer) {
      return res.status(404).json({ error: 'One or both players not found' });
    }
    
    // Check if in same location
    if (fromPlayer.currentLocation !== toPlayer.currentLocation) {
      return res.status(400).json({ error: 'Players must be in the same location to transfer items' });
    }
    
    // Check if sender has enough of the item
    const senderQuantity = fromPlayer.inventory.get(item) || 0;
    if (senderQuantity < quantity) {
      return res.status(400).json({ error: 'Not enough items to transfer' });
    }
    
    // Update inventories
    fromPlayer.inventory.set(item, senderQuantity - quantity);
    toPlayer.inventory.set(item, (toPlayer.inventory.get(item) || 0) + quantity);
    
    // Save changes
    await fromPlayer.save();
    await toPlayer.save();
    
    // Create system message about transfer
    const transferMessage = new Message({
      id: uuidv4(),
      sessionId,
      senderId: 'system',
      senderName: 'System',
      content: `${fromPlayer.name} gave ${quantity} ${item} to ${toPlayer.name}.`,
      isSystemMessage: true
    });
    
    await transferMessage.save();
    
    // Notify players
    io.to(sessionId).emit('itemTransferred', {
      fromPlayerId,
      fromPlayerName: fromPlayer.name,
      toPlayerId,
      toPlayerName: toPlayer.name,
      item,
      quantity
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error transferring item:', error);
    res.status(500).json({ error: 'Failed to transfer item' });
  }
});

// 7. Update player location
app.post('/updateLocation', async (req, res) => {
  try {
    const { sessionId, playerId, location } = req.body;
    
    // Check API key
    const providedApiKey = req.headers.authorization?.split(' ')[1];
    if (providedApiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Get player
    const player = await Player.findOne({ id: playerId, sessionId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Remember old location
    const oldLocation = player.currentLocation;
    
    // Update location
    player.currentLocation = location;
    player.lastActivity = new Date();
    await player.save();
    
    // Notify players about movement
    io.to(sessionId).emit('playerMoved', {
      playerId: player.id,
      playerName: player.name,
      fromLocation: oldLocation,
      toLocation: location
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
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
  console.log(`Stranded Astronaut Server v${SERVER_VERSION} running on port ${PORT}`);
});
