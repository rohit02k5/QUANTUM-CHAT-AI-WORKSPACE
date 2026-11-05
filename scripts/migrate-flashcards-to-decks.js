/**
 * migrate-flashcards-to-decks.js — Phase 5.2 legacy migration.
 *
 * Copies every FlashcardSet's cards into a Deck + Card set so legacy data is
 * reviewable under SM-2. IDEMPOTENT: decks carry `migratedFrom:<setId>` in a
 * marker field lookup — re-runs skip sets already migrated. DRY RUN:
 * `--dry-run` logs what would happen, writes nothing. NEVER deletes the
 * legacy FlashcardSet — deletion is a separate manual step after verify.
 *
 * Usage: node scripts/migrate-flashcards-to-decks.js [--dry-run]
 */
require("dotenv").config();
const mongoose = require("mongoose");

const DRY = process.argv.includes("--dry-run");

async function main() {
    const FlashcardSet = require("../models/FlashcardSet");
    const Deck = require("../models/Deck");
    const Card = require("../models/Card");

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`[migrate] connected (dry-run=${DRY})`);

    const sets = await FlashcardSet.find({}).lean();
    let migrated = 0, skipped = 0, cardsWritten = 0;

    for (const set of sets) {
        // Idempotency: a deck named with this exact migrated marker exists?
        // We store the set id in the deck name suffix — deterministic.
        const marker = `[set:${set._id}]`;
        const existing = await Deck.findOne({ user: set.user, name: { $regex: marker.replace(/[[\]]/g, "\\$&") + "$" } });
        if (existing) { skipped++; continue; }

        const deckName = `${(set.name || "Flashcards").slice(0, 100)} ${marker}`.slice(0, 120);
        console.log(`[migrate] ${DRY ? "would migrate" : "migrating"} set ${set._id} "${set.name}" (${set.cards?.length || 0} cards)`);
        if (!DRY) {
            const deck = await Deck.create({ user: set.user, name: deckName, sourceFile: set.sourceFile || undefined });
            const docs = (set.cards || [])
                .filter((c) => c?.q && c?.a)
                .map((c) => ({ user: set.user, deck: deck._id, front: c.q, back: c.a }));
            if (docs.length) await Card.insertMany(docs);
            cardsWritten += docs.length;
        } else {
            cardsWritten += (set.cards || []).filter((c) => c?.q && c?.a).length;
        }
        migrated++;
    }

    console.log(`[migrate] done — migrated=${migrated} skipped=${skipped} cards=${cardsWritten}${DRY ? " (dry-run)" : ""}`);
    await mongoose.disconnect();
}

main().catch((e) => { console.error("[migrate] failed:", e.message); process.exit(1); });
