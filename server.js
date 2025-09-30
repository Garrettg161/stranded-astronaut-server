const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const port = process.env.PORT || 3000;

// Global variables
let feedItemIdCounter = 1000; // Initial default value, will be properly set during initialization
global.allFeedItems = [];
global.directMessages = {};
global.usernameMappings = {};
global.pendingDirectMessages = {};
global.mediaContent = {};
const MAX_MEDIA_SIZE = 10 * 1024 * 1024;

// MongoDB connection setup
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dworld';

// FeedItem schema and model
const feedItemSchema = new mongoose.Schema({
   id: { type: String, required: true, unique: true },
   type: { type: String, required: true },
   title: { type: String, required: true },
   content: { type: String, required: true },
   author: { type: String, required: true },
   authorId: { type: String, required: true },
   organization: { type: String, default: 'Resistance' },
   timestamp: { type: Date, default: Date.now },
   imageUrl: String,
   imageData: Buffer,
   imageContentType: String,
   videoUrl: String,
   videoData: Buffer,
   videoContentType: String,
   audioUrl: String,
   audioData: Buffer,
   audioContentType: String,
   webUrl: String,
   parentId: String,
   feedItemID: { type: String, index: true },
   commentCount: { type: Number, default: 0 },
   approvalCount: { type: Number, default: 0 },
   disapprovalCount: { type: Number, default: 0 },
   isDirectMessage: { type: Boolean, default: false },
   recipients: [String],
   isGroupMessage: { type: Boolean, default: false },
   groupName: String,
   topics: [String],
   attributedContentData: String,
   isDeleted: { type: Boolean, default: false },
   isRepost: { type: Boolean, default: false },
   metadata: mongoose.Schema.Types.Mixed,
   eventDescription: String,
   eventStartDate: Date,
   eventEndDate: Date,
   eventTime: String,
   eventLocation: String,
   eventZoomURL: String,
   eventGoogleMeetURL: String,
   eventSubstackURL: String,
   eventStoredVideoURL: String,
   hasCalendarPermission: { type: Boolean, default: false },
   eventIdentifier: String
});

const FeedItem = mongoose.model('FeedItem', feedItemSchema);

// Function to load items from MongoDB at startup
function loadItemsFromDatabase() {
   return new Promise((resolve, reject) => {
       FeedItem.find({ isDeleted: false })
           .then(items => {
               console.log(`Loaded ${items.length} feed items from MongoDB`);
               global.allFeedItems = items;
               
               // Rebuild global.mediaContent from stored binary data
               let restoredImageCount = 0;
               let restoredVideoCount = 0;
               let restoredAudioCount = 0;
               
               items.forEach(item => {
                   // Restore images
                   if (item.imageData && item.imageUrl) {
                       const mediaId = item.imageUrl.match(/\/media\/([^\/\?]+)/)?.[1];
                       if (mediaId) {
                           global.mediaContent[mediaId] = {
                               type: 'image',
                               data: item.imageData,
                               contentType: item.imageContentType || 'image/jpeg'
                           };
                           restoredImageCount++;
                       }
                   }
                   
                   // Restore videos
                   if (item.videoData && item.videoUrl) {
                       const mediaId = item.videoUrl.match(/\/media\/([^\/\?]+)/)?.[1];
                       if (mediaId) {
                           global.mediaContent[mediaId] = {
                               type: 'video',
                               data: item.videoData,
                               contentType: item.videoContentType || 'video/mp4'
                           };
                           restoredVideoCount++;
                       }
                   }
                   
                   // Restore audio
                   if (item.audioData && item.audioUrl) {
                       const mediaId = item.audioUrl.match(/\/media\/([^\/\?]+)/)?.[1];
                       if (mediaId) {
                           global.mediaContent[mediaId] = {
                               type: 'audio',
                               data: item.audioData,
                               contentType: item.audioContentType || 'audio/mpeg'
                           };
                           restoredAudioCount++;
                       }
                   }
               });
               
               console.log(`Restored ${restoredImageCount} images, ${restoredVideoCount} videos, ${restoredAudioCount} audio files to RAM`);
               console.log(`Total media items in RAM: ${Object.keys(global.mediaContent).length}`);
               
               resolve(items);
           })
           .catch(err => {
               console.error(`Error loading items from MongoDB: ${err}`);
               reject(err);
           });
   });
}

