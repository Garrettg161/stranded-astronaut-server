# dWorld Server API Guide

## Server Information
- **Production URL**: `https://stranded-astronaut-server-production.up.railway.app`
- **API Key (Bearer Token)**: `b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA`

---

## Authentication

All API requests require the Bearer token in the Authorization header:

```bash
-H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA"
```

---

## Common Workflows

### 1. Test Server Connection

```bash
curl -X POST https://stranded-astronaut-server-production.up.railway.app/ping \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA"
```

**Response:**
```json
{"success":true,"timestamp":1762458531567}
```

---

### 2. Join the Global Session

Before you can access feed items, you MUST join the dWorld global session:

```bash
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/join" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "appName": "dWorld",
    "playerName": "jefferson"
  }'
```

**Response:**
```json
{
  "sessionId": "dworld-global-session",
  "sessionName": "dWorld Global Session",
  "shortCode": "DWORLD",
  "player": {
    "id": "6aef6d14-10e8-413f-9653-cd5b4021b040",
    "name": "jefferson",
    "role": "Member",
    "isHuman": true,
    "isActive": true,
    "currentLocation": "0,1,2,1,2",
    "inventory": {},
    "lastActivity": "2025-11-07T23:44:33.943Z",
    "profileData": {
      "username": "jefferson",
      "organizations": ["Resistance"],
      "topicFilters": [],
      "dateJoined": "2025-11-07T23:44:33.943Z"
    }
  },
  "globalTurn": 0,
  "timeElapsed": "1h 0m"
}
```

**Save the `player.id` - you'll need it for all subsequent requests!**

---

### 3. Get All Feed Items

```bash
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "YOUR_PLAYER_ID_FROM_JOIN",
    "includeAllItems": true
  }'
```

**Response Structure:**
```json
{
  "players": {...},
  "gameState": {...},
  "feedItems": [
    {
      "id": "...",
      "type": "text",
      "title": "...",
      "content": "...",
      "author": "jefferson",
      "isDirectMessage": true,
      "recipients": ["george"],
      "encryptedData": "...",
      "encryptionStatus": "encrypted",
      "encryptedMessageId": "...",
      ...
    }
  ]
}
```

---

### 4. Filter Feed Items with jq

#### Get All Direct Messages
```bash
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "YOUR_PLAYER_ID",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(.isDirectMessage == true)'
```

#### Get Encrypted Messages Only
```bash
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "YOUR_PLAYER_ID",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(.encryptionStatus == "encrypted")'
```

#### Get Specific Feed Item by Title
```bash
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "YOUR_PLAYER_ID",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(.title | contains("3rd attempt"))'
```

#### Get Encryption Fields for All DMs
```bash
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "YOUR_PLAYER_ID",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(.isDirectMessage == true) | {
    id, 
    title, 
    content, 
    encryptedData, 
    encryptionStatus, 
    encryptedMessageId,
    recipients
  }'
```

---

## Quick Reference Commands

### Complete Workflow to Check an Encrypted DM

```bash
# Step 1: Join and save playerId
PLAYER_ID=$(curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/join" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{"appName": "dWorld", "playerName": "jefferson"}' | jq -r '.player.id')

echo "Player ID: $PLAYER_ID"

# Step 2: Get encrypted DM details
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"dworld-global-session\",
    \"playerId\": \"$PLAYER_ID\",
    \"includeAllItems\": true
  }" | jq '.feedItems[] | select(.encryptionStatus == "encrypted") | {
    title,
    author,
    recipients,
    encryptionStatus,
    hasEncryptedData: (.encryptedData != null),
    encryptedDataSize: (.encryptedData | length)
  }'
```

---

## Important Constants

- **Session ID**: `dworld-global-session` (always use this for dWorld app)
- **App Name**: `dWorld` (required in join request)
- **API Key**: `b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA`

---

## Troubleshooting

### Error: "Session not found"
**Solution**: You forgot to join the session first. Run the `/join` endpoint.

### Error: "Cannot GET /feed"
**Solution**: The endpoint is `/sync` (POST), not `/feed` (GET).

### jq Error: "Cannot iterate over null"
**Solution**: The field you're filtering on doesn't exist. Check the actual response structure first without jq.

### No results returned
**Solution**: The filter might be too strict. Try removing filters one by one to see what data exists.

---

## Schema Reference

### FeedItem Fields (with Encryption)

```javascript
{
  id: String (UUID),
  type: String (text|image|video|audio|web|presentation|event),
  title: String,
  content: String (plaintext if not encrypted),
  author: String,
  authorId: String,
  organization: String,
  timestamp: Date,
  isDirectMessage: Boolean,
  recipients: [String],
  isGroupMessage: Boolean,
  groupName: String,
  
  // Encryption Fields (NEW)
  encryptedData: Buffer (binary encrypted content),
  encryptionStatus: String (legacy|encrypted|public),
  encryptedMessageId: String (UUID for encrypted messages),
  
  // Media fields
  imageUrl: String,
  imageData: Buffer,
  videoUrl: String,
  audioUrl: String,
  
  // Other fields
  parentId: String (for comments),
  commentCount: Number,
  approvalCount: Number,
  disapprovalCount: Number,
  topics: [String],
  isDeleted: Boolean,
  isRepost: Boolean
}
```

---

## Notes

- The server uses MongoDB, so new schema fields are automatically added when you send them
- Always use `includeAllItems: true` to get the complete feed
- Player IDs are temporary and change each time you join
- The session `dworld-global-session` is permanent and shared by all users
