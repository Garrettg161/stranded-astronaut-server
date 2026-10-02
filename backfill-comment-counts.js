// backfill-comment-counts.js
//
// One-time repair of FeedItem.commentCount.
//
// WHY THIS EXISTS. Before COMMENT-COUNT-1 / AMEND-1 (P-1261 A4) the comment
// publish handler incremented the parent with a single exact match on `id`:
//
//     FeedItem.findOneAndUpdate({ id: feedItem.parentId }, { $inc: ... })
//
// The client sends the STABLE feedItemID as parentId (CommentView.swift:522),
// because `id` is re-minted on every feed refresh for non-UUID server ids. So
// for any parent addressed by its numeric feedItemID the filter matched nothing
// and the $inc was silently lost. A4 fixed that going forward -- id first, then
// feedItemID -- but nothing recomputes the counts that were already missed.
//
// Verified live on 2026-10-02: a fresh comment published with parentId="6434"
// took its parent from 0 to 1, confirming A4 works. Four parents still carry a
// wrong count purely as pre-fix residue.
//
// WHAT IT DOES. Recomputes commentCount for every non-deleted parent from the
// actual non-deleted, non-DM comments that point at it, and writes only the ones
// that differ.
//
// SAFE BY DEFAULT: dry run. It prints the diff and writes nothing unless you
// pass --apply.
//
//   cd game-server
//   MONGODB_URI="<the production URI>" node backfill-comment-counts.js
//   MONGODB_URI="<the production URI>" node backfill-comment-counts.js --apply
//
// Run it against production ONLY when the dry run looks right. It touches
// nothing but the commentCount field, and only on items where the stored value
// disagrees with reality.

const mongoose = require('mongoose');

const APPLY    = process.argv.includes('--apply');
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dworld';

// Loose schema deliberately: this script must not impose or migrate any shape.
// strict:false so documents round-trip untouched apart from the one field.
const FeedItem = mongoose.model('FeedItem', new mongoose.Schema({}, {
    strict: false, collection: 'feeditems'
}));

// A FeedItem ID is case-insensitive in ALL operations -- normalize at point of use.
const norm = v => String(v == null ? '' : v).trim().toLowerCase();

(async () => {
    console.log(APPLY ? '*** APPLY MODE -- changes WILL be written ***'
                      : 'dry run -- nothing will be written (pass --apply to write)');
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('connected\n');

    const items = await FeedItem.find({ isDeleted: { $ne: true } }).lean();
    console.log(`loaded ${items.length} non-deleted feed items`);

    // Resolve a parentId the same way the server does: id first, then feedItemID.
    // id wins by construction, so an item whose id equals another's feedItemID
    // cannot silently steal the increment.
    // /debug/duplicates reports feedItemIDs carried by more than one item
    // (1735 x3, 1782, 2225, 2575 x2). Build BOTH maps most-recently-updated first
    // so first-wins resolves to the live item, which is the same tie-break the
    // server handler uses ({ sort: { updatedAt: -1 } }). Script and server then
    // agree on which duplicate is the real parent.
    const sorted = [...items].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const byId = new Map(), byFid = new Map();
    for (const it of sorted) {
        const kId = norm(it.id), kFid = norm(it.feedItemID);
        if (kId  && !byId.has(kId))   byId.set(kId, it);
        if (kFid && !byFid.has(kFid)) byFid.set(kFid, it);
    }

    // Count real feed comments only. A DM/group message legitimately has no
    // parentId, so isDirectMessage items are excluded rather than assumed absent.
    const actual = new Map();
    let commentTotal = 0;
    for (const it of items) {
        if (!it.parentId || it.isDirectMessage) continue;
        commentTotal++;
        const k = norm(it.parentId);
        if (!k) continue;
        actual.set(k, (actual.get(k) || 0) + 1);
    }
    console.log(`found ${commentTotal} real feed comments across ${actual.size} distinct parents\n`);

    const fixes = [];
    let orphaned = 0;
    for (const [key, count] of actual) {
        const parent = byId.get(key) || byFid.get(key);
        if (!parent) { orphaned++; continue; }          // parent deleted: nothing to repair
        const stored = Number(parent.commentCount || 0);
        if (stored !== count) {
            fixes.push({ _id: parent._id, id: parent.id, fid: parent.feedItemID,
                         title: String(parent.title || '').slice(0, 44), stored, count });
        }
    }

    // A parent whose comments were ALL deleted keeps a stale positive count and
    // never appears in `actual`, so it is reconciled separately.
    for (const it of items) {
        const stored = Number(it.commentCount || 0);
        if (stored === 0) continue;
        const kId  = norm(it.id), kFid = norm(it.feedItemID);
        if ((kId && actual.has(kId)) || (kFid && actual.has(kFid))) continue;  // handled above
        fixes.push({ _id: it._id, id: it.id, fid: it.feedItemID,
                     title: String(it.title || '').slice(0, 44), stored, count: 0 });
    }

    console.log(`parents whose own parent is gone (skipped): ${orphaned}`);
    console.log(`parents needing correction: ${fixes.length}\n`);

    if (fixes.length) {
        console.log('  fid      stored  actual   title');
        for (const f of fixes.sort((a, b) => (b.count - b.stored) - (a.count - a.stored))) {
            console.log(`  ${String(f.fid || '-').padEnd(8)} ${String(f.stored).padStart(6)} ${String(f.count).padStart(7)}   ${JSON.stringify(f.title)}`);
        }
        console.log('');
    }

    if (!APPLY) {
        console.log('dry run complete -- nothing written. Re-run with --apply to write.');
    } else if (!fixes.length) {
        console.log('nothing to do.');
    } else {
        // Only commentCount is touched. updatedAt is deliberately NOT bumped: it
        // drives client delta sync, and bumping it on hundreds of items would push
        // a pointless re-sync to every device. Four corrected counts reach clients
        // on their next full sync, which is soon enough for a historical repair.
        const res = await FeedItem.bulkWrite(fixes.map(f => ({
            updateOne: { filter: { _id: f._id }, update: { $set: { commentCount: f.count } } }
        })), { ordered: false });
        console.log(`APPLIED -- matched=${res.matchedCount} modified=${res.modifiedCount}`);
        console.log('NOTE: the running server holds global.allFeedItems in memory and will');
        console.log('      still serve the OLD counts until it restarts. Redeploy or restart');
        console.log('      the server after applying, or the next in-memory write can undo this.');
    }

    await mongoose.disconnect();
    console.log('\ndone.');
})().catch(err => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
