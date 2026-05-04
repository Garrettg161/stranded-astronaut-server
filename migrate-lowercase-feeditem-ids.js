// One-shot migration: lowercase every FeedItem.id, FeedItem.feedItemID, and
// FeedItem.parentId in MongoDB. Run this exactly once, after deploying
// server v143 (which lowercases incoming IDs at the request boundary).
//
// Usage:
//   cd /path/to/game-server
//   node migrate-lowercase-feeditem-ids.js
//
// Safe to re-run: items already lowercase are skipped. Dry-run by default --
// pass --commit to actually write. Pass --verbose to log every change.
//
// What it does:
//   - For every FeedItem document, lowercases id, feedItemID, parentId.
//   - Detects collisions: if lowercasing id="ABC" would collide with an
//     existing id="abc", the item is left untouched and reported.
//     UUID collisions across cases are astronomically unlikely but the
//     script refuses to merge or overwrite.
//
// What it does NOT do:
//   - Does not touch FeedItemHistory, tombstones, or session.feedItems[].id.
//     Those are either ephemeral or addressed separately.
//   - Does not restart the server. After running, restart the Railway
//     service so global.allFeedItems re-loads from the now-canonical DB.

require('dotenv').config();
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const VERBOSE = argv.includes('--verbose');

const FeedItemSchema = new mongoose.Schema({}, { strict: false, collection: 'feeditems' });
const FeedItem = mongoose.model('FeedItem', FeedItemSchema);

async function main() {
    const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('ERROR: set MONGO_URL or MONGODB_URI env var.');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log(`Connected. Mode: ${COMMIT ? 'COMMIT (writes enabled)' : 'DRY RUN (no writes)'}`);

    const total = await FeedItem.countDocuments({});
    console.log(`Scanning ${total} FeedItem documents...`);

    let scanned = 0;
    let needsLowercaseId = 0;
    let needsLowercaseFeedItemID = 0;
    let needsLowercaseParentId = 0;
    let collisions = 0;
    let written = 0;

    const cursor = FeedItem.find({}).cursor();

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
        scanned++;
        if (scanned % 100 === 0) console.log(`  ... ${scanned}/${total}`);

        const updates = {};
        const obj = doc.toObject();

        if (typeof obj.id === 'string' && obj.id !== obj.id.toLowerCase()) {
            const lowerId = obj.id.toLowerCase();
            // Collision check: another document already has id=lowerId
            const conflict = await FeedItem.findOne({ id: lowerId, _id: { $ne: doc._id } }).lean();
            if (conflict) {
                console.error(`COLLISION: ${obj.id} (title=${JSON.stringify(obj.title)}) would collide with existing ${conflict.id}. Skipping.`);
                collisions++;
                continue;
            }
            updates.id = lowerId;
            needsLowercaseId++;
            if (VERBOSE) console.log(`  id: ${obj.id} -> ${lowerId} (title=${JSON.stringify(obj.title)})`);
        }

        if (typeof obj.feedItemID === 'string' && obj.feedItemID !== obj.feedItemID.toLowerCase()) {
            updates.feedItemID = obj.feedItemID.toLowerCase();
            needsLowercaseFeedItemID++;
        }

        if (typeof obj.parentId === 'string' && obj.parentId !== obj.parentId.toLowerCase()) {
            updates.parentId = obj.parentId.toLowerCase();
            needsLowercaseParentId++;
        }

        if (Object.keys(updates).length === 0) continue;

        if (COMMIT) {
            await FeedItem.updateOne({ _id: doc._id }, { $set: updates });
            written++;
        }
    }

    console.log('');
    console.log('Summary:');
    console.log(`  Scanned:                       ${scanned}`);
    console.log(`  id needs lowercasing:          ${needsLowercaseId}`);
    console.log(`  feedItemID needs lowercasing:  ${needsLowercaseFeedItemID}`);
    console.log(`  parentId needs lowercasing:    ${needsLowercaseParentId}`);
    console.log(`  collisions skipped:            ${collisions}`);
    console.log(`  documents updated:             ${written}${COMMIT ? '' : ' (DRY RUN -- pass --commit to write)'}`);

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
