// Rollback companion to migrate-lowercase-feeditem-ids.js. Restores every
// FeedItem field-for-field from a /sync JSON backup taken via the API.
// Use only if the migration produces unexpected results and you want the
// pre-migration state back.
//
// Usage:
//   node restore-feeditems-from-backup.js path/to/backup.json
//   node restore-feeditems-from-backup.js path/to/backup.json --commit
//
// Default mode is DRY RUN. Pass --commit to actually write.
//
// What it does:
//   - Reads the JSON backup file (output of GET /sync with includeAllItems).
//   - For each item in feedItems[], unwraps ._doc if present.
//   - Performs an upsert keyed by `id` (the original id from the backup,
//     including its original case), replacing the entire document so any
//     mid-migration partial changes are reverted.
//   - Items in the live DB that weren't in the backup are left alone.
//
// Limitations:
//   - The backup is the /sync JSON, not a binary mongodump. Some MongoDB
//     internal metadata (timestamps from the driver, indexes) is not
//     preserved -- only the document content captured by /sync.
//   - Tombstones, history, sessions, signal keys are NOT restored.

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

const argv = process.argv.slice(2);
const BACKUP_FILE = argv.find(a => !a.startsWith('--'));
const COMMIT = argv.includes('--commit');

if (!BACKUP_FILE) {
    console.error('Usage: node restore-feeditems-from-backup.js path/to/backup.json [--commit]');
    process.exit(1);
}
if (!fs.existsSync(BACKUP_FILE)) {
    console.error(`Backup file not found: ${BACKUP_FILE}`);
    process.exit(1);
}

const FeedItemSchema = new mongoose.Schema({}, { strict: false, collection: 'feeditems' });
const FeedItem = mongoose.model('FeedItem', FeedItemSchema);

async function main() {
    const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('ERROR: set MONGO_URL or MONGODB_URI env var.');
        process.exit(1);
    }

    console.log(`Loading ${BACKUP_FILE}...`);
    const dump = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    const items = dump.feedItems || [];
    console.log(`Backup contains ${items.length} feedItems.`);

    await mongoose.connect(mongoUri);
    console.log(`Connected. Mode: ${COMMIT ? 'COMMIT (writes enabled)' : 'DRY RUN (no writes)'}`);

    let restored = 0;
    let skippedNoId = 0;
    let unchanged = 0;

    for (const it of items) {
        const docobj = it._doc || it;
        const id = docobj.id;
        if (!id) {
            skippedNoId++;
            continue;
        }
        // Strip mongoose-managed fields the dump may have included
        const payload = { ...docobj };
        delete payload._id;
        delete payload.__v;

        if (COMMIT) {
            await FeedItem.replaceOne({ id: id }, payload, { upsert: true });
            restored++;
        } else {
            // dry run -- just count what we'd write
            const existing = await FeedItem.findOne({ id: id }).lean();
            if (!existing) {
                restored++; // would re-insert
            } else {
                // would replace; we don't deep-compare in dry run
                restored++;
            }
        }
        if (restored % 100 === 0) console.log(`  ... ${restored}/${items.length}`);
    }

    console.log('');
    console.log('Summary:');
    console.log(`  Items in backup:                ${items.length}`);
    console.log(`  Restored (replaceOne upsert):   ${restored}${COMMIT ? '' : ' (DRY RUN)'}`);
    console.log(`  Skipped (no id field):          ${skippedNoId}`);
    if (!COMMIT) console.log('  Pass --commit to actually write.');

    await mongoose.disconnect();
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
