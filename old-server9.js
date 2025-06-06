const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Global feed items storage
global.allFeedItems = [];
// Global direct messages storage
global.directMessages = {};
// Global username to userId mapping
global.usernameMappings = {};
// Global pending direct messages storage
global.pendingDirectMessages = {};
// Global media content storage
global.mediaContent = {};
// Maximum media size limit (10MB)
const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '20mb' })); // Increase JSON size limit for base64 data

// API Key validation middleware
const validateApiKey = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized - Missing or invalid API key' });
    }
    
    const apiKey = authHeader.split(' ')[1];
    // Simple API key for demo purposes - in production use a secure method
    if (apiKey !== 'b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA') {
        return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    }
    
    next();
};

// In-memory storage for game sessions
const gameSessions = {};

// In-memory storage for players
const players = {};

// Routes
app.get('/', (req, res) => {
    res.send('Stranded Astronaut Multiplayer Server v2.3 with Resistance Feed Support');
});

// Ping endpoint for connection checking
app.post('/ping', validateApiKey, (req, res) => {
    res.json({ success: true, timestamp: Date.now() });
});

// Create or join a session
app.post('/join', validateApiKey, (req, res) => {
    console.log('Join request received with body:', req.body);
    
    const { sessionId, playerName, sessionName, appName } = req.body;
    
    // Generate a player ID
    const playerId = uuidv4();
    
    // Special case for dWorld app - always use a single shared session
    if (appName === "dWorld") {
        const DWORLD_SESSION_ID = "dworld-global-session";
        
        // Create the session if it doesn't exist yet
        if (!gameSessions[DWORLD_SESSION_ID]) {
            console.log(`Creating dedicated dWorld session: ${DWORLD_SESSION_ID}`);
            
            gameSessions[DWORLD_SESSION_ID] = {
                id: DWORLD_SESSION_ID,
                createdAt: new Date(),
                players: {},
                gameFacts: getDefaultGameFacts(),
                sessionName: "dWorld Global Session",
                globalTurn: 0,
                timeElapsed: "1h 0m",
                preserveClientState: true,
                plotQuestions: {},
                feedItems: [],
                messages: []
            };
            
            // Add any global feed items to this session
            if (global.allFeedItems && global.allFeedItems.length > 0) {
                gameSessions[DWORLD_SESSION_ID].feedItems = [...global.allFeedItems];
            }
        }
        
        // Add the player to the dWorld session
        const player = createPlayer(playerId, playerName);
        gameSessions[DWORLD_SESSION_ID].players[playerId] = player;
        players[playerId] = {
            id: playerId,
            sessionId: DWORLD_SESSION_ID
        };
        
        // Register username mapping
        updateUsernameMapping(playerName, playerId);
        
        // Return the session info
        return res.json({
            sessionId: DWORLD_SESSION_ID,
            sessionName: "dWorld Global Session",
            shortCode: "DWORLD",
            player: player,
            globalTurn: gameSessions[DWORLD_SESSION_ID].globalTurn || 0,
            timeElapsed: gameSessions[DWORLD_SESSION_ID].timeElapsed || "1h 0m"
        });
    }
    
    // If sessionId is provided, try to join an existing session
    if (sessionId) {
        console.log(`Attempting to join with provided ID: ${sessionId}`);
        
        // First, try exact match
        if (gameSessions[sessionId]) {
            console.log(`Found session with exact ID match: ${sessionId}`);
            return joinExistingSession(sessionId, playerId, playerName, res);
        }
        
        // Next, try as a short code (case-insensitive)
        const shortCodeToCheck = sessionId.toLowerCase();
        console.log(`Checking short code: ${shortCodeToCheck}`);
        
        // List all available sessions for debugging
        console.log('Available sessions:');
        Object.keys(gameSessions).forEach(id => {
            const shortCode = id.substring(0, 6).toLowerCase();
            console.log(`- ID: ${id}, Short Code: ${shortCode}`);
        });
        
        for (const id in gameSessions) {
            const shortCode = id.substring(0, 6).toLowerCase();
            if (shortCode === shortCodeToCheck) {
                console.log(`Found session with short code: ${shortCodeToCheck}`);
                return joinExistingSession(id, playerId, playerName, res);
            }
        }
        
        // Try as a session name
        if (sessionId.length > 6) { // Only try for longer strings that might be names
            console.log(`Checking as name: ${sessionId}`);
            for (const id in gameSessions) {
                const session = gameSessions[id];
                const sessionNameLower = (session.sessionName || '').toLowerCase();
                const searchNameLower = sessionId.toLowerCase();
                
                console.log(`Comparing "${sessionNameLower}" with "${searchNameLower}"`);
                
                if (sessionNameLower === searchNameLower) {
                    console.log(`Found session with name: ${sessionId}`);
                    return joinExistingSession(id, playerId, playerName, res);
                }
            }
        }
        
        // If we got here, no matching session was found
        console.log(`No matching session found for: ${sessionId}`);
        return res.status(404).json({ error: 'Game session not found' });
    }
    
    // Create a new session
    const newSessionId = uuidv4();
    console.log(`Creating new session with ID: ${newSessionId}, shortId: ${newSessionId.substring(0, 6).toUpperCase()}`);

    // Initialize the game session with the provided session name or a default
    const actualSessionName = sessionName || `Game-${newSessionId.substring(0, 6)}`;

    gameSessions[newSessionId] = {
        id: newSessionId,
        createdAt: new Date(),
        players: {},
        gameFacts: getDefaultGameFacts(),
        sessionName: actualSessionName,
        globalTurn: 0,
        timeElapsed: "1h 0m",           // Initialize with non-zero time
        preserveClientState: true,       // Add flag to preserve client state during syncs
        plotQuestions: {},               // Initialize empty plot questions
        feedItems: [],                   // Initialize empty feed items array
        messages: []                     // Initialize empty messages array
    };

    // Add any global feed items to this new session
    if (global.allFeedItems && global.allFeedItems.length > 0) {
        gameSessions[newSessionId].feedItems = [...global.allFeedItems];
        console.log(`Added ${global.allFeedItems.length} global feed items to new session`);
    }

    // Add the player to the session
    const player = createPlayer(playerId, playerName);
    gameSessions[newSessionId].players[playerId] = player;
    players[playerId] = {
        id: playerId,
        sessionId: newSessionId
    };

    // Register username mapping
    updateUsernameMapping(playerName, playerId);

    // Return the session info
    res.json({
        sessionId: newSessionId,
        sessionName: actualSessionName,
        shortCode: newSessionId.substring(0, 6).toUpperCase(),
        player: player,
        globalTurn: 0,
        timeElapsed: "1h 0m"
    });
});