// Initialize feedItemIdCounter from the database
function initializeFeedItemIdCounter() {
   return new Promise((resolve, reject) => {
       // Find the highest existing feedItemID in the database
       FeedItem.find({})
           .sort({ feedItemID: -1 }) // Sort by feedItemID in descending order
           .limit(1) // Get just the highest one
           .then(items => {
               if (items.length > 0 && items[0].feedItemID) {
                   // Get the highest ID and add 1
                   const maxId = parseInt(items[0].feedItemID, 10);
                   if (!isNaN(maxId)) {
                       feedItemIdCounter = maxId + 1;
                   } else {
                       feedItemIdCounter = 1000; // Fallback if parsing fails
                   }
               } else {
                   feedItemIdCounter = 1000; // Default starting value if no items exist
               }
               console.log(`Initialized feedItemIdCounter to ${feedItemIdCounter} (continuing from previous highest ID)`);
               resolve();
           })
           .catch(err => {
               console.error(`Error initializing feedItemIdCounter: ${err}`);
               // Better to crash than to create duplicates
               reject(new Error('Critical error: Unable to initialize feedItemIdCounter'));
           });
   });
}

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

// Test endpoint to check the current state of feedItemIdCounter
app.get('/debug/counter', validateApiKey, (req, res) => {
   res.json({
       feedItemIdCounter: feedItemIdCounter,
       itemCount: global.allFeedItems.length,
       feedItemIDs: global.allFeedItems.map(item => ({
           id: item.id,
           feedItemID: item.feedItemID,
           title: item.title
       }))
   });
});

// Test endpoint to find duplicates/replicants
app.get('/debug/duplicates', validateApiKey, (req, res) => {
   // Check for duplicate ids
   const idCounts = {};
   const feedItemIDCounts = {};
   const duplicates = {
       byId: [],
       byFeedItemID: []
   };
   
   global.allFeedItems.forEach(item => {
       // Count occurrences of each id
       if (idCounts[item.id]) {
           idCounts[item.id]++;
           if (idCounts[item.id] === 2) { // Only add when we find the second occurrence
               duplicates.byId.push(item.id);
           }
       } else {
           idCounts[item.id] = 1;
       }
       
       // Count occurrences of each feedItemID
       if (item.feedItemID) {
           if (feedItemIDCounts[item.feedItemID]) {
               feedItemIDCounts[item.feedItemID]++;
               if (feedItemIDCounts[item.feedItemID] === 2) {
                   duplicates.byFeedItemID.push(item.feedItemID);
               }
           } else {
               feedItemIDCounts[item.feedItemID] = 1;
           }
       }
   });
   
   res.json({
       totalItems: global.allFeedItems.length,
       duplicateIds: duplicates.byId,
       duplicateFeedItemIDs: duplicates.byFeedItemID,
       details: {
           byId: Object.entries(idCounts)
               .filter(([_, count]) => count > 1)
               .map(([id, count]) => ({ id, count })),
           byFeedItemID: Object.entries(feedItemIDCounts)
               .filter(([_, count]) => count > 1)
               .map(([id, count]) => ({ id, count }))
       }
   });
});

// Test endpoint for comments
app.get('/debug/comments/:feedItemId', validateApiKey, (req, res) => {
   const feedItemId = req.params.feedItemId;
   
   // Find the parent item
   const parentItem = global.allFeedItems.find(item => item.id === feedItemId);
   
   if (!parentItem) {
       return res.status(404).json({ error: 'Parent item not found' });
   }
   
   // Find comments for this item
   const comments = global.allFeedItems.filter(item => {
       return item.parentId === feedItemId;
   });
   
   res.json({
       parent: {
           id: parentItem.id,
           feedItemID: parentItem.feedItemID,
           title: parentItem.title,
           commentCount: parentItem.commentCount
       },
       comments: comments.map(comment => ({
           id: comment.id,
           feedItemID: comment.feedItemID,
           title: comment.title,
           content: comment.content,
           parentId: comment.parentId
       })),
       commentCount: comments.length
   });
});

// In-memory storage for game sessions
const gameSessions = {};

// In-memory storage for players
const players = {};

