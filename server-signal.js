// server-signal.js
// Signal Protocol server endpoints for dWorld
// Add this to your existing server.js or require it

const mongoose = require('mongoose');

// ========================================
// MONGODB SCHEMAS FOR SIGNAL PROTOCOL
// ========================================

// User Signal Keys Schema
const userSignalKeysSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, index: true },
    registrationId: { type: Number, required: true },
    deviceId: { type: Number, required: true, default: 1 },
    identityKey: { type: String, required: true }, // Base64 encoded
    signedPreKeyId: { type: Number, required: true },
    signedPreKeyPublic: { type: String, required: true }, // Base64 encoded
    signedPreKeySignature: { type: String, required: true }, // Base64 encoded
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const UserSignalKeys = mongoose.model('UserSignalKeys', userSignalKeysSchema);

// PreKeys Schema
const preKeySchema = new mongoose.Schema({
    username: { type: String, required: true, index: true },
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true }, // Base64 encoded
    consumed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Compound index for efficient lookups
preKeySchema.index({ username: 1, keyId: 1 }, { unique: true });
preKeySchema.index({ username: 1, consumed: 1 });

const PreKey = mongoose.model('PreKey', preKeySchema);

// Encrypted Messages per Recipient Schema
const encryptedMessageSchema = new mongoose.Schema({
    feedItemId: { type: String, required: true, index: true },
    recipientUsername: { type: String, required: true, index: true },
    deviceId: { type: Number, default: 1 },
    messageType: { type: Number, required: true }, // 2 = PreKey, 3 = Whisper
    ciphertext: { type: String, required: true }, // Base64 encoded
    createdAt: { type: Date, default: Date.now }
});

// Compound index for efficient recipient lookups
encryptedMessageSchema.index({ feedItemId: 1, recipientUsername: 1 });

const EncryptedMessage = mongoose.model('EncryptedMessage', encryptedMessageSchema);

// ========================================
// API ENDPOINTS
// ========================================

/**
 * Upload user's Signal key bundle
 * POST /api/signal/keys/upload
 */
async function uploadKeyBundle(req, res) {
    try {
        const {
            username,
            registrationId,
            deviceId,
            identityKey,
            signedPreKeyId,
            signedPreKeyPublic,
            signedPreKeySignature,
            preKeys
        } = req.body;

        console.log(`DEBUG-SIGNAL-SERVER: Uploading key bundle for ${username}`);

        // Validate required fields
        if (!username || !registrationId || !identityKey || !signedPreKeyPublic) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Store or update user's identity and signed prekey
        await UserSignalKeys.findOneAndUpdate(
            { username },
            {
                username,
                registrationId,
                deviceId: deviceId || 1,
                identityKey,
                signedPreKeyId,
                signedPreKeyPublic,
                signedPreKeySignature,
                updatedAt: new Date()
            },
            { upsert: true, new: true }
        );

        console.log(`DEBUG-SIGNAL-SERVER: Stored identity keys for ${username}`);

        // Store prekeys
        if (preKeys && Array.isArray(preKeys)) {
            // Delete old prekeys
            await PreKey.deleteMany({ username });

            // Insert new prekeys
            const preKeyDocs = preKeys.map(preKey => ({
                username,
                keyId: preKey.id,
                publicKey: preKey.publicKey,
                consumed: false
            }));

            await PreKey.insertMany(preKeyDocs);
            console.log(`DEBUG-SIGNAL-SERVER: Stored ${preKeys.length} prekeys for ${username}`);
        }

        res.json({ 
            success: true,
            message: 'Key bundle uploaded successfully'
        });

    } catch (error) {
        console.error('DEBUG-SIGNAL-SERVER: Error uploading key bundle:', error);
        res.status(500).json({ error: 'Failed to upload key bundle' });
    }
}

/**
 * Fetch a user's key bundle
 * GET /api/signal/keys/:username
 */
async function fetchKeyBundle(req, res) {
    try {
        const { username } = req.params;

        console.log(`DEBUG-SIGNAL-SERVER: Fetching key bundle for ${username}`);

        // Get user's identity and signed prekey
        const userKeys = await UserSignalKeys.findOne({ username });

        if (!userKeys) {
            console.log(`DEBUG-SIGNAL-SERVER: No keys found for ${username}`);
            return res.status(404).json({ error: 'User has not set up encryption' });
        }

        // Get one unused prekey
        const preKey = await PreKey.findOneAndUpdate(
            { username, consumed: false },
            { consumed: true },
            { new: true }
        );

        if (!preKey) {
            console.log(`DEBUG-SIGNAL-SERVER: No prekeys available for ${username}`);
            return res.status(404).json({ error: 'No prekeys available' });
        }

        console.log(`DEBUG-SIGNAL-SERVER: Consumed prekey ${preKey.keyId} for ${username}`);

        // Return key bundle
        const keyBundle = {
            registrationId: userKeys.registrationId,
            deviceId: userKeys.deviceId,
            identityKey: userKeys.identityKey,
            signedPreKeyId: userKeys.signedPreKeyId,
            signedPreKeyPublic: userKeys.signedPreKeyPublic,
            signedPreKeySignature: userKeys.signedPreKeySignature,
            preKeys: [{
                id: preKey.keyId,
                publicKey: preKey.publicKey
            }]
        };

        res.json(keyBundle);

    } catch (error) {
        console.error('DEBUG-SIGNAL-SERVER: Error fetching key bundle:', error);
        res.status(500).json({ error: 'Failed to fetch key bundle' });
    }
}

/**
 * Store encrypted message for recipient
 * POST /api/signal/messages
 */
async function storeEncryptedMessage(req, res) {
    try {
        const {
            feedItemId,
            recipientUsername,
            deviceId,
            messageType,
            ciphertext
        } = req.body;

        console.log(`DEBUG-SIGNAL-SERVER: Storing encrypted message for ${recipientUsername}`);

        const message = new EncryptedMessage({
            feedItemId,
            recipientUsername,
            deviceId: deviceId || 1,
            messageType,
            ciphertext
        });

        await message.save();

        res.json({ success: true });

    } catch (error) {
        console.error('DEBUG-SIGNAL-SERVER: Error storing encrypted message:', error);
        res.status(500).json({ error: 'Failed to store encrypted message' });
    }
}

/**
 * Fetch encrypted message for current user and feed item
 * GET /api/signal/messages/:feedItemId
 */
async function fetchEncryptedMessage(req, res) {
    try {
        const { feedItemId } = req.params;
        const username = req.user?.username || req.query.username; // Adjust based on auth

        if (!username) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        console.log(`DEBUG-SIGNAL-SERVER: Fetching encrypted message for ${username}, item ${feedItemId}`);

        const message = await EncryptedMessage.findOne({
            feedItemId,
            recipientUsername: username
        });

        if (!message) {
            return res.status(404).json({ error: 'No encrypted message found' });
        }

        res.json({
            recipientUsername: message.recipientUsername,
            deviceId: message.deviceId,
            messageType: message.messageType,
            ciphertext: message.ciphertext
        });

    } catch (error) {
        console.error('DEBUG-SIGNAL-SERVER: Error fetching encrypted message:', error);
        res.status(500).json({ error: 'Failed to fetch encrypted message' });
    }
}

/**
 * Check prekey count for a user
 * GET /api/signal/keys/:username/prekey-count
 */
async function getPreKeyCount(req, res) {
    try {
        const { username } = req.params;

        const count = await PreKey.countDocuments({ username, consumed: false });

        res.json({ 
            username,
            availablePreKeys: count
        });

    } catch (error) {
        console.error('DEBUG-SIGNAL-SERVER: Error getting prekey count:', error);
        res.status(500).json({ error: 'Failed to get prekey count' });
    }
}

// ========================================
// EXPORT FUNCTIONS AND MODELS
// ========================================

module.exports = {
    // Express route handlers
    uploadKeyBundle,
    fetchKeyBundle,
    storeEncryptedMessage,
    fetchEncryptedMessage,
    getPreKeyCount,
    
    // Mongoose models (if needed elsewhere)
    UserSignalKeys,
    PreKey,
    EncryptedMessage
};

// ========================================
// INTEGRATION INSTRUCTIONS
// ========================================
/*
To integrate into your existing server.js:

1. Require this file:
   const signalProtocol = require('./server-signal');

2. Add routes:
   app.post('/api/signal/keys/upload', signalProtocol.uploadKeyBundle);
   app.get('/api/signal/keys/:username', signalProtocol.fetchKeyBundle);
   app.post('/api/signal/messages', signalProtocol.storeEncryptedMessage);
   app.get('/api/signal/messages/:feedItemId', signalProtocol.fetchEncryptedMessage);
   app.get('/api/signal/keys/:username/prekey-count', signalProtocol.getPreKeyCount);

3. Your MongoDB connection should already be established in server.js
*/
