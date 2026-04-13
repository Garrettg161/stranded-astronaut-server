# dWorld Server API Guide

## âš ï¸ CRITICAL: READ THIS FIRST

**Claude: Every time you need to query the server, you make the same mistakes. READ THIS ENTIRE SECTION before writing any curl commands.**

### The Three Rules You Always Forget:

1. **You MUST get a playerId first** - The `/sync` endpoint requires a valid playerId from `/join`
2. **FeedItems are wrapped in `._doc`** - Access fields as `._doc.title`, NOT `.title`
3. **Use POST, not GET** - The endpoint is `POST /sync`, there is NO `GET /feeditems`

---

## Server Information

- **Production URL**: `https://stranded-astronaut-server-production.up.railway.app`
- **API Key (Bearer Token)**: `b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA`
- **Session ID**: `dworld-global-session` (always use this)

---

## STEP-BY-STEP: How to Query Feed Items

### Step 1: Get a Player ID (REQUIRED)

You CANNOT skip this step. The /sync endpoint will return null without a valid playerId.

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/join" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{"appName": "dWorld", "playerName": "claude"}'
```

**Save the `player.id` from the response.** Example: `f2058164-3f93-4bfb-8c16-45bbe8ee509b`

### Step 2: Query Feed Items with the Player ID

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "YOUR_PLAYER_ID_HERE",
    "includeAllItems": true
  }'
```

---

## âš ï¸ CRITICAL: The `._doc` Wrapper

The MongoDB driver wraps all document fields in a `._doc` object. You MUST access fields through this wrapper.

### WRONG (will return null):
```bash
jq '.feedItems[] | select(.title | contains("50th"))'
```

### CORRECT:
```bash
jq '.feedItems[] | select(._doc.title != null and (._doc.title | contains("50th")))'
```

### Response Structure (Actual):
```json
{
  "feedItems": [
    {
      "_doc": {
        "title": "50th multi-recipient DM test",
        "content": "[Encrypted Message]",
        "author": "Hancock",
        "recipients": ["George"],
        "encryptionStatus": "encrypted",
        "encryptedData": {...},
        "isDirectMessage": true
      }
    }
  ]
}
```

---

## Verified Working Examples (November 25, 2025)

### Example 1: Find a specific message by title

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "f2058164-3f93-4bfb-8c16-45bbe8ee509b",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(._doc.title != null and (._doc.title | contains("50th"))) | {title: ._doc.title, content: ._doc.content, encryptionStatus: ._doc.encryptionStatus, recipients: ._doc.recipients, hasEncryptedData: (._doc.encryptedData != null)}'
```

**Verified Output:**
```json
{
  "title": "50th multi-recipient DM test",
  "content": "[Encrypted Message]",
  "encryptionStatus": "encrypted",
  "recipients": ["George"],
  "hasEncryptedData": true
}
{
  "title": "50th multi-recipient DM test",
  "content": "[Encrypted Message]",
  "encryptionStatus": "encrypted",
  "recipients": ["Jefferson"],
  "hasEncryptedData": true
}
```

### Example 2: Find message by title AND specific recipient

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "f2058164-3f93-4bfb-8c16-45bbe8ee509b",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(._doc.title != null and (._doc.title | contains("46th")) and (._doc.recipients[0] == "Jefferson")) | {title: ._doc.title, isEncrypted: ._doc.isEncrypted, encryptionStatus: ._doc.encryptionStatus, isDirectMessage: ._doc.isDirectMessage, recipients: ._doc.recipients, hasEncryptedData: (._doc.encryptedData != null)}'
```

**Verified Output:**
```json
{
  "title": "46th DM Test",
  "isEncrypted": null,
  "encryptionStatus": "encrypted",
  "isDirectMessage": true,
  "recipients": ["Jefferson"],
  "hasEncryptedData": true
}
```

### Example 3: Get all encrypted DMs with key fields

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "f2058164-3f93-4bfb-8c16-45bbe8ee509b",
    "includeAllItems": true
  }' | jq '.feedItems[] | select(._doc.encryptionStatus == "encrypted") | {title: ._doc.title, author: ._doc.author, recipients: ._doc.recipients, hasEncryptedData: (._doc.encryptedData != null)}'
```

### Example 4: Count total feed items

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dworld-global-session",
    "playerId": "f2058164-3f93-4bfb-8c16-45bbe8ee509b",
    "includeAllItems": true
  }' | jq '.feedItems | length'
```