// Initialize server with simpler approach to avoid crashes
mongoose.connect(mongoUri, {
 useNewUrlParser: true,
 useUnifiedTopology: true
}).then(() => {
 console.log('Connected to MongoDB database');
 
 // Load initial items AND rebuild media content
 return loadItemsFromDatabase();
}).then(items => {
 
 // Find the highest feedItemID to initialize the counter
 let maxId = 1000; // Default starting value
 
 items.forEach(item => {
   if (item.feedItemID) {
     const idNum = parseInt(item.feedItemID, 10);
     if (!isNaN(idNum) && idNum > maxId) {
       maxId = idNum;
     }
   }
 });
 
 // Set counter to highest + 1
 feedItemIdCounter = maxId + 1;
 console.log(`Initialized feedItemIdCounter to ${feedItemIdCounter}`);
 
 // Start the server - NOTE: Removing this app.listen call to fix the crash
 // app.listen(port, () => {
 //   console.log(`Stranded Astronaut Multiplayer Server v2.5 with Resistance Feed Support & Comments`);
 //   console.log(`Server initialized with ${global.allFeedItems.length} global feed items`);
 //   console.log(`FeedItemIdCounter initialized to: ${feedItemIdCounter}`);
 // });
}).catch(err => {
 console.error(`Server initialization error: ${err}`);
 // Try a simple initialization as fallback
 console.log('Attempting fallback initialization...');
 
 feedItemIdCounter = 1002; // Safe fallback higher than existing IDs
 
 // NOTE: Not starting server here either - will use single server start at the end
});