// Helper function to join an existing session
function joinExistingSession(sessionId, playerId, playerName, res) {
    if (!gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Game session not found' });
    }
    
    // Create the player
    const player = createPlayer(playerId, playerName);
    
    // Add player to session
    gameSessions[sessionId].players[playerId] = player;
    players[playerId] = {
        id: playerId,
        sessionId: sessionId
    };
    
    // Register username mapping
    updateUsernameMapping(playerName, playerId);
    
    // Ensure this session has all feed items from the global pool
    if (!gameSessions[sessionId].feedItems) {
        gameSessions[sessionId].feedItems = [];
    }
    
    // Add any global feed items not already in this session
    if (global.allFeedItems && global.allFeedItems.length > 0) {
        global.allFeedItems.forEach(item => {
            // Only add if not already present (by ID)
            const exists = gameSessions[sessionId].feedItems.some(
                existingItem => existingItem.id === item.id
            );
            
            if (!exists) {
                gameSessions[sessionId].feedItems.push(item);
            }
        });
    }
    
    // Return the session info
    res.json({
        sessionId: sessionId,
        sessionName: gameSessions[sessionId].sessionName,
        shortCode: sessionId.substring(0, 6).toUpperCase(),
        player: player,
        globalTurn: gameSessions[sessionId].globalTurn || 0,
        timeElapsed: gameSessions[sessionId].timeElapsed || "1h 0m",
        preserveClientState: true
    });
}

// Helper to create a player object
function createPlayer(id, name) {
    return {
        id: id,
        name: name || 'Player',
        role: 'Member',
        isHuman: true,
        isActive: true,
        currentLocation: '0,1,2,1,2', // Start in CryoPod
        inventory: {},
        lastActivity: new Date(),
        // New profile data for resistance feed
        profileData: {
            username: name || 'Anonymous',
            organizations: ["Resistance"],
            topicFilters: [],
            dateJoined: new Date()
        }
    };
}

// Leave a session
app.post('/leave', validateApiKey, (req, res) => {
    const { sessionId, playerId } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    // Remove player from session
    delete gameSessions[sessionId].players[playerId];
    delete players[playerId];
    
    // Check if session is empty and clean up if needed
    if (Object.keys(gameSessions[sessionId].players).length === 0) {
        console.log(`Removing empty session: ${sessionId}`);
        delete gameSessions[sessionId];
    }
    
    res.json({ success: true });
});

// Lookup a session (debugging endpoint)
app.post('/lookup', validateApiKey, (req, res) => {
    console.log('Lookup request received with body:', req.body);
    
    // List all sessions for debugging
    console.log('All available sessions:');
    Object.entries(gameSessions).forEach(([id, session]) => {
        console.log(`- ID: ${id}, Name: ${session.sessionName}, Short code: ${id.substring(0, 6).toUpperCase()}`);
    });
    
    const { sessionId, sessionName } = req.body;
    
    // Respond with matching session info or not found
    res.json({
        sessions: Object.entries(gameSessions).map(([id, session]) => ({
            id: id,
            name: session.sessionName,
            shortCode: id.substring(0, 6).toUpperCase(),
            playerCount: Object.keys(session.players).length,
            globalTurn: session.globalTurn || 0,
            timeElapsed: session.timeElapsed || "1h 0m"
        }))
    });
});

// Helper function to register/update a username mapping
function updateUsernameMapping(username, userId) {
  if (!username || !userId) return;
  
  // Normalize username to handle case sensitivity
  const normalizedName = username.toLowerCase();
  
  // Update or create the mapping
  global.usernameMappings[normalizedName] = userId;
  console.log(`Username mapping updated: ${normalizedName} -> ${userId}`);
  
  // Check if this user has pending messages
  checkAndDeliverPendingMessages(username, userId);
}

// Helper to look up a userId by username
function getUserIdByUsername(username) {
  if (!username) return null;
  
  const normalizedName = username.toLowerCase();
  return global.usernameMappings[normalizedName] || null;
}

// Helper to deliver any pending messages
function checkAndDeliverPendingMessages(username, userId) {
  // Skip if no mapping exists
  if (!global.pendingDirectMessages) return;
  
  // Check if there are pending messages for this username
  const normalizedName = username.toLowerCase();
  if (global.pendingDirectMessages[normalizedName]) {
    console.log(`Found ${global.pendingDirectMessages[normalizedName].length} pending messages for ${username}`);
    
    // Initialize user's inbox if needed
    if (!global.directMessages) {
      global.directMessages = {};
    }
    
    if (!global.directMessages[userId]) {
      global.directMessages[userId] = [];
    }
    
    // Move all pending messages to the user's inbox
    global.pendingDirectMessages[normalizedName].forEach(message => {
      global.directMessages[userId].push(message);
      console.log(`Delivered pending message to ${username} (${userId}): ${message.title}`);
    });
    
    // Clear pending messages
    delete global.pendingDirectMessages[normalizedName];
  }
}

// Helper to notify a recipient if they're online
function notifyRecipientIfOnline(recipientId, directMessage) {
  // Check all sessions for the recipient
  Object.values(gameSessions).forEach(session => {
    if (session.players[recipientId]) {
      // Create notification
      const notification = {
        id: uuidv4(),
        sessionId: session.id,
        senderId: "system",
        senderName: "System",
        targetId: recipientId,
        content: `NEW_DIRECT_MESSAGE:${JSON.stringify({
          id: directMessage.id,
          sender: directMessage.sender.name,
          title: directMessage.title
        })}`,
        timestamp: new Date().getTime(),
        isSystemMessage: true
      };
      
      // Add to session messages
      if (!session.messages) {
        session.messages = [];
      }
      session.messages.push(notification);
      console.log(`Notification sent to recipient ${recipientId} in session ${session.id}`);
    }
  });
}