---

## Complete One-Liner Workflow

For when you need to get everything in one go:

```bash
# Get player ID and immediately query
PLAYER_ID=$(curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/join" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d '{"appName": "dWorld", "playerName": "claude"}' | jq -r '.player.id') && \
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"dworld-global-session\", \"playerId\": \"$PLAYER_ID\", \"includeAllItems\": true}" | jq '.feedItems[] | select(._doc.title != null) | {title: ._doc.title, author: ._doc.author}'
```

---

## Signal Keys API

### Check a user's public keys on the server

```bash
curl -s -X GET "https://stranded-astronaut-server-production.up.railway.app/signal/keys?username=George" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA"
```

### Delete a user's keys (forces regeneration)

```bash
curl -s -X DELETE "https://stranded-astronaut-server-production.up.railway.app/signal/keys/George" \
  -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA"
```

---

## Common Mistakes (Claude, Don't Do These)

### Mistake 1: Using GET instead of POST
```bash
# WRONG - This endpoint doesn't exist
curl -X GET "https://stranded-astronaut-server-production.up.railway.app/feeditems"

# CORRECT
curl -X POST "https://stranded-astronaut-server-production.up.railway.app/sync" ...
```

### Mistake 2: Forgetting the playerId
```bash
# WRONG - Returns null/empty
curl -X POST ".../sync" -d '{"sessionId": "dworld-global-session", "includeAllItems": true}'

# CORRECT - Must include playerId
curl -X POST ".../sync" -d '{"sessionId": "dworld-global-session", "playerId": "xxx", "includeAllItems": true}'
```

### Mistake 3: Not using ._doc wrapper in jq
```bash
# WRONG - Returns nothing
jq '.feedItems[] | select(.title | contains("test"))'

# CORRECT - Use ._doc wrapper
jq '.feedItems[] | select(._doc.title != null and (._doc.title | contains("test")))'
```

### Mistake 4: Using wrong URL
```bash
# WRONG URLs
https://dworld-1-production.up.railway.app  # Old/wrong
https://stranded-astronaut.railway.app      # Missing full domain

# CORRECT URL
https://stranded-astronaut-server-production.up.railway.app
```

### Mistake 5: Forgetting null check before string operations
```bash
# WRONG - Crashes if title is null
jq '.feedItems[] | select(._doc.title | contains("test"))'

# CORRECT - Check for null first
jq '.feedItems[] | select(._doc.title != null and (._doc.title | contains("test")))'
```

---

## FeedItem Schema

### Fields inside `._doc`:

```javascript
{
  _id: ObjectId,
  title: String,
  content: String,                    // "[Encrypted Message]" if encrypted
  author: String,
  authorId: String,
  organization: String,
  timestamp: Date,
  type: String,                       // text|image|video|audio|web|presentation|event
  
  // Direct Message fields
  isDirectMessage: Boolean,
  recipients: [String],               // Array of recipient usernames
  
  // Encryption fields
  encryptedData: Buffer/Object,       // The encrypted blob
  encryptionStatus: String,           // "legacy"|"encrypted"|"public"
  encryptedMessageId: String,         // UUID linking split messages
  encryptedDataPerRecipient: Object,  // Per-recipient encrypted data (if used)
  
  // Engagement fields
  approvalCount: Number,
  disapprovalCount: Number,
  commentCount: Number,
  
  // Media fields
  imageUrl: String,
  imageData: Buffer,
  videoUrl: String,
  audioUrl: String,
  
  // Other fields
  isDeleted: Boolean,
  isRepost: Boolean,
  topics: [String],
  parentId: String
}
```

---

## Troubleshooting

### Error: "Cannot iterate over null (null)"
**Cause**: feedItems is null because you didn't provide a valid playerId  
**Solution**: Get a playerId from /join first

### Error: No results from jq filter
**Cause 1**: Not using `._doc` wrapper  
**Cause 2**: Not checking for null before string operations  
**Solution**: Use `select(._doc.field != null and (._doc.field | contains("x")))`

### Error: "Session not found"
**Cause**: Invalid or missing sessionId  
**Solution**: Always use `"sessionId": "dworld-global-session"`

### Empty response
**Cause**: Missing `includeAllItems: true`  
**Solution**: Always include `"includeAllItems": true` in the request body

---

## Quick Reference

