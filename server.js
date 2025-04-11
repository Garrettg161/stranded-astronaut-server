// Add these new global variables at the top of the file, near the other global declarations
global.mediaContent = {}; // Storage for binary media content
const MAX_MEDIA_SIZE = 10 * 1024 * 1024; // 10MB limit for media content

// Find the publishFeedItem function inside the app.post('/feed'... route handler
// and replace or modify it like this:
case 'publish':
    // Add the feed item to both the global feed and the session's feed
    if (feedItem) {
        console.log(`Publishing feed item: ${feedItem.title} [${feedItem.id}]`);
        
        // Process media content if present
        let processedItem = processMediaContent(feedItem);
        
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
        });
        
        console.log(`Feed item ${processedItem.id} published to all sessions`);
        res.json({ success: true, feedItemId: processedItem.id });
    } else {
        res.status(400).json({ error: 'Missing feed item data' });
    }
    break;

// Now add these helper functions for media handling after the app.listen() call
// or in a logical place toward the end of the file

// Process media content in feed items
function processMediaContent(feedItem) {
    // Make a copy of the item to avoid modifying the original
    const processedItem = { ...feedItem };
    
    try {
        // Handle image data
        if (processedItem.type === 'image' && processedItem.imageUrl) {
            // Check if it's a data URL containing image data
            if (processedItem.imageUrl.startsWith('data:image/')) {
                const mediaId = processedItem.id || uuidv4();
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
                const mediaId = processedItem.id || uuidv4();
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
                const mediaId = processedItem.id || uuidv4();
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

// Add a new route to serve media content
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

// Also update the feed 'update' action to handle media content
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