// Send a message
app.post('/message', validateApiKey, (req, res) => {
    const { sessionId, senderId, targetId, content } = req.body;
    
    if (!gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    if (!gameSessions[sessionId].players[senderId]) {
        return res.status(404).json({ error: 'Sender not found' });
    }
    
    if (targetId && !gameSessions[sessionId].players[targetId]) {
        return res.status(404).json({ error: 'Target player not found' });
    }
    
    // Create message object
    const message = {
        id: uuidv4(),
        sessionId: sessionId,
        senderId: senderId,
        senderName: gameSessions[sessionId].players[senderId].name,
        targetId: targetId || null,
        content: content,
        timestamp: new Date().getTime(),
        isSystemMessage: false
    };
    
    // Add message to session
    if (!gameSessions[sessionId].messages) {
        gameSessions[sessionId].messages = [];
    }
    gameSessions[sessionId].messages.push(message);
    
    // Limit message history
    if (gameSessions[sessionId].messages.length > 100) {
        gameSessions[sessionId].messages.shift();
    }
    
    // Check if this is a feed item message and distribute it globally
    if (content && content.startsWith('FEED_ITEM:')) {
        try {
            // Extract the feed item data
            const jsonStart = content.indexOf('FEED_ITEM:') + 'FEED_ITEM:'.length;
            const jsonString = content.substring(jsonStart);
            const feedItem = JSON.parse(jsonString);
            
            console.log(`Received feed item via message: ${feedItem.title}`);
            
            // Process any media content in the feed item
            const processedItem = processMediaContent(feedItem);
            
            // Add to global feed items if not already present
            if (!global.allFeedItems) {
                global.allFeedItems = [];
            }
            
            const alreadyInGlobal = global.allFeedItems.some(item => item.id === processedItem.id);
            if (!alreadyInGlobal) {
                global.allFeedItems.push(processedItem);
                console.log(`Added feed item to global pool: ${processedItem.id}`);
            }
            
            // Add to all sessions
            Object.values(gameSessions).forEach(session => {
                // Initialize feed items array if needed
                if (!session.feedItems) {
                    session.feedItems = [];
                }
                
                // Add if not already in this session
                const alreadyInSession = session.feedItems.some(item => item.id === processedItem.id);
                if (!alreadyInSession) {
                    session.feedItems.push(processedItem);
                    console.log(`Added feed item to session ${session.id}: ${processedItem.id}`);
                }
            });
        } catch (error) {
            console.error('Error processing feed item message:', error);
        }
    }
    
    res.json({ success: true });
});

// Perform an action
app.post('/action', validateApiKey, (req, res) => {
    const { sessionId, playerId, action } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    // Update player's last activity time
    gameSessions[sessionId].players[playerId].lastActivity = new Date();
    
    // Increment global turn counter for each action
    if (!gameSessions[sessionId].globalTurn) {
        gameSessions[sessionId].globalTurn = 0;
    }
    gameSessions[sessionId].globalTurn += 1;
    
    // Return the updated global turn
    res.json({
        result: `Action "${action}" received`,
        globalTurn: gameSessions[sessionId].globalTurn
    });
});

// Update player location
app.post('/updateLocation', validateApiKey, (req, res) => {
    const { sessionId, playerId, locationId } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    const player = gameSessions[sessionId].players[playerId];
    const oldLocation = player.currentLocation;
    player.currentLocation = locationId;
    player.lastActivity = new Date();
    
    console.log(`Location update for player ${player.name} in session ${sessionId}: ${oldLocation} → ${locationId}`);
    
    res.json({
        success: true,
        previousLocation: oldLocation,
        newLocation: locationId
    });
});

// Update session time elapsed
app.post('/updateTime', validateApiKey, (req, res) => {
    const { sessionId, timeElapsed } = req.body;
    
    if (!gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    // Update the time elapsed in the session
    if (timeElapsed !== "0h 0m") {  // Don't accept zero time updates
        gameSessions[sessionId].timeElapsed = timeElapsed;
        
        // Update game facts if they exist
        if (gameSessions[sessionId].gameFacts) {
            gameSessions[sessionId].gameFacts.timeElapsed = timeElapsed;
        }
    }
    
    res.json({
        success: true,
        timeElapsed: gameSessions[sessionId].timeElapsed
    });
});

// Transfer item between players
app.post('/transferItem', validateApiKey, (req, res) => {
    const { sessionId, fromPlayerId, toPlayerId, item, quantity } = req.body;
    
    if (!gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    if (!gameSessions[sessionId].players[fromPlayerId]) {
        return res.status(404).json({ error: 'Sender not found' });
    }
    
    if (!gameSessions[sessionId].players[toPlayerId]) {
        return res.status(404).json({ error: 'Recipient not found' });
    }
    
    const fromPlayer = gameSessions[sessionId].players[fromPlayerId];
    const toPlayer = gameSessions[sessionId].players[toPlayerId];
    
    // Check if sender has the item
    if (!fromPlayer.inventory[item] || fromPlayer.inventory[item] < quantity) {
        return res.status(400).json({ error: 'Not enough items to transfer' });
    }
    
    // Transfer the item
    fromPlayer.inventory[item] -= quantity;
    toPlayer.inventory[item] = (toPlayer.inventory[item] || 0) + quantity;
    
    // Clean up inventory (remove items with zero quantity)
    if (fromPlayer.inventory[item] <= 0) {
        delete fromPlayer.inventory[item];
    }
    
    res.json({ success: true });
});

// NEW ENDPOINT: Sync plot state
app.post('/syncPlotState', validateApiKey, (req, res) => {
    const { sessionId, playerId, plotQuestions } = req.body;
    
    console.log(`Plot sync request received from player ${playerId}`);
    
    if (!gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    if (!gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    // If the request contains plot questions, update the session's plot state
    if (plotQuestions && typeof plotQuestions === 'object') {
        console.log(`Updating plot state for session ${sessionId}`);
        console.log(`Received ${Object.keys(plotQuestions).length} plot questions`);
        
        // Initialize if not exists
        if (!gameSessions[sessionId].plotQuestions) {
            gameSessions[sessionId].plotQuestions = {};
        }
        
        // Update with new plot questions
        for (const [number, questionData] of Object.entries(plotQuestions)) {
            // Only update if the question has a valid state
            if (questionData && questionData.state) {
                console.log(`Updating question ${number} to state: ${questionData.state}`);
                
                // Store or update this question
                gameSessions[sessionId].plotQuestions[number] = {
                    ...questionData,
                    lastUpdated: new Date().getTime(),
                    updatedBy: playerId
                };
            }
        }
        
        // Create a broadcast message for all clients
        const broadcastMessage = {
            id: uuidv4(),
            sessionId: sessionId,
            senderId: "system",
            senderName: "System",
            targetId: null,
            content: `PLOT_STATE_UPDATE:${JSON.stringify(gameSessions[sessionId].plotQuestions)}`,
            timestamp: new Date().getTime(),
            isSystemMessage: true
        };
        
        // Add to session messages
        if (!gameSessions[sessionId].messages) {
            gameSessions[sessionId].messages = [];
        }
        gameSessions[sessionId].messages.push(broadcastMessage);
        
        // Limit message history
        if (gameSessions[sessionId].messages.length > 100) {
            gameSessions[sessionId].messages.shift();
        }
        
        console.log(`Plot state update broadcast to all clients in session ${sessionId}`);
    }
    
    // Return the current plot state from the server
    res.json({
        success: true,
        plotQuestions: gameSessions[sessionId].plotQuestions || {}
    });
});

// Sync game state
app.post('/sync', validateApiKey, (req, res) => {
    const { sessionId, playerId, includeAllItems } = req.body;
    
    if (!gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    if (!gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    // Get the base URL for media references
    const getBaseUrl = (req) => {
        return `${req.protocol}://${req.get('host')}`;
    };
    const baseUrl = getBaseUrl(req);
    
    // Update player's last activity time
    gameSessions[sessionId].players[playerId].lastActivity = new Date();
    
    // Filter players by activity (last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const activePlayers = {};
    
    for (const pid in gameSessions[sessionId].players) {
        const player = gameSessions[sessionId].players[pid];
        if (new Date(player.lastActivity) > fiveMinutesAgo) {
            activePlayers[pid] = player;
        }
    }
    
    // Get players in the same location
    const currentLocation = gameSessions[sessionId].players[playerId].currentLocation;
    const playersInLocation = Object.values(activePlayers).filter(p =>
        p.currentLocation === currentLocation
    );
    
    // Initialize feedItems arrays if needed
    if (!global.allFeedItems) {
        global.allFeedItems = [];
    }
    
    if (!gameSessions[sessionId].feedItems) {
        gameSessions[sessionId].feedItems = [];
    }
    
    // Make sure the session has the latest feed items
    global.allFeedItems.forEach(item => {
        const exists = gameSessions[sessionId].feedItems.some(
            sessionItem => sessionItem.id === item.id
        );
        
        if (!exists) {
            gameSessions[sessionId].feedItems.push(item);
        }
    });
    
    // Determine which feed items to send
    let feedItemsToSend = includeAllItems === true
        ? global.allFeedItems
        : gameSessions[sessionId].feedItems;
    
    // Update media URLs to be absolute URLs
    feedItemsToSend = feedItemsToSend.map(item => {
        // Create a copy to avoid modifying the original
        const processedItem = { ...item };
        
        // Fix image URLs
        if (processedItem.type === 'image' &&
            processedItem.imageUrl &&
            processedItem.imageUrl.startsWith('/media/')) {
            processedItem.imageUrl = `${baseUrl}${processedItem.imageUrl}`;
        }
        
        // Fix video URLs
        if (processedItem.type === 'video' &&
            processedItem.videoUrl &&
            processedItem.videoUrl.startsWith('/media/')) {
            processedItem.videoUrl = `${baseUrl}${processedItem.videoUrl}`;
        }
        
        // Fix audio URLs
        if (processedItem.type === 'audio' &&
            processedItem.audioUrl &&
            processedItem.audioUrl.startsWith('/media/')) {
            processedItem.audioUrl = `${baseUrl}${processedItem.audioUrl}`;
        }
        
        return processedItem;
    });
    
    // Prepare response data
    const responseData = {
        sessionId: sessionId,
        sessionName: gameSessions[sessionId].sessionName,
        shortCode: sessionId.substring(0, 6).toUpperCase(),
        player: gameSessions[sessionId].players[playerId],
        allPlayers: Object.values(activePlayers),
        playersInLocation: playersInLocation,
        messages: gameSessions[sessionId].messages || [],
        gameFacts: gameSessions[sessionId].gameFacts || getDefaultGameFacts(),
        globalTurn: gameSessions[sessionId].globalTurn || 0,
        timeElapsed: gameSessions[sessionId].timeElapsed || "1h 0m",
        preserveClientState: true,  // Always tell client to preserve its own state
        plotQuestions: gameSessions[sessionId].plotQuestions || {},  // Include plot questions in sync
        feedItems: feedItemsToSend || [],  // Send feed items to client
        serverInfo: {
            mediaSupport: true,  // Indicate that server supports media content
            maxMediaSize: MAX_MEDIA_SIZE,  // Inform client about max media size
            serverUrl: baseUrl  // Provide server base URL for media references
        }
    };

    // Process direct messages to fix media URLs
    if (global.directMessages && global.directMessages[playerId]) {
        const processedMessages = global.directMessages[playerId].map(msg => {
            const processedMsg = { ...msg };
            
            // Check if this is a media message and update URLs
            if (processedMsg.contentType === 'image' &&
                processedMsg.content &&
                processedMsg.content.startsWith('/media/')) {
                processedMsg.content = `${baseUrl}${processedMsg.content}`;
            }
            
            if (processedMsg.contentType === 'video' &&
                processedMsg.content &&
                processedMsg.content.startsWith('/media/')) {
                processedMsg.content = `${baseUrl}${processedMsg.content}`;
            }
            
            if (processedMsg.contentType === 'audio' &&
                processedMsg.content &&
                processedMsg.content.startsWith('/media/')) {
                processedMsg.content = `${baseUrl}${processedMsg.content}`;
            }
            
            return processedMsg;
        });
        
        // Check for unread direct messages
        const hasUnreadMessages = processedMessages.some(msg => !msg.read);
        
        // Add to responseData
        responseData.hasUnreadDirectMessages = hasUnreadMessages;
        responseData.directMessages = processedMessages;
    } else {
        responseData.hasUnreadDirectMessages = false;
        responseData.directMessages = [];
    }

    res.json(responseData);
});

// Organizations endpoint
app.post('/organizations', validateApiKey, (req, res) => {
    // Sample organizations - in a real app, these would come from a database
    const organizations = [
        {
            id: "org1",
            name: "Resistance",
            description: "The default organization for all users fighting for freedom of information.",
            authorRoles: ["Member", "Editor", "Admin"]
        },
        {
            id: "org2",
            name: "Free Press Alliance",
            description: "A coalition of journalists dedicated to independent reporting.",
            authorRoles: ["Editor", "Admin"]
        },
        {
            id: "org3",
            name: "Digital Rights Network",
            description: "Advocates for privacy and digital freedom in the surveillance age.",
            authorRoles: ["Member", "Editor", "Admin"]
        },
        {
            id: "org4",
            name: "Truth Seekers",
            description: "Independent investigators uncovering hidden facts.",
            authorRoles: ["Member", "Editor", "Admin"]
        },
        {
            id: "org5",
            name: "Community Voice",
            description: "Grassroots movement focused on local impact stories.",
            authorRoles: ["Editor", "Admin"]
        }
    ];
    
    res.json({ organizations });
});

// Direct Messaging endpoint
app.post('/directMessages', validateApiKey, (req, res) => {
    const { sessionId, playerId, action, messageId, message } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    // Get the base URL for media references
    const getBaseUrl = (req) => {
        return `${req.protocol}://${req.get('host')}`;
    };
    const baseUrl = getBaseUrl(req);
    
    // Initialize direct messages structure if needed
    if (!global.directMessages) {
        global.directMessages = {};
    }
    
    // Handle different actions
    switch (action) {
        case 'send':
            if (message && message.recipients && message.recipients.length > 0) {
                console.log(`Sending direct message to ${message.recipients.length} recipients`);
                
                // Process any media content in the message
                let processedContent = message.content || '';
                let processedContentType = message.contentType || 'text';
                
                // Handle media content in direct messages
                if (message.contentType === 'image' && message.content && message.content.startsWith('data:image/')) {
                    // Process image data
                    const mediaId = uuidv4();
                    const imgData = processDataUrl(message.content);
                    
                    if (imgData) {
                        // Store the binary data
                        global.mediaContent[mediaId] = {
                            type: 'image',
                            data: imgData,
                            contentType: getContentTypeFromDataUrl(message.content)
                        };
                        
                        // Replace data URL with a reference URL
                        processedContent = `/media/${mediaId}`;
                        console.log(`Processed image data for direct message ${mediaId}, size: ${imgData.length} bytes`);
                    }
                } else if (message.contentType === 'video' && message.content && message.content.startsWith('data:video/')) {
                    // Process video data
                    const mediaId = uuidv4();
                    const videoData = processDataUrl(message.content);
                    
                    if (videoData) {
                        // Store the binary data
                        global.mediaContent[mediaId] = {
                            type: 'video',
                            data: videoData,
                            contentType: getContentTypeFromDataUrl(message.content)
                        };
                        
                        // Replace data URL with a reference URL
                        processedContent = `/media/${mediaId}`;
                        console.log(`Processed video data for direct message ${mediaId}, size: ${videoData.length} bytes`);
                    }
                } else if (message.contentType === 'audio' && message.content && message.content.startsWith('data:audio/')) {
                    // Process audio data
                    const mediaId = uuidv4();
                    const audioData = processDataUrl(message.content);
                    
                    if (audioData) {
                        // Store the binary data
                        global.mediaContent[mediaId] = {
                            type: 'audio',
                            data: audioData,
                            contentType: getContentTypeFromDataUrl(message.content)
                        };
                        
                        // Replace data URL with a reference URL
                        processedContent = `/media/${mediaId}`;
                        console.log(`Processed audio data for direct message ${mediaId}, size: ${audioData.length} bytes`);
                    }
                }
                
                // Create a direct message object
                const directMessage = {
                    id: uuidv4(),
                    sender: {
                        id: playerId,
                        name: gameSessions[sessionId].players[playerId].name || 'Unknown',
                        organization: message.organization || 'Resistance'
                    },
                    title: message.title || 'No Subject',
                    content: processedContent,
                    contentType: processedContentType,
                    timestamp: new Date().toISOString(),
                    read: false
                };
                
                // Store for each recipient
                message.recipients.forEach(recipientId => {
                    // Initialize recipient's inbox if needed
                    if (!global.directMessages[recipientId]) {
                        global.directMessages[recipientId] = [];
                    }
                    
                    // Add message to recipient's inbox
                    global.directMessages[recipientId].push(directMessage);
                    
                    console.log(`Direct message stored for recipient: ${recipientId}`);
                    
                    // Notify recipient if online
                    Object.values(gameSessions).forEach(session => {
                        if (session.players[recipientId]) {
                            // Create notification
                            const notification = {
                                id: uuidv4(),
                                sessionId: session.id,
                                senderId: "system",
                                senderName: "System",
                                targetId: recipientId,
                                content: `NEW_DIRECT_MESSAGE:${JSON.stringify({
                                    id: directMessage.id,
                                    sender: directMessage.sender.name,
                                    title: directMessage.title,
                                    contentType: directMessage.contentType
                                })}`,
                                timestamp: new Date().getTime(),
                                isSystemMessage: true
                            };
                            
                            // Add to session messages
                            if (!session.messages) {
                                session.messages = [];
                            }
                            session.messages.push(notification);
                        }
                    });
                });
                
                res.json({ success: true, messageId: directMessage.id });
            } else {
                res.status(400).json({ error: 'Missing message data or recipients' });
            }
            break;
            
        case 'get':
            // Return all direct messages for the user
            console.log(`Retrieving direct messages for player: ${playerId}`);
            
            if (!global.directMessages[playerId]) {
                global.directMessages[playerId] = [];
            }
            
            // Process media URLs to be absolute
            const processedMessages = global.directMessages[playerId].map(message => {
                // Create a copy to avoid modifying the original
                const processedMsg = { ...message };
                
                // Convert relative media URLs to absolute
                if ((processedMsg.contentType === 'image' ||
                     processedMsg.contentType === 'video' ||
                     processedMsg.contentType === 'audio') &&
                    processedMsg.content &&
                    processedMsg.content.startsWith('/media/')) {
                    processedMsg.content = `${baseUrl}${processedMsg.content}`;
                }
                
                return processedMsg;
            });
            
            res.json({
                success: true,
                messages: processedMessages || []
            });
            break;
            
        case 'markAsRead':
            // Mark a message as read
            if (messageId) {
                console.log(`Marking message as read: ${messageId}`);
                
                if (global.directMessages[playerId]) {
                    const messageIndex = global.directMessages[playerId].findIndex(msg => msg.id === messageId);
                    
                    if (messageIndex !== -1) {
                        global.directMessages[playerId][messageIndex].read = true;
                        console.log(`Message marked as read`);
                    }
                }
                
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'Missing message ID' });
            }
            break;
            
        case 'delete':
            // Delete a message
            if (messageId) {
                console.log(`Deleting message: ${messageId}`);
                
                if (global.directMessages[playerId]) {
                    global.directMessages[playerId] = global.directMessages[playerId].filter(
                        msg => msg.id !== messageId
                    );
                    console.log(`Message deleted`);
                }
                
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'Missing message ID' });
            }
            break;
            
        default:
            res.status(400).json({ error: 'Unknown action' });
    }
});

// Feed operations endpoint
app.post('/feed', validateApiKey, (req, res) => {
    const { sessionId, playerId, action, feedItem, feedItemId } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    // Initialize global feed items array if it doesn't exist
    if (!global.allFeedItems) {
        global.allFeedItems = [];
    }
    
    // Initialize feed items array for this session if it doesn't exist
    if (!gameSessions[sessionId].feedItems) {
        gameSessions[sessionId].feedItems = [];
    }
    
    // Handle different actions
    switch (action) {
        case 'publish':
            // Add the feed item to both the global feed and the session's feed
            if (feedItem) {
                console.log(`Publishing feed item: ${feedItem.title} [${feedItem.id}]`);
                
                // Process the feed item - but make it safer
                let processedItem;
                try {
                    // Only process media if needed
                    if (feedItem.type === 'image' || feedItem.type === 'video' || feedItem.type === 'audio') {
                        processedItem = processMediaContent(feedItem);
                    } else {
                        // For text and other non-media items, use as-is
                        processedItem = feedItem;
                    }
                } catch (error) {
                    console.error("Error processing media:", error);
                    // Fall back to the original item if processing fails
                    processedItem = feedItem;
                }
                
                // Check if this is a comment (has a parentId) and update the parent's comment count
                if (processedItem.parentId) {
                    console.log(`Item is a comment with parentId: ${processedItem.parentId}`);
                    
                    // Find the parent item in the global feed
                    const parentGlobalIndex = global.allFeedItems.findIndex(item =>
                        item.id === processedItem.parentId
                    );
                    
                    if (parentGlobalIndex !== -1) {
                        // Increment the comment count on the parent
                        if (!global.allFeedItems[parentGlobalIndex].commentCount) {
                            global.allFeedItems[parentGlobalIndex].commentCount = 0;
                        }
                        global.allFeedItems[parentGlobalIndex].commentCount += 1;
                        
                        console.log(`Updated parent item comment count to ${global.allFeedItems[parentGlobalIndex].commentCount}`);
                    }
                }
                
                // Add to global feed items if not already there
                const alreadyInGlobal = global.allFeedItems.some(item => item.id === processedItem.id);
                if (!alreadyInGlobal) {
                    global.allFeedItems.push(processedItem);
                    console.log(`Added item to global feed items pool`);
                }
                
                // Add to session feed items if not already there
                const alreadyInSession = gameSessions[sessionId].feedItems.some(item => item.id === processedItem.id);
                if (!alreadyInSession) {
                    gameSessions[sessionId].feedItems.push(processedItem);
                    console.log(`Added item to session ${sessionId} feed items`);
                }
                
                // Also create a message to notify all users
                const messageContent = `FEED_ITEM:${JSON.stringify(processedItem)}`;
                
                // Add to all active sessions for propagation
                Object.keys(gameSessions).forEach(sessId => {
                    const session = gameSessions[sessId];
                    
                    // Create message object for each session
                    const message = {
                        id: uuidv4(),
                        sessionId: sessId,
                        senderId: playerId,
                        senderName: gameSessions[sessionId].players[playerId].name,
                        targetId: null,
                        content: messageContent,
                        timestamp: new Date().getTime(),
                        isSystemMessage: false
                    };
                    
                    // Initialize messages array if needed
                    if (!session.messages) {
                        session.messages = [];
                    }
                    
                    // Add message to session
                    session.messages.push(message);
                    
                    // Add feed item to session's feed items
                    if (!session.feedItems) {
                        session.feedItems = [];
                    }
                    
                    // Only add if not already present (by ID)
                    const alreadyInTargetSession = session.feedItems.some(item => item.id === processedItem.id);
                    if (!alreadyInTargetSession) {
                        session.feedItems.push(processedItem);
                        console.log(`Propagated feed item to session: ${sessId}`);
                    }
                    
                    // If this is a comment, ensure parent item is updated in this session too
                    if (processedItem.parentId) {
                        const parentSessionIndex = session.feedItems.findIndex(item =>
                            item.id === processedItem.parentId
                        );
                        
                        if (parentSessionIndex !== -1) {
                            // Ensure comment count field exists
                            if (!session.feedItems[parentSessionIndex].commentCount) {
                                session.feedItems[parentSessionIndex].commentCount = 0;
                            }
                            
                            // Update to match global count
                            const parentGlobalIndex = global.allFeedItems.findIndex(item =>
                                item.id === processedItem.parentId
                            );
                            
                            if (parentGlobalIndex !== -1) {
                                session.feedItems[parentSessionIndex].commentCount =
                                    global.allFeedItems[parentGlobalIndex].commentCount;
                            }
                        }
                    }
                });
                
                console.log(`Feed item ${processedItem.id} published to all sessions`);
                res.json({ success: true, feedItemId: processedItem.id });
            } else {
                res.status(400).json({ error: 'Missing feed item data' });
            }
            break;
            
        case 'getComments':
            // Get comments for a specific feed item
            if (feedItemId) {
                console.log(`Getting comments for feed item: ${feedItemId}`);
                
                // Find all comments with matching parentId
                const comments = global.allFeedItems.filter(item =>
                    item.parentId === feedItemId
                );
                
                console.log(`Found ${comments.length} comments for item ${feedItemId}`);
                
                res.json({
                    success: true,
                    comments: comments
                });
            } else {
                res.status(400).json({ error: 'Missing feed item ID' });
            }
            break;
            
        case 'get':
            // Return all feed items from the global pool
            console.log(`Returning ${global.allFeedItems.length} feed items`);
            res.json({
                success: true,
                feedItems: global.allFeedItems || []
            });
            break;
            
        case 'directMessage':
          // Process a direct message - sent to specific users only
          if (feedItem && feedItem.recipients && feedItem.recipients.length > 0) {
            console.log(`Sending direct message: ${feedItem.title} [${feedItem.id}] to ${feedItem.recipients.length} recipients`);
            
            // Process any media content in the message first
            let processedItem = processMediaContent(feedItem);
            
            // Create a copy with a new ID to avoid cross-referencing issues
            const directMessageItem = {
              ...processedItem,
              id: uuidv4(), // Generate a new unique ID for this message
              type: processedItem.type || 'text',
              sender: {
                id: playerId,
                name: gameSessions[sessionId].players[playerId].name || 'Unknown',
                organization: processedItem.organization || 'Unknown'
              },
              timestamp: new Date().toISOString()
            };
            
            // Initialize direct messages structure if needed
            if (!global.directMessages) {
              global.directMessages = {};
            }
            
            // Store the message for each recipient
            processedItem.recipients.forEach(recipientName => {
              // Try to find the recipient's ID using the mapping
              const recipientId = getUserIdByUsername(recipientName);
              
              if (recipientId) {
                // Recipient ID is known - deliver directly
                console.log(`Found ID for recipient ${recipientName}: ${recipientId}`);
                
                // Initialize recipient's inbox if needed
                if (!global.directMessages[recipientId]) {
                  global.directMessages[recipientId] = [];
                }
                
                // Add message to recipient's inbox
                global.directMessages[recipientId].push(directMessageItem);
                console.log(`Direct message stored for recipient: ${recipientId}`);
                
                // Notify recipient if online
                notifyRecipientIfOnline(recipientId, directMessageItem);
              } else {
                // Recipient ID unknown - store as pending
                const normalizedName = recipientName.toLowerCase();
                console.log(`Recipient ID unknown for ${recipientName} - storing as pending`);
                
                // Initialize pending messages if needed
                if (!global.pendingDirectMessages) {
                  global.pendingDirectMessages = {};
                }
                
                // Initialize pending messages array if needed
                if (!global.pendingDirectMessages[normalizedName]) {
                  global.pendingDirectMessages[normalizedName] = [];
                }
                
                // Store as pending
                global.pendingDirectMessages[normalizedName].push(directMessageItem);
                console.log(`Message stored as pending for ${recipientName}`);
              }
            });
            
            res.json({ success: true, messageId: directMessageItem.id });
          } else {
            res.status(400).json({ error: 'Missing feed item data or recipients' });
          }
          break;
        
        case 'update':
            // This handles updating an existing feed item (edit functionality)
            if (feedItem && feedItem.id) {
                console.log(`Updating feed item: ${feedItem.title} [${feedItem.id}]`);
                
                // Process media content if present
                let processedItem = processMediaContent(feedItem);
                
                // Find and update in global array
                const globalIndex = global.allFeedItems.findIndex(item => item.id === processedItem.id);
                if (globalIndex !== -1) {
                    // Update the item in the global pool
                    global.allFeedItems[globalIndex] = processedItem;
                    console.log(`Updated item in global feed items pool`);
                } else {
                    // If not found, add it as new
                    global.allFeedItems.push(processedItem);
                    console.log(`Item not found in global pool, adding as new`);
                }
                
                // Update in all sessions
                Object.keys(gameSessions).forEach(sessId => {
                    const session = gameSessions[sessId];
                    
                    if (!session.feedItems) {
                        session.feedItems = [];
                    }
                    
                    // Find the item in this session
                    const sessionIndex = session.feedItems.findIndex(item => item.id === processedItem.id);
                    if (sessionIndex !== -1) {
                        // Update the item
                        session.feedItems[sessionIndex] = processedItem;
                        console.log(`Updated item in session ${sessId}`);
                    } else {
                        // If not found, add it as new to this session
                        session.feedItems.push(processedItem);
                        console.log(`Item not found in session ${sessId}, adding`);
                    }
                    
                    // Create an update notification for each session
                    const updateMessage = {
                        id: uuidv4(),
                        sessionId: sessId,
                        senderId: playerId,
                        senderName: gameSessions[sessionId].players[playerId].name,
                        targetId: null,
                        content: `UPDATE_FEED_ITEM:${JSON.stringify(processedItem)}`,
                        timestamp: new Date().getTime(),
                        isSystemMessage: false
                    };
                    
                    // Initialize messages array if needed
                    if (!session.messages) {
                        session.messages = [];
                    }
                    
                    // Add message to session
                    session.messages.push(updateMessage);
                });
                
                // Special handling for direct messages updates
                if (processedItem.isDirectMessage && processedItem.recipients && processedItem.recipients.length > 0) {
                    console.log(`Updated direct message needs to be redistributed to recipients`);
                    
                    // For direct messages, we need to update in recipients' inboxes
                    processedItem.recipients.forEach(recipientName => {
                        const recipientId = getUserIdByUsername(recipientName);
                        
                        if (recipientId) {
                            // Make sure recipient has an inbox
                            if (!global.directMessages[recipientId]) {
                                global.directMessages[recipientId] = [];
                            }
                            
                            // Check if this message is already in their inbox
                            const messageIndex = global.directMessages[recipientId].findIndex(msg =>
                                msg.id === processedItem.id ||
                                (msg.originalId && msg.originalId === processedItem.id)
                            );
                            
                            if (messageIndex !== -1) {
                                // Update existing message
                                console.log(`Updating existing message in ${recipientName}'s inbox`);
                                global.directMessages[recipientId][messageIndex] = {
                                    id: global.directMessages[recipientId][messageIndex].id, // Keep original ID
                                    originalId: processedItem.id, // Store original ID for reference
                                    sender: {
                                        id: playerId,
                                        name: gameSessions[sessionId].players[playerId].name || 'Unknown',
                                        organization: processedItem.organization || 'Unknown'
                                    },
                                    title: processedItem.title || 'No Subject',
                                    content: processedItem.content || '',
                                    contentType: processedItem.type || 'text',
                                    timestamp: new Date().toISOString(),
                                    read: false // Mark as unread since it was updated
                                };
                                
                                // Send notification of update
                                notifyRecipientIfOnline(recipientId, global.directMessages[recipientId][messageIndex]);
                            } else {
                                // Add as new message
                                console.log(`Adding updated message as new to ${recipientName}'s inbox`);
                                const directMessage = {
                                    id: uuidv4(),
                                    originalId: processedItem.id, // Store original ID for reference
                                    sender: {
                                        id: playerId,
                                        name: gameSessions[sessionId].players[playerId].name || 'Unknown',
                                        organization: processedItem.organization || 'Unknown'
                                    },
                                    title: processedItem.title || 'No Subject',
                                    content: processedItem.content || '',
                                    contentType: processedItem.type || 'text',
                                    timestamp: new Date().toISOString(),
                                    read: false
                                };
                                
                                global.directMessages[recipientId].push(directMessage);
                                notifyRecipientIfOnline(recipientId, directMessage);
                            }
                        } else {
                            // Handle unknown recipients just like in the direct message case
                            const normalizedName = recipientName.toLowerCase();
                            console.log(`Recipient ID unknown for ${recipientName} - storing updated message as pending`);
                            
                            if (!global.pendingDirectMessages) {
                                global.pendingDirectMessages = {};
                            }
                            
                            if (!global.pendingDirectMessages[normalizedName]) {
                                global.pendingDirectMessages[normalizedName] = [];
                            }
                            
                            // Check if we already have a pending message with this ID
                            const pendingIndex = global.pendingDirectMessages[normalizedName].findIndex(msg =>
                                msg.id === processedItem.id ||
                                (msg.originalId && msg.originalId === processedItem.id)
                            );
                            
                            if (pendingIndex !== -1) {
                                // Update existing pending message
                                global.pendingDirectMessages[normalizedName][pendingIndex] = {
                                    id: global.pendingDirectMessages[normalizedName][pendingIndex].id,
                                    originalId: processedItem.id,
                                    sender: {
                                        id: playerId,
                                        name: gameSessions[sessionId].players[playerId].name || 'Unknown',
                                        organization: processedItem.organization || 'Unknown'
                                    },
                                    title: processedItem.title || 'No Subject',
                                    content: processedItem.content || '',
                                    contentType: processedItem.type || 'text',
                                    timestamp: new Date().toISOString(),
                                    read: false
                                };
                            } else {
                                // Add as new pending message
                                global.pendingDirectMessages[normalizedName].push({
                                    id: uuidv4(),
                                    originalId: processedItem.id,
                                    sender: {
                                        id: playerId,
                                        name: gameSessions[sessionId].players[playerId].name || 'Unknown',
                                        organization: processedItem.organization || 'Unknown'
                                    },
                                    title: processedItem.title || 'No Subject',
                                    content: processedItem.content || '',
                                    contentType: processedItem.type || 'text',
                                    timestamp: new Date().toISOString(),
                                    read: false
                                });
                            }
                        }
                    });
                }
                
                console.log(`Feed item ${processedItem.id} updated in all sessions/inboxes`);
                res.json({ success: true, feedItemId: processedItem.id });
            } else {
                res.status(400).json({ error: 'Missing feed item data or ID' });
            }
            break;
            
        case 'delete':
            // Delete logic remains similar but now removes from global array too
            if (feedItem && feedItem.id) {
                console.log(`Deleting feed item: ${feedItem.id}`);
                
                // Find and remove from global array
                const globalIndex = global.allFeedItems.findIndex(item => item.id === feedItem.id);
                if (globalIndex !== -1) {
                    global.allFeedItems.splice(globalIndex, 1);
                    console.log(`Removed item from global feed items`);
                }
                
                // Remove from all sessions
                Object.keys(gameSessions).forEach(sessId => {
                    const session = gameSessions[sessId];
                    
                    if (session.feedItems) {
                        const index = session.feedItems.findIndex(item => item.id === feedItem.id);
                        if (index !== -1) {
                            session.feedItems.splice(index, 1);
                            console.log(`Removed item from session ${sessId}`);
                        }
                    }
                    
                    // Add delete notification to each session
                    const deleteMessage = {
                        id: uuidv4(),
                        sessionId: sessId,
                        senderId: playerId,
                        senderName: gameSessions[sessionId].players[playerId].name,
                        targetId: null,
                        content: `DELETE_FEED_ITEM:${feedItem.id}`,
                        timestamp: new Date().getTime(),
                        isSystemMessage: false
                    };
                    
                    if (!session.messages) {
                        session.messages = [];
                    }
                    
                    session.messages.push(deleteMessage);
                });
                
                console.log(`Feed item ${feedItem.id} deleted from all sessions`);
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'Missing feed item ID' });
            }
            break;
            
        default:
            res.status(400).json({ error: 'Unknown action' });
    }
});

// Get players in a session
app.get('/players', validateApiKey, (req, res) => {
    const { sessionId } = req.query;
    
    if (!sessionId || !gameSessions[sessionId]) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    // Extract players from the session
    const playersArray = Object.values(gameSessions[sessionId].players).map(player => ({
        id: player.id,
        name: player.name,
        isActive: true
    }));
    
    // Return the player list
    res.json({
        success: true,
        players: playersArray
    });
});

// User profile updates
app.post('/updateProfile', validateApiKey, (req, res) => {
    const { sessionId, playerId, userProfile } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    // Update player information
    const player = gameSessions[sessionId].players[playerId];
    
    if (userProfile) {
        // Update player properties
        player.name = userProfile.username || player.name;
        player.role = userProfile.role || player.role;
        
        // Store additional user profile data
        if (!player.profileData) {
            player.profileData = {};
        }
        
        player.profileData = {
            ...player.profileData,
            ...userProfile
        };
        
        res.json({
            success: true,
            player: {
                id: player.id,
                name: player.name,
                role: player.role,
                profileData: player.profileData
            }
        });
    } else {
        res.status(400).json({ error: 'Missing user profile data' });
    }
});

// Check permissions
app.post('/checkPermissions', validateApiKey, (req, res) => {
    const { sessionId, playerId, organization } = req.body;
    
    if (!gameSessions[sessionId] || !gameSessions[sessionId].players[playerId]) {
        return res.status(404).json({ error: 'Session or player not found' });
    }
    
    const player = gameSessions[sessionId].players[playerId];
    
    // In a real implementation, you would check against your organization database
    // For our example app, we'll use a simplified check
    
    // Default organization permissions (allow all members to post)
    let canPost = true;
    
    // For other organizations, check role restrictions
    if (organization && organization !== "Resistance") {
        // Free Press Alliance only allows Editors and Admins to post
        if (organization === "Free Press Alliance" && player.role === "Member") {
            canPost = false;
        }
    }
    
    res.json({
        success: true,
        permissions: {
            canPost: canPost,
            role: player.role,
            organization: organization || "Resistance"
        }
    });
});

// Serve media content
app.get('/media/:id', (req, res) => {
    const mediaId = req.params.id;
    const media = global.mediaContent[mediaId];
    
    if (!media || !media.data) {
        return res.status(404).json({ error: 'Media not found' });
    }
    
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Content-Length', media.data.length);
    res.send(media.data);
});

// Default game facts
function getDefaultGameFacts() {
    return {
        planetName: "Zeta Proxima b",
        atmosphere: "Thin, breathable with assistance",
        gravity: "0.8 Earth gravity",
        temperature: "Variable, generally cool",
        terrain: "Rocky plains with scattered crystalline formations",
        flora: "Bioluminescent lichen and hardy shrubs",
        fauna: "Small, insect-like creatures",
        resources: "Rare minerals and crystals",
        timeElapsed: "1h 0m",  // Initialize with non-zero time
        year: "2174"
    };
}

// Process media content in feed items
function processMediaContent(feedItem) {
    // Make a copy of the item to avoid modifying the original
    const processedItem = { ...feedItem };
    
    try {
        // Handle image data
        if (processedItem.type === 'image' && processedItem.imageUrl) {
            // Check if it's a data URL containing image data
            if (processedItem.imageUrl.startsWith('data:image/')) {
                const mediaId = uuidv4();
                const imgData = processDataUrl(processedItem.imageUrl);
                
                if (imgData) {
                    // Store the binary data
                    global.mediaContent[mediaId] = {
                        type: 'image',
                        data: imgData,
                        contentType: getContentTypeFromDataUrl(processedItem.imageUrl)
                    };
                    
                    // Replace data URL with a reference URL
                    processedItem.imageUrl = `/media/${mediaId}`;
                    console.log(`Processed image data for item ${mediaId}, size: ${imgData.length} bytes`);
                }
            }
        }
        
        // Handle video data
        if (processedItem.type === 'video' && processedItem.videoUrl) {
            // Check if it's a data URL containing video data
            if (processedItem.videoUrl.startsWith('data:video/')) {
                const mediaId = uuidv4();
                const videoData = processDataUrl(processedItem.videoUrl);
                
                if (videoData) {
                    // Store the binary data
                    global.mediaContent[mediaId] = {
                        type: 'video',
                        data: videoData,
                        contentType: getContentTypeFromDataUrl(processedItem.videoUrl)
                    };
                    
                    // Replace data URL with a reference URL
                    processedItem.videoUrl = `/media/${mediaId}`;
                    console.log(`Processed video data for item ${mediaId}, size: ${videoData.length} bytes`);
                }
            }
        }
        
        // Handle audio data
        if (processedItem.type === 'audio' && processedItem.audioUrl) {
                   // Check if it's a data URL containing audio data
                   if (processedItem.audioUrl.startsWith('data:audio/')) {
                       const mediaId = uuidv4();
                       const audioData = processDataUrl(processedItem.audioUrl);
                       
                       if (audioData) {
                           // Store the binary data
                           global.mediaContent[mediaId] = {
                               type: 'audio',
                               data: audioData,
                               contentType: getContentTypeFromDataUrl(processedItem.audioUrl)
                           };
                           
                           // Replace data URL with a reference URL
                           processedItem.audioUrl = `/media/${mediaId}`;
                           console.log(`Processed audio data for item ${mediaId}, size: ${audioData.length} bytes`);
                       }
                   }
               }
           } catch (error) {
               console.error(`Error processing media content: ${error.message}`);
           }
           
           return processedItem;
       }

       // Extract binary data from a data URL
       function processDataUrl(dataUrl) {
           try {
               // Format: "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
               const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
               if (!matches || matches.length !== 3) {
                   console.error('Invalid data URL format');
                   return null;
               }
               
               const base64Data = matches[2];
               const binaryData = Buffer.from(base64Data, 'base64');
               
               // Check size limit
               if (binaryData.length > MAX_MEDIA_SIZE) {
                   console.error(`Media exceeds size limit of ${MAX_MEDIA_SIZE} bytes`);
                   return null;
               }
               
               return binaryData;
           } catch (error) {
               console.error(`Error processing data URL: ${error.message}`);
               return null;
           }
       }

       // Extract content type from data URL
       function getContentTypeFromDataUrl(dataUrl) {
           const matches = dataUrl.match(/^data:([^;]+);/);
           return matches && matches.length >= 2 ? matches[1] : 'application/octet-stream';
       }

       // Media cleanup function to prevent memory leaks
       function cleanupUnusedMedia() {
           console.log(`Starting media cleanup. Current media items: ${Object.keys(global.mediaContent).length}`);
           
           // Get all media IDs currently in use
           const usedMediaIds = new Set();
           
           // Check feed items for media references
           if (global.allFeedItems) {
               global.allFeedItems.forEach(item => {
                   // Check image URLs
                   if (item.type === 'image' && item.imageUrl) {
                       const match = item.imageUrl.match(/\/media\/([^\/\?]+)/);
                       if (match && match[1]) {
                           usedMediaIds.add(match[1]);
                       }
                   }
                   
                   // Check video URLs
                   if (item.type === 'video' && item.videoUrl) {
                       const match = item.videoUrl.match(/\/media\/([^\/\?]+)/);
                       if (match && match[1]) {
                           usedMediaIds.add(match[1]);
                       }
                   }
                   
                   // Check audio URLs
                   if (item.type === 'audio' && item.audioUrl) {
                       const match = item.audioUrl.match(/\/media\/([^\/\?]+)/);
                       if (match && match[1]) {
                           usedMediaIds.add(match[1]);
                       }
                   }
               });
           }
           
           // Check direct messages for media references
           if (global.directMessages) {
               Object.values(global.directMessages).forEach(messages => {
                   messages.forEach(message => {
                       if (message.content && typeof message.content === 'string') {
                           const match = message.content.match(/\/media\/([^\/\?]+)/);
                           if (match && match[1]) {
                               usedMediaIds.add(match[1]);
                           }
                       }
                   });
               });
           }
           
           // Check pending direct messages for media references
           if (global.pendingDirectMessages) {
               Object.values(global.pendingDirectMessages).forEach(messages => {
                   messages.forEach(message => {
                       if (message.content && typeof message.content === 'string') {
                           const match = message.content.match(/\/media\/([^\/\?]+)/);
                           if (match && match[1]) {
                               usedMediaIds.add(match[1]);
                           }
                       }
                   });
               });
           }
           
           // Identify unused media items for removal
           const allMediaIds = Object.keys(global.mediaContent);
           const unusedMediaIds = allMediaIds.filter(id => !usedMediaIds.has(id));
           
           // Remove unused media
           unusedMediaIds.forEach(id => {
               delete global.mediaContent[id];
           });
           
           console.log(`Media cleanup complete. Removed ${unusedMediaIds.length} unused items. Remaining: ${Object.keys(global.mediaContent).length}`);
       }

       // Start the server
       app.listen(port, () => {
           console.log(`Stranded Astronaut Multiplayer Server v2.3 with Resistance Feed Support running on port ${port}`);
           console.log(`Server initialized with ${global.allFeedItems ? global.allFeedItems.length : 0} global feed items`);
           
           // Set up periodic media cleanup (run every hour)
           setInterval(cleanupUnusedMedia, 60 * 60 * 1000);
       });