| What You Need | Endpoint | Method |
|---------------|----------|--------|
| Get player ID | /join | POST |
| Get feed items | /sync | POST |
| Get user's Signal keys | /signal/keys?username=X | GET |
| Delete user's Signal keys | /signal/keys/X | DELETE |
| Test connection | /ping | POST |

---

## Constants

```
Server URL:    https://stranded-astronaut-server-production.up.railway.app
API Key:       b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA
Session ID:    dworld-global-session
App Name:      dWorld
```

---

## ⚠️ CRITICAL: Posting TheBook Chapters

**Claude: When asked to post chapters to TheBook, follow these rules EXACTLY:**

### Rule 1: NEVER Create Script Files

DO NOT create Python scripts, shell scripts, or any downloadable files. The user's Downloads folder has macOS security restrictions that prevent execution.

**WRONG:**
- Creating `post_chapters.py` or `post_chapters.sh`
- Telling user to download and run a file
- Using `mv` commands to move files around

**CORRECT:**
- Provide curl commands directly in the chat for copy-paste into Terminal

### Rule 2: Get Player ID First

Have the user run this and give you the ID:

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/join" -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" -H "Content-Type: application/json" -d '{"appName": "dWorld", "playerName": "garrett"}' | jq -r '.player.id'
```

### Rule 3: Provide Single-Line Curl Commands

Each chapter should be a single curl command the user can copy-paste. Chain multiple chapters with `&&`:

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/feed" -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" -H "Content-Type: application/json" -d '{"sessionId":"dworld-global-session","playerId":"PLAYER_ID_HERE","action":"publish","feedItem":{"id":"VALID-UUID-HERE","type":"text","title":"Chapter Title","chapterNumber":"X.Y","content":"Chapter content here with escaped quotes and newlines","author":"Garrett Gruener","organization":"Digital Republic","isTheBook":true,"isLibraryDocument":true}}' && curl -s -X POST ... && echo "Done"
```

### Rule 4: TheBook FeedItem Structure

Required fields for TheBook chapters:

```json
{
  "id": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",  // Valid UUID, uppercase
  "type": "text",
  "title": "Chapter Title",
  "chapterNumber": "X.Y",                        // e.g., "8.0", "10.3"
  "content": "Full chapter content...",
  "author": "Garrett Gruener",
  "organization": "Digital Republic",
  "isTheBook": true,
  "isLibraryDocument": true
}
```

### Rule 5: Content Escaping

In the JSON content field:
- Use `\n` for newlines
- Escape double quotes as needed or avoid them
- Keep apostrophes as-is (single quotes inside double-quoted JSON are fine)

### Rule 6: Actions

- `"action": "publish"` - Create new chapter
- `"action": "update"` - Update existing chapter (must use same ID)
- `"action": "delete"` - Delete chapter: `{"action":"delete","feedItem":{"id":"UUID"}}`

### Example: Posting Multiple Chapters

```bash
curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/feed" -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" -H "Content-Type: application/json" -d '{"sessionId":"dworld-global-session","playerId":"1c2c5fb9-a322-4aaa-a4bb-6adbd2a13dda","action":"publish","feedItem":{"id":"8A0B0C0D-0E0F-8000-0000-000000000000","type":"text","title":"The Failure Modes","chapterNumber":"8.0","content":"Chapter 8 intro content here...","author":"Garrett Gruener","organization":"Digital Republic","isTheBook":true,"isLibraryDocument":true}}' && curl -s -X POST "https://stranded-astronaut-server-production.up.railway.app/feed" -H "Authorization: Bearer b4cH9Pp2Kt8fRjX7eLw6Ts5qZmN3vDyA" -H "Content-Type: application/json" -d '{"sessionId":"dworld-global-session","playerId":"1c2c5fb9-a322-4aaa-a4bb-6adbd2a13dda","action":"publish","feedItem":{"id":"8A1B1C1D-1E1F-8111-1111-111111111111","type":"text","title":"The Root of Identity","chapterNumber":"8.1","content":"Chapter 8.1 content here...","author":"Garrett Gruener","organization":"Digital Republic","isTheBook":true,"isLibraryDocument":true}}' && echo "All chapters posted."
```

**Expected output:** `{"success":true,"feedItemId":"...","feedItemID":"..."}` for each chapter, then "All chapters posted."

---

**Last Updated:** January 23, 2026  
**Verified Working:** All examples tested and confirmed working
