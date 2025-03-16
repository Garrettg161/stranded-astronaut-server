const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Global feed items storage
global.allFeedItems = [];

// Middleware
app.use(cors());
app.use(bodyParser.json());

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
    
    const { sessionId, playerName, sessionName } = req.body;
    
    // Generate a player ID
    const playerId = uuidv4();
    
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
            
            // Add to global feed items if not already present
            if (!global.allFeedItems) {
                global.allFeedItems = [];
            }
            
            const alreadyInGlobal = global.allFeedItems.some(item => item.id === feedItem.id);
            if (!alreadyInGlobal) {
                global.allFeedItems.push(feedItem);
                console.log(`Added feed item to global pool: ${feedItem.id}`);
            }
            
            // Add to all sessions
            Object.values(gameSessions).forEach(session => {
                // Initialize feed items array if needed
                if (!session.feedItems) {
                    session.feedItems = [];
                }
                
                // Add if not already in this session
                const alreadyInSession = session.feedItems.some(item => item.id === feedItem.id);
                if (!alreadyInSession) {
                    session.feedItems.push(feedItem);
                    console.log(`Added feed item to session ${session.id}: ${feedItem.id}`);
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
        feedItems: feedItemsToSend || []  // Send feed items to client
    };
    
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

// Feed operations endpoint
app.post('/feed', validateApiKey, (req, res) => {
    const { sessionId, playerId, action, feedItem } = req.body;
    
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
                
                // Add to global feed items if not already there
                const alreadyInGlobal = global.allFeedItems.some(item => item.id === feedItem.id);
                if (!alreadyInGlobal) {
                    global.allFeedItems.push(feedItem);
                    console.log(`Added item to global feed items pool`);
                }
                
                // Add to session feed items if not already there
                const alreadyInSession = gameSessions[sessionId].feedItems.some(item => item.id === feedItem.id);
                if (!alreadyInSession) {
                    gameSessions[sessionId].feedItems.push(feedItem);
                    console.log(`Added item to session ${sessionId} feed items`);
                }
                
                // Also create a message to notify all users
                const messageContent = `FEED_ITEM:${JSON.stringify(feedItem)}`;
                
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
                    const alreadyInTargetSession = session.feedItems.some(item => item.id === feedItem.id);
                    if (!alreadyInTargetSession) {
                        session.feedItems.push(feedItem);
                        console.log(`Propagated feed item to session: ${sessId}`);
                    }
                });
                
                console.log(`Feed item ${feedItem.id} published to all sessions`);
                res.json({ success: true, feedItemId: feedItem.id });
            } else {
                res.status(400).json({ error: 'Missing feed item data' });
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
            player