// Routes
app.get('/', (req, res) => {
   res.send('Stranded Astronaut Multiplayer Server v2.5 with Resistance Feed Support & Comments');
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
    const { sessionId, playerId, action, feedItem, feedItemId, commentCount } = req.body;
    
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
            if (feedItem) {
                console.log(`Publishing feed item: ${feedItem.title} [${feedItem.id}]`);
                
                let processedItem;
                try {
                    if (feedItem.type === 'image' || feedItem.type === 'video' || feedItem.type === 'audio') {
                        processedItem = processMediaContent(feedItem);
                    } else {
                        processedItem = {...feedItem};
                    }
                    
                    // CRITICAL FIX: Convert Swift timestamp (seconds) to JavaScript (milliseconds)
                    if (processedItem.timestamp && typeof processedItem.timestamp === 'number') {
                        processedItem.timestamp = new Date(processedItem.timestamp * 1000);
                    }
                    
                    // CRITICAL FIX: Always set a new timestamp for comments
                    if (feedItem.parentId) {
                        processedItem.timestamp = new Date();
                    }
                    
                    // ADD THIS: Preserve isRepost property
                    if (feedItem.isRepost) {
                        processedItem.isRepost = true;
                        console.log(`DEBUG-REPOST: Publishing item with isRepost=true`);
                    }
                } catch (error) {
                    console.error("Error processing item:", error);
                    processedItem = {...feedItem};
                }
                
                // CRITICAL FIX: Assign a unique numeric ID as string
                if (!processedItem.feedItemID) {
                    processedItem.feedItemID = (feedItemIdCounter++).toString();
                    console.log(`Assigned new feedItemID: ${processedItem.feedItemID}`);
                }
                
                // CRITICAL FIX: Ensure parentId is correctly preserved
                if (feedItem.parentId) {
                    // Always store parentId as received without modification
                    processedItem.parentId = feedItem.parentId;
                    console.log(`DEBUG-COMMENT-SERVER: Item is a comment with parentId: ${feedItem.parentId}`);
                    
                    // Update parent's comment count in MongoDB first
                    // FIXED: Look up parent by id instead of feedItemID
                    FeedItem.findOneAndUpdate(
                        { id: String(feedItem.parentId) },  // Changed from feedItemID to id
                        { $inc: { commentCount: 1 } },
                        { new: true }
                    ).then(updatedParent => {
                        if (updatedParent) {
                            console.log(`DEBUG-COMMENT-SERVER: Updated parent in DB with comment count: ${updatedParent.commentCount}`);
                            
                            // Also update parent in memory
                            // FIXED: Look up parent by id instead of feedItemID
                            const parentIndex = global.allFeedItems.findIndex(item =>
                                String(item.id) === String(feedItem.parentId)  // Changed from feedItemID to id
                            );
                            
                            if (parentIndex !== -1) {
                                if (!global.allFeedItems[parentIndex].commentCount) {
                                    global.allFeedItems[parentIndex].commentCount = 0;
                                }
                                global.allFeedItems[parentIndex].commentCount = updatedParent.commentCount;
                                console.log(`DEBUG-COMMENT-SERVER: Updated parent in memory with count: ${updatedParent.commentCount}`);
                            }
                        }
                    }).catch(err => {
                        console.error(`DEBUG-COMMENT-SERVER: Error updating parent comment count: ${err}`);
                        
                        // Fall back to memory-only update if DB fails
                        // FIXED: Look up parent by id instead of feedItemID
                        const parentIndex = global.allFeedItems.findIndex(item =>
                            String(item.id) === String(feedItem.parentId)  // Changed from feedItemID to id
                        );
                        
                        if (parentIndex !== -1) {
                            if (!global.allFeedItems[parentIndex].commentCount) {
                                global.allFeedItems[parentIndex].commentCount = 0;
                            }
                            global.allFeedItems[parentIndex].commentCount += 1;
                            console.log(`DEBUG-COMMENT-SERVER: Updated parent in memory only with count: ${global.allFeedItems[parentIndex].commentCount}`);
                        }
                    });
                }
                
                // Save to MongoDB and propagate to memory
                FeedItem.findOneAndUpdate(
                    { id: processedItem.id },
                    processedItem,
                    { upsert: true, new: true }
                ).then(savedItem => {
                    console.log(`Item saved to MongoDB: ${savedItem.id} with feedItemID: ${savedItem.feedItemID}`);
                    
                    // Add to global feed items if not already there
                    const alreadyInGlobal = global.allFeedItems.some(item => item.id === processedItem.id);
                    if (!alreadyInGlobal) {
                        global.allFeedItems.push(processedItem);
                        console.log(`Added item to global feed items pool`);
                    } else {
                        // Update existing item
                        const itemIndex = global.allFeedItems.findIndex(item => item.id === processedItem.id);
                        if (itemIndex !== -1) {
                            global.allFeedItems[itemIndex] = processedItem;
                            console.log(`Updated existing item in global feed items pool`);
                        }
                    }
                    
                    // Add to session feed items if not already there
                    const alreadyInSession = gameSessions[sessionId].feedItems.some(item => item.id === processedItem.id);
                    if (!alreadyInSession) {
                        gameSessions[sessionId].feedItems.push(processedItem);
                        console.log(`Added item to session ${sessionId} feed items`);
                    } else {
                        // Update existing item
                        const itemIndex = gameSessions[sessionId].feedItems.findIndex(item => item.id === processedItem.id);
                        if (itemIndex !== -1) {
                            gameSessions[sessionId].feedItems[itemIndex] = processedItem;
                            console.log(`Updated existing item in session ${sessionId}`);
                        }
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
                    });
                    
                    console.log(`Feed item ${processedItem.id} published to all sessions`);
                    res.json({
                        success: true,
                        feedItemId: processedItem.id,
                        feedItemID: processedItem.feedItemID // Include the numeric ID in response
                    });
                }).catch(err => {
                    console.error(`Error saving to MongoDB: ${err}`);
                    
                    // Fallback to memory-only if DB fails
                    // Add to global feed items if not already there
                    const alreadyInGlobal = global.allFeedItems.some(item => item.id === processedItem.id);
                    if (!alreadyInGlobal) {
                        global.allFeedItems.push(processedItem);
                        console.log(`Added item to global feed items pool (DB fallback)`);
                    }
                    
                    // Add to session feed items if not already there
                    const alreadyInSession = gameSessions[sessionId].feedItems.some(item => item.id === processedItem.id);
                    if (!alreadyInSession) {
                        gameSessions[sessionId].feedItems.push(processedItem);
                        console.log(`Added item to session ${sessionId} feed items (DB fallback)`);
                    }
                    
                    res.json({
                        success: true,
                        feedItemId: processedItem.id,
                        feedItemID: processedItem.feedItemID // Include the numeric ID in response
                    });
                });
            } else {
                res.status(400).json({ error: 'Missing feed item data' });
            }
            break;
                    
                case 'getComments':
                    // Get comments for a specific feed item
                    if (feedItemId) {
                        console.log(`Getting comments for feed item: ${feedItemId}`);
                        
                        // Convert feedItemId to string for consistent comparison
                        const itemIdString = typeof feedItemId === 'string' ? feedItemId : String(feedItemId);
                        
                        // Try to get comments from MongoDB first
                        FeedItem.find({ parentId: itemIdString, isDeleted: false })
                            .then(comments => {
                                console.log(`Found ${comments.length} comments in MongoDB for item ${feedItemId}`);
                                
                                res.json({
                                    success: true,
                                    comments: comments
                                });
                            })
                            .catch(err => {
                                console.error(`Error getting comments from MongoDB: ${err}`);
                                
                                // Fallback to memory if DB fails
                                const memoryComments = global.allFeedItems.filter(item => {
                                    if (!item.parentId) return false;
                                    
                                    const parentIdString = typeof item.parentId === 'string' ? item.parentId : String(item.parentId);
                                    return parentIdString === itemIdString;
                                });
                                
                                console.log(`Fallback: Found ${memoryComments.length} comments in memory for item ${feedItemId}`);
                                
                                res.json({
                                    success: true,
                                    comments: memoryComments
                                });
                            });
                    } else {
                        res.status(400).json({ error: 'Missing feed item ID' });
                    }
                    break;
                    
                case 'updateCommentCount':
                    if (feedItemId && typeof commentCount === 'number') {

                        // Add this to the beginning of the updateCommentCount case:
                        console.log(`DEBUG-SERVER-COMMENT: Received request to update comment count for ${feedItemId} to ${commentCount}`);
                        // Update in MongoDB
                        FeedItem.findOneAndUpdate(
                            { id: String(feedItemId) },
                            { commentCount: commentCount },
                            { new: true }
                        ).then(updatedItem => {
                            if (updatedItem) {
                                console.log(`Comment count updated in MongoDB to ${updatedItem.commentCount}`);
                                
                                // Update in global array
                                const globalIndex = global.allFeedItems.findIndex(item =>
                                    String(item.id) === String(feedItemId)
                                );
                                
                                if (globalIndex !== -1) {
                                    global.allFeedItems[globalIndex].commentCount = commentCount;
                                    console.log(`Updated comment count in global array`);
                                }
                                
                                // Update in all sessions
                                Object.keys(gameSessions).forEach(sessId => {
                                    const session = gameSessions[sessId];
                                    if (session.feedItems) {
                                        const sessionIndex = session.feedItems.findIndex(item =>
                                            String(item.id) === String(feedItemId)
                                        );
                                        
                                        if (sessionIndex !== -1) {
                                            session.feedItems[sessionIndex].commentCount = commentCount;
                                        }
                                    }
                                });
                                
                                res.json({
                                    success: true,
                                    commentCount: commentCount
                                });
                            } else {
                                console.log(`Item ${feedItemId} not found in MongoDB`);
                                res.status(404).json({ error: 'Item not found' });
                            }
                        }).catch(err => {
                            console.error(`Error updating comment count in MongoDB: ${err}`);
                            
                            // Fallback to memory-only update
                            const globalIndex = global.allFeedItems.findIndex(item =>
                                String(item.id) === String(feedItemId)
                            );
                            
                            if (globalIndex !== -1) {
                                global.allFeedItems[globalIndex].commentCount = commentCount;
                                
                                // Update in sessions
                                Object.keys(gameSessions).forEach(sessId => {
                                    const session = gameSessions[sessId];
                                    if (session.feedItems) {
                                        const sessionIndex = session.feedItems.findIndex(item =>
                                            String(item.id) === String(feedItemId)
                                        );
                                        
                                        if (sessionIndex !== -1) {
                                            session.feedItems[sessionIndex].commentCount = commentCount;
                                        }
                                    }
                                });
                                
                                res.json({
                                    success: true,
                                    commentCount: commentCount
                                });
                            } else {
                                res.status(404).json({ error: 'Item not found in memory' });
                            }
                        });
                    } else {
                        res.status(400).json({ error: 'Missing feed item ID or invalid comment count' });
                    }
                    break;
            case 'updateVoteCount':
                if (feedItemId && feedItem) {
                    console.log(`DEBUG-VOTE-SERVER: Updating votes for ${feedItemId} - approvals: ${feedItem.approvalCount}, disapprovals: ${feedItem.disapprovalCount}`);
                    
                    // Try to find by id first, then by feedItemID if not found
                    const findQuery = {
                        $or: [
                            { id: String(feedItemId) },
                            { feedItemID: String(feedItemId) }
                        ]
                    };

                    FeedItem.findOneAndUpdate(
                        findQuery,
                        {
                            approvalCount: feedItem.approvalCount,
                            disapprovalCount: feedItem.disapprovalCount
                        },
                        { new: true }
                    ).then(updatedItem => {
                        if (updatedItem) {
                            console.log(`DEBUG-VOTE-SERVER: Votes updated in MongoDB`);
                            
                            const globalIndex = global.allFeedItems.findIndex(item =>
                                String(item.id) === String(feedItemId)
                            );
                            
                            if (globalIndex !== -1) {
                                global.allFeedItems[globalIndex].approvalCount = feedItem.approvalCount;
                                global.allFeedItems[globalIndex].disapprovalCount = feedItem.disapprovalCount;
                            }
                            
                            res.json({ success: true });
                        } else {
                            res.status(404).json({ error: 'Item not found' });
                        }
                    }).catch(err => {
                        console.error(`DEBUG-VOTE-SERVER: Error: ${err}`);
                        res.status(500).json({ error: 'Database error' });
                    });
                } else {
                    res.status(400).json({ error: 'Missing feed item ID or vote data' });
                }
                break;

            // Find the 'get' case in the switch statement of the /feed endpoint
        case 'get':
            console.log("DEBUG-SERVER: Handling 'get' feed request");
            
            // Try to get items from MongoDB first
            FeedItem.find({ isDeleted: false })
                .then(items => {
                    console.log(`DEBUG-COMMENT-SERVER: Calculating comment counts for all ${items.length} items`);
                    
                    // Update the global feed items from the database
                    global.allFeedItems = items;
                    
                    // Return the items from database
                    res.json({
                        success: true,
                        feedItems: items
                    });
                })
                .catch(err => {
                    console.error(`Error getting items from MongoDB: ${err}`);
                    
                    // Fallback to memory if DB fails
                    console.log(`DEBUG-COMMENT-SERVER: Calculating comment counts for all ${global.allFeedItems.length} items`);
                    
                    // Deduplicate items by ID
                    const uniqueItems = [];
                    const seenIds = new Set();
                    
                    for (const item of global.allFeedItems) {
                        if (!seenIds.has(item.id)) {
                            seenIds.add(item.id);
                            uniqueItems.push(item);
                        }
                    }
                    
                    console.log(`Returning ${uniqueItems.length} feed items (from memory fallback)`);
                    
                    res.json({
                        success: true,
                        feedItems: uniqueItems
                    });
                });
            break;
            
        case 'update':
                    // This handles updating an existing feed item (edit functionality)
                    if (feedItem && feedItem.id) {
                        console.log(`Updating feed item: ${feedItem.title} [${feedItem.id}]`);
                        
                        // Process media content if present
                        let processedItem = processMediaContent(feedItem);
                        
                        // CRITICAL FIX: Preserve parentId during updates
                        if (feedItem.parentId) {
                            processedItem.parentId = feedItem.parentId;
                            console.log(`DEBUG-COMMENT-SERVER: Updated item has parentId: ${feedItem.parentId}`);
                        }
                        
                        // ADDED: Preserve isRepost during updates
                        if (feedItem.isRepost !== undefined) {
                            processedItem.isRepost = feedItem.isRepost;
                            console.log(`DEBUG-REPOST: Updating item with isRepost=${feedItem.isRepost}`);
                        }
                        
                        // ADD THIS: Preserve ALL Event-specific fields during updates
                        if (feedItem.type === 'event') {
                            console.log(`DEBUG-SERVER-EVENT: Preserving Event fields for update`);
                            
                            processedItem.eventDescription = feedItem.eventDescription;
                            
                            // CRITICAL: Preserve Event dates
                            if (feedItem.eventStartDate) {
                                processedItem.eventStartDate = new Date(feedItem.eventStartDate);
                                console.log(`DEBUG-SERVER-EVENT: Preserved eventStartDate: ${processedItem.eventStartDate}`);
                            }
                            if (feedItem.eventEndDate) {
                                processedItem.eventEndDate = new Date(feedItem.eventEndDate);
                            }
                            
                            processedItem.eventTime = feedItem.eventTime;
                            processedItem.eventLocation = feedItem.eventLocation;
                            processedItem.eventZoomURL = feedItem.eventZoomURL;
                            processedItem.eventGoogleMeetURL = feedItem.eventGoogleMeetURL;
                            processedItem.eventSubstackURL = feedItem.eventSubstackURL;
                            processedItem.eventStoredVideoURL = feedItem.eventStoredVideoURL;
                            processedItem.hasCalendarPermission = feedItem.hasCalendarPermission;
                            processedItem.eventIdentifier = feedItem.eventIdentifier;
                        }
                        
                        // Check if this item already exists (meaning it's an edit)
                        const isEdit = global.allFeedItems.some(item => item.id === processedItem.id);
                        if (isEdit) {
                            processedItem.timestamp = new Date();
                            console.log(`Forcing new timestamp for edited item: ${processedItem.id}`);
                        }
                        
                        // Update in MongoDB first
                        FeedItem.findOneAndUpdate(
                            { id: processedItem.id },
                            processedItem,
                            { new: true }
                        ).then(updatedItem => {
                            if (updatedItem) {
                                console.log(`Item updated in MongoDB: ${updatedItem.id}`);
                                
                                // Find and update in global array
                                const globalIndex = global.allFeedItems.findIndex(item => item.id === processedItem.id);
                                if (globalIndex !== -1) {
                                    // Preserve comment count if not in update
                                    if (!processedItem.commentCount && global.allFeedItems[globalIndex].commentCount) {
                                        processedItem.commentCount = global.allFeedItems[globalIndex].commentCount;
                                    }
                                    // Preserve vote counts from client update
                                    if (feedItem.approvalCount !== undefined) {
                                        processedItem.approvalCount = feedItem.approvalCount;
                                    }
                                    if (feedItem.disapprovalCount !== undefined) {
                                        processedItem.disapprovalCount = feedItem.disapprovalCount;
                                    }
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
                                        // Preserve comment count if not in update
                                        if (!processedItem.commentCount && session.feedItems[sessionIndex].commentCount) {
                                            processedItem.commentCount = session.feedItems[sessionIndex].commentCount;
                                        }
                                        // Preserve vote counts from client update
                                        if (feedItem.approvalCount !== undefined) {
                                            processedItem.approvalCount = feedItem.approvalCount;
                                        }
                                        if (feedItem.disapprovalCount !== undefined) {
                                            processedItem.disapprovalCount = feedItem.disapprovalCount;
                                        }
                                        
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
                                
                                console.log(`Feed item ${processedItem.id} updated in all sessions`);
                                res.json({ success: true, feedItemId: processedItem.id });
                            } else {
                                console.log(`Item not found in MongoDB, creating new document`);
                                
                                // Create new document
                                const newItem = new FeedItem(processedItem);
                                newItem.save()
                                    .then(savedItem => {
                                        console.log(`New item saved to MongoDB: ${savedItem.id}`);
                                        
                                        // Add to global feed items and sessions
                                        global.allFeedItems.push(processedItem);
                                        
                                        // Update in all sessions as new item
                                        Object.keys(gameSessions).forEach(sessId => {
                                            const session = gameSessions[sessId];
                                            
                                            if (!session.feedItems) {
                                                session.feedItems = [];
                                            }
                                            session.feedItems.push(processedItem);
                                        });
                                        
                                        res.json({ success: true, feedItemId: processedItem.id });
                                    })
                                    .catch(err => {
                                        console.error(`Error saving new item: ${err}`);
                                        res.status(500).json({ error: 'Database error' });
                                    });
                            }
                        }).catch(err => {
                            console.error(`Error updating item in MongoDB: ${err}`);
                            
                            // Fall back to memory-only update if DB fails
                            
                            // Find and update in global array
                            const globalIndex = global.allFeedItems.findIndex(item => item.id === processedItem.id);
                            if (globalIndex !== -1) {
                                // Preserve vote counts from client update
                                if (feedItem.approvalCount !== undefined) {
                                    processedItem.approvalCount = feedItem.approvalCount;
                                }
                                if (feedItem.disapprovalCount !== undefined) {
                                    processedItem.disapprovalCount = feedItem.disapprovalCount;
                                }
                                
                                global.allFeedItems[globalIndex] = processedItem;
                                console.log(`Updated item in global feed items pool (DB fallback)`);
                            } else {
                                global.allFeedItems.push(processedItem);
                                console.log(`Item not found in global pool, adding as new (DB fallback)`);
                            }

                            // Update in all sessions
                            Object.keys(gameSessions).forEach(sessId => {
                                const session = gameSessions[sessId];
                                if (!session.feedItems) session.feedItems = [];
                                
                                const sessionIndex = session.feedItems.findIndex(item => item.id === processedItem.id);
                                if (sessionIndex !== -1) {
                                    // Preserve vote counts from client update
                                    if (feedItem.approvalCount !== undefined) {
                                        processedItem.approvalCount = feedItem.approvalCount;
                                    }
                                    if (feedItem.disapprovalCount !== undefined) {
                                        processedItem.disapprovalCount = feedItem.disapprovalCount;
                                    }
                                    
                                    session.feedItems[sessionIndex] = processedItem;
                                } else {
                                    session.feedItems.push(processedItem);
                                }
                            });
                            
                            res.json({ success: true, feedItemId: processedItem.id });
                        });
                    } else {
                        res.status(400).json({ error: 'Missing feed item data or ID' });
                    }
                    break;
            
        case 'delete':
            // Delete logic
            if (feedItem && feedItem.id) {
                console.log(`Deleting feed item: ${feedItem.id}`);
                
                // Mark as deleted in MongoDB (soft delete)
                FeedItem.findOneAndUpdate(
                    { id: feedItem.id },
                    { isDeleted: true },
                    { new: true }
                ).then(deletedItem => {
                    if (deletedItem) {
                        console.log(`Item marked as deleted in MongoDB: ${deletedItem.id}`);
                        
                        // Remove from global array
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
                        console.log(`Item not found in MongoDB: ${feedItem.id}`);
                        res.status(404).json({ error: 'Item not found' });
                    }
                }).catch(err => {
                    console.error(`Error deleting item from MongoDB: ${err}`);
                    
                    // Fallback to memory-only delete if DB fails
                    
                    // Find and remove from global array
                    const globalIndex = global.allFeedItems.findIndex(item => item.id === feedItem.id);
                    if (globalIndex !== -1) {
                        global.allFeedItems.splice(globalIndex, 1);
                        console.log(`Removed item from global feed items (DB fallback)`);
                    }
                    
                    // Remove from all sessions
                    Object.keys(gameSessions).forEach(sessId => {
                        const session = gameSessions[sessId];
                        
                        if (session.feedItems) {
                            const index = session.feedItems.findIndex(item => item.id === feedItem.id);
                            if (index !== -1) {
                                session.feedItems.splice(index, 1);
                            }
                        }
                    });
                    
                    res.json({ success: true });
                });
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
                    const contentType = getContentTypeFromDataUrl(processedItem.imageUrl);
                    
                    // Store in RAM for immediate serving
                    global.mediaContent[mediaId] = {
                        type: 'image',
                        data: imgData,
                        contentType: contentType
                    };
                    
                    // ALSO store in MongoDB for persistence
                    processedItem.imageData = imgData;
                    processedItem.imageContentType = contentType;
                    
                    // Replace data URL with a reference URL
                    processedItem.imageUrl = `/media/${mediaId}`;
                    console.log(`Stored image in RAM and MongoDB: ${mediaId}, size: ${imgData.length} bytes`);
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
                    const contentType = getContentTypeFromDataUrl(processedItem.videoUrl);
                    
                    // Store in RAM for immediate serving
                    global.mediaContent[mediaId] = {
                        type: 'video',
                        data: videoData,
                        contentType: contentType
                    };
                    
                    // ALSO store in MongoDB for persistence
                    processedItem.videoData = videoData;
                    processedItem.videoContentType = contentType;
                    
                    // Replace data URL with a reference URL
                    processedItem.videoUrl = `/media/${mediaId}`;
                    console.log(`Stored video in RAM and MongoDB: ${mediaId}, size: ${videoData.length} bytes`);
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
                    const contentType = getContentTypeFromDataUrl(processedItem.audioUrl);
                    
                    // Store in RAM for immediate serving
                    global.mediaContent[mediaId] = {
                        type: 'audio',
                        data: audioData,
                        contentType: contentType
                    };
                    
                    // ALSO store in MongoDB for persistence
                    processedItem.audioData = audioData;
                    processedItem.audioContentType = contentType;
                    
                    // Replace data URL with a reference URL
                    processedItem.audioUrl = `/media/${mediaId}`;
                    console.log(`Stored audio in RAM and MongoDB: ${mediaId}, size: ${audioData.length} bytes`);
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
