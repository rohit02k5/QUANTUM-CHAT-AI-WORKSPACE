/**
 * gen-retrieval-fixtures.js — deterministic generator for the retrieval
 * stress set (Phase 4.1). Writes:
 *   evals/fixtures-retrieval/*.txt   — ~40 short self-written documents
 *   evals/golden/retrieval.json      — ~40 queries with labeled gold
 *
 * Gold is expressed as [{file, marker}] — the marker is a unique substring
 * inside the expected chunk, so scoring doesn't depend on generated ids.
 * Categories: paraphrase, exact-identifier, multi-document, near-duplicate,
 * follow-up (pronoun-dependent; `standaloneQuery` is the gold rewrite used
 * to measure the rewrite ceiling without spending generate calls).
 *
 *   node scripts/gen-retrieval-fixtures.js
 */
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "../evals/fixtures-retrieval");
const GOLD = path.join(__dirname, "../evals/golden/retrieval.json");

// ---------------------------------------------------------------------------
// Documents — self-written, deliberately overlapping topics so retrieval has
// real competition. `marker` is a unique substring used for gold resolution.
// ---------------------------------------------------------------------------
const DOCS = [
    { f: "d01-orbital-basics.txt", t: "Orbital velocity for a circular low Earth orbit at 300 km altitude is about 7.7 km/s, giving an orbital period of roughly 90 minutes. Higher orbits move slower: geostationary satellites at 35,786 km travel near 3.07 km/s." },
    { f: "d02-escape-velocity.txt", t: "Escape velocity from Earth's surface is 11.2 km/s — about sqrt(2) times the circular-orbit speed at the same radius. From the Moon it is only 2.4 km/s because of the Moon's smaller mass and radius." },
    { f: "d03-hohmann-transfer.txt", t: "A Hohmann transfer between two circular orbits uses two engine burns. The first burn raises the apoapsis of an elliptical transfer orbit; the second circularizes at the new altitude. It is the most fuel-efficient two-impulse transfer." },
    { f: "d04-sourdough-hydration.txt", t: "A 75% hydration sourdough uses 500 g of flour and 375 g of water. Bakers quote hydration relative to flour weight: 80% hydration on 500 g flour means 400 g water, which produces an open, irregular crumb." },
    { f: "d05-sourdough-schedule.txt", t: "A typical sourdough schedule is bulk fermentation for 4 hours at 24 C with stretch-and-folds every 45 minutes, then a 12 hour cold proof in the refrigerator. Warmer kitchens shorten the bulk phase." },
    { f: "d06-yeast-vs-starter.txt", t: "Commercial yeast ferments dough in 1 to 2 hours, while a wild sourdough starter needs 4 to 12 hours because its yeast population is smaller and shares the culture with lactic acid bacteria that produce the sour flavour." },
    { f: "d07-fischer-spassky.txt", t: "In the 1972 World Championship in Reykjavik, Bobby Fischer defeated Boris Spassky 12.5 to 8.5. Fischer's win in Game 6, a Queen's Gambit Declined, is often called the finest game of the match." },
    { f: "d08-queens-gambit.txt", t: "The Queen's Gambit begins 1.d4 d5 2.c4. White offers the c-pawn to deflect Black's d-pawn and seize the centre. In the Declined line Black keeps the pawn structure with 2...e6." },
    { f: "d09-kasparov-deepblue.txt", t: "Garry Kasparov lost his 1997 rematch against IBM's Deep Blue 2.5 to 3.5. Deep Blue evaluated 200 million positions per second; Kasparov resigned the decisive game 6 after only 19 moves." },
    { f: "d10-k8s-pods.txt", t: "Every Kubernetes Pod receives its own cluster-internal IP address. Pods are ephemeral, so applications connect through a Service object that provides a stable virtual IP and DNS name across Pod restarts." },
    { f: "d11-k8s-deployments.txt", t: "A Kubernetes Deployment manages a ReplicaSet of Pods with declarative rolling updates. Changing the container image triggers a gradual rollout; a failing readiness probe pauses the rollout automatically." },
    { f: "d12-k8s-vs-docker.txt", t: "Docker runs containers on a single host, while Kubernetes schedules containers across a cluster of nodes and adds service discovery, self-healing, and horizontal scaling that plain Docker does not provide." },
    { f: "d13-tsukubai.txt", t: "A tsukubai is a low stone water basin at the entrance of a Japanese tea garden. Guests crouch to rinse their hands and mouth before the tea ceremony, a ritual act of purification and humility." },
    { f: "d14-zen-garden.txt", t: "A karesansui or dry landscape garden uses raked gravel and stones instead of water to suggest rivers and islands. Ryoan-ji in Kyoto is the most famous example, with 15 stones arranged so one is always hidden." },
    { f: "d15-tea-ceremony.txt", t: "The Japanese tea ceremony, chanoyu, centres on preparing matcha — powdered green tea whisked with a bamboo chasen. Every movement follows a choreographed temae sequence developed over centuries." },
    { f: "d16-photosynthesis.txt", t: "Photosynthesis splits water at photosystem II, releasing oxygen, then uses light energy to build ATP and NADPH that fix carbon dioxide into sugar through the Calvin cycle in the stroma of the chloroplast." },
    { f: "d17-cellular-respiration.txt", t: "Cellular respiration is roughly the reverse of photosynthesis: glucose and oxygen yield carbon dioxide, water, and about 30 to 32 ATP per glucose through glycolysis, the Krebs cycle, and oxidative phosphorylation." },
    { f: "d18-err-sku-1.txt", t: "When the ingest worker reports ERR-ING-4471, the document queue has stalled on a corrupt PDF. Purge the poisoned item with `quantumctl queue purge --id <jobId>` and restart the worker; normal uploads are unaffected." },
    { f: "d19-err-sku-2.txt", t: "Error ERR-AUTH-2290 means the OAuth state parameter did not match the stored nonce, usually because cookies were blocked or the user restarted the flow in a second tab. Retrying the login normally fixes it." },
    { f: "d20-sku-pricing.txt", t: "The Pro plan is SKU-QW-PRO-2025 at $29 per seat per month and includes 500 GB of document storage. The Team plan is SKU-QW-TEAM-2025 at $49 and adds shared workspaces and priority indexing." },
    { f: "d21-sku-hardware.txt", t: "Replacement parts use hardware SKUs: the quiet fan kit is HW-FAN-88B, the desk-mount arm is HW-ARM-12X, and the 65 W USB-C power brick is HW-PWR-65C. All three ship within five business days." },
    { f: "d22-api-rate-429.txt", t: "The API returns HTTP 429 when a client exceeds 60 requests per minute per key. The Retry-After header says how many seconds to wait; exponential backoff with jitter is recommended rather than fixed retries." },
    { f: "d23-api-versioning.txt", t: "API v3.2 introduced cursor pagination and deprecated the offset parameter, which is scheduled for removal in v4.0. Clients should migrate to `?cursor=`; offsets still work but emit a deprecation header." },
    { f: "d24-release-4-1-7.txt", t: "Release 4.1.7 fixes the memory leak in the PDF renderer and upgrades the tokenizer. Install it with `npm i quantum-cli@4.1.7`. Release 4.1.6 had a regression in streaming responses and should be skipped." },
    { f: "d25-release-4-1-6.txt", t: "Release 4.1.6 added SSE heartbeats but shipped a regression: the first streamed token could be dropped when buffering was enabled. It is superseded by 4.1.7 — do not deploy 4.1.6 to production." },
    { f: "d26-mongodb-textscore.txt", t: "A MongoDB text index supports $text search with per-term stemming and stop-word removal. The returned textScore is larger when more terms match; it is a relevance signal, not a probability, and cannot be compared across queries." },
    { f: "d27-rrf-explanation.txt", t: "Reciprocal Rank Fusion combines ranked lists by summing 1/(k+rank) across legs. With k=60, the top item of each list scores about 0.0164; documents found by every leg rise smoothly to the top of the fused ranking." },
    { f: "d28-embedding-dims.txt", t: "The embedding model returns a 768-dimensional vector. Changing EMBEDDING_DIMS requires re-embedding every chunk and rebuilding the Atlas vector index, because cosine similarity between different-dimensional vectors is undefined." },
    { f: "d29-cosine-similarity.txt", t: "Cosine similarity measures the angle between two vectors: 1 means identical direction, 0 means orthogonal, -1 means opposite. For retrieval it is robust to document length, unlike raw dot product which favours longer text." },
    { f: "d30-bm25.txt", t: "BM25 scores a document by term frequency saturation and inverse document frequency with length normalisation. Unlike TF-IDF, repeated terms hit a diminishing ceiling set by the k1 parameter, default 1.2." },
    { f: "d31-vector-vs-keyword.txt", t: "Vector search finds semantically similar text even when words differ, but it can miss exact identifiers like error codes. Keyword search nails rare literal tokens but cannot tell that 'car' and 'automobile' are related." },
    { f: "d32-recall-precision.txt", t: "Recall@k asks whether the right document appears in the top k results; MRR rewards higher ranks. A retriever can have perfect recall@5 and still be useless if the right answer is always rank five." },
    { f: "d33-quantum-qubit.txt", t: "A qubit holds a superposition of 0 and 1 described by two complex amplitudes whose squared magnitudes sum to one. Measuring a qubit collapses the superposition to a definite classical bit." },
    { f: "d34-quantum-entangle.txt", t: "Entangled qubits share a joint state that cannot be factored into individual states. Measuring one member of a Bell pair instantly determines the other, though no information travels faster than light." },
    { f: "d35-amazon-basin.txt", t: "The Amazon basin drains about 40 percent of South America and discharges 209,000 cubic metres per second into the Atlantic — more than the next seven largest rivers combined." },
    { f: "d36-nile-vs-amazon.txt", t: "The Nile at 6,650 km is usually called the longest river, but a 2014 survey extending the Amazon's source puts it near 7,000 km. The Amazon is unambiguously first by discharge volume." },
    { f: "d37-french-revolution.txt", t: "The French Revolution began in 1789 with the storming of the Bastille on July 14. The monarchy was abolished in 1792, and the Reign of Terror under Robespierre followed in 1793 and 1794." },
    { f: "d38-american-revolution.txt", t: "The American Revolution ran from 1775 to 1783. The Declaration of Independence was adopted in 1776, and the war ended with the Treaty of Paris, in which Britain recognised the United States." },
    { f: "d39-pandas.txt", t: "In pandas, df.groupby('region').agg({'revenue':'mean'}) computes per-group means, while df.groupby('region')['revenue'].transform('mean') keeps the row count and broadcasts each group's mean back to its rows." },
    { f: "d40-sql-groupby.txt", t: "SQL's GROUP BY collapses rows into groups for aggregate functions like AVG and SUM. Unlike pandas transform, SQL cannot broadcast an aggregate back to detail rows without a window function such as AVG() OVER (PARTITION BY region)." },
];

// ---------------------------------------------------------------------------
// Queries — {id, category, query, gold:[{file,marker}], [history,standalone]}
// ---------------------------------------------------------------------------
const QUERIES = [
    // --- paraphrase: little lexical overlap with the gold text ---
    { id: "para-01", cat: "paraphrase", q: "How fast does something need to travel to circle the Earth without falling?", gold: [{ f: "d01-orbital-basics.txt", m: "7.7 km/s" }] },
    { id: "para-02", cat: "paraphrase", q: "Minimum speed needed to leave Earth's gravity for good", gold: [{ f: "d02-escape-velocity.txt", m: "11.2 km/s" }] },
    { id: "para-03", cat: "paraphrase", q: "What's the most economical way to move a satellite between two orbits?", gold: [{ f: "d03-hohmann-transfer.txt", m: "most fuel-efficient" }] },
    { id: "para-04", cat: "paraphrase", q: "Why does home-baked bread with a starter take so much longer than bread from a packet of yeast?", gold: [{ f: "d06-yeast-vs-starter.txt", m: "1 to 2 hours" }] },
    { id: "para-05", cat: "paraphrase", q: "Which chess computer beat a reigning world champion and when?", gold: [{ f: "d09-kasparov-deepblue.txt", m: "Deep Blue" }] },
    { id: "para-06", cat: "paraphrase", q: "In Kubernetes, where do applications point when they need an address that survives restarts?", gold: [{ f: "d10-k8s-pods.txt", m: "stable virtual IP" }] },
    { id: "para-07", cat: "paraphrase", q: "The stone basin guests use to wash before a Japanese tea ceremony — what is it for?", gold: [{ f: "d13-tsukubai.txt", m: "ritual act of purification" }] },
    { id: "para-08", cat: "paraphrase", q: "How do plants turn sunlight into food energy?", gold: [{ f: "d16-photosynthesis.txt", m: "Calvin cycle" }] },
    { id: "para-09", cat: "paraphrase", q: "Which river system moves the most water on the planet?", gold: [{ f: "d35-amazon-basin.txt", m: "209,000 cubic metres" }] },
    { id: "para-10", cat: "paraphrase", q: "How do you keep per-row detail while adding a per-group average in a dataframe?", gold: [{ f: "d39-pandas.txt", m: "transform" }] },

    // --- exact-identifier: codes, SKUs, version numbers ---
    { id: "id-01", cat: "exact-identifier", q: "What does ERR-ING-4471 mean and how do I fix it?", gold: [{ f: "d18-err-sku-1.txt", m: "ERR-ING-4471" }] },
    { id: "id-02", cat: "exact-identifier", q: "ERR-AUTH-2290 keeps showing up on login", gold: [{ f: "d19-err-sku-2.txt", m: "ERR-AUTH-2290" }] },
    { id: "id-03", cat: "exact-identifier", q: "How much is SKU-QW-PRO-2025 per seat?", gold: [{ f: "d20-sku-pricing.txt", m: "SKU-QW-PRO-2025" }] },
    { id: "id-04", cat: "exact-identifier", q: "I need the power brick part number, I think it's HW-PWR-65C", gold: [{ f: "d21-sku-hardware.txt", m: "HW-PWR-65C" }] },
    { id: "id-05", cat: "exact-identifier", q: "What's the rate limit before the API sends 429?", gold: [{ f: "d22-api-rate-429.txt", m: "60 requests per minute" }] },
    { id: "id-06", cat: "exact-identifier", q: "When is the offset parameter being removed — v4.0?", gold: [{ f: "d23-api-versioning.txt", m: "v4.0" }] },
    { id: "id-07", cat: "exact-identifier", q: "npm command to install quantum-cli 4.1.7", gold: [{ f: "d24-release-4-1-7.txt", m: "quantum-cli@4.1.7" }] },
    { id: "id-08", cat: "exact-identifier", q: "How many dimensions does the embedding model produce?", gold: [{ f: "d28-embedding-dims.txt", m: "768-dimensional" }] },

    // --- multi-document: gold spans two files; first-listed is primary ---
    { id: "multi-01", cat: "multi-document", q: "Compare the orbital speeds of a low Earth orbit satellite and a geostationary one", gold: [{ f: "d01-orbital-basics.txt", m: "3.07 km/s" }, { f: "d02-escape-velocity.txt", m: "11.2 km/s" }] },
    { id: "multi-02", cat: "multi-document", q: "What hydration and what fermentation schedule should I use for a 500g flour loaf?", gold: [{ f: "d04-sourdough-hydration.txt", m: "375 g of water" }, { f: "d05-sourdough-schedule.txt", m: "4 hours at 24" }] },
    { id: "multi-03", cat: "multi-document", q: "How does GROUP BY in SQL differ from groupby in pandas when you want the aggregate back on each row?", gold: [{ f: "d40-sql-groupby.txt", m: "OVER (PARTITION BY" }, { f: "d39-pandas.txt", m: "transform" }] },
    { id: "multi-04", cat: "multi-document", q: "Which is longer, the Nile or the Amazon, and which carries more water?", gold: [{ f: "d36-nile-vs-amazon.txt", m: "6,650 km" }, { f: "d35-amazon-basin.txt", m: "209,000 cubic metres" }] },
    { id: "multi-05", cat: "multi-document", q: "When did the French and American revolutions each end?", gold: [{ f: "d37-french-revolution.txt", m: "1793" }, { f: "d38-american-revolution.txt", m: "Treaty of Paris" }] },
    { id: "multi-06", cat: "multi-document", q: "How does a qubit differ from a classical bit and what does entanglement add?", gold: [{ f: "d33-quantum-qubit.txt", m: "superposition" }, { f: "d34-quantum-entangle.txt", m: "Bell pair" }] },
    { id: "multi-07", cat: "multi-document", q: "What do vector search and keyword search each miss that the other catches?", gold: [{ f: "d31-vector-vs-keyword.txt", m: "error codes" }, { f: "d29-cosine-similarity.txt", m: "cosine" }] },
    { id: "multi-08", cat: "multi-document", q: "After bulk fermentation at 24 C, how long is the cold proof?", gold: [{ f: "d05-sourdough-schedule.txt", m: "12 hour cold proof" }, { f: "d04-sourdough-hydration.txt", m: "hydration" }] },

    // --- near-duplicate: plausible distractors sharing most vocabulary ---
    { id: "dup-01", cat: "near-duplicate", q: "Which release fixed the PDF renderer memory leak?", gold: [{ f: "d24-release-4-1-7.txt", m: "memory leak" }] },
    { id: "dup-02", cat: "near-duplicate", q: "Which release should not go to production?", gold: [{ f: "d25-release-4-1-6.txt", m: "superseded" }] },
    { id: "dup-03", cat: "near-duplicate", q: "How fast is a circular orbit at 300 km versus escape velocity at the surface?", gold: [{ f: "d01-orbital-basics.txt", m: "7.7 km/s" }] },
    { id: "dup-04", cat: "near-duplicate", q: "What's the hydration percentage in the basic sourdough recipe?", gold: [{ f: "d04-sourdough-hydration.txt", m: "75% hydration" }] },
    { id: "dup-05", cat: "near-duplicate", q: "How long does bulk fermentation take at 24 C?", gold: [{ f: "d05-sourdough-schedule.txt", m: "4 hours at 24" }] },
    { id: "dup-06", cat: "near-duplicate", q: "Which revolution included the Reign of Terror?", gold: [{ f: "d37-french-revolution.txt", m: "Reign of Terror" }] },
    { id: "dup-07", cat: "near-duplicate", q: "Who won the 1972 chess championship and what was the score?", gold: [{ f: "d07-fischer-spassky.txt", m: "12.5 to 8.5" }] },
    { id: "dup-08", cat: "near-duplicate", q: "What opening move sequence defines the Queen's Gambit?", gold: [{ f: "d08-queens-gambit.txt", m: "1.d4 d5 2.c4" }] },

    // --- follow-up: pronoun/ellipsis dependent; standalone is the gold rewrite ---
    { id: "fu-01", cat: "follow-up", q: "How long does it take?", history: [{ role: "user", content: "Tell me about Hohmann transfers" }, { role: "model", content: "A Hohmann transfer uses two burns to move between circular orbits." }], standalone: "How long does a Hohmann transfer take?" },
    { id: "fu-02", cat: "follow-up", q: "What temperature should I use for that?", history: [{ role: "user", content: "Explain sourdough bulk fermentation" }, { role: "model", content: "Bulk fermentation develops the dough after mixing." }], standalone: "What temperature should sourdough bulk fermentation use?" },
    { id: "fu-03", cat: "follow-up", q: "And what was its score?", history: [{ role: "user", content: "Who won the 1972 chess world championship?" }, { role: "model", content: "Bobby Fischer beat Boris Spassky in Reykjavik." }], standalone: "What was Fischer's score against Spassky in 1972?" },
    { id: "fu-04", cat: "follow-up", q: "How do I make it scale automatically?", history: [{ role: "user", content: "What does a Kubernetes Deployment do?" }, { role: "model", content: "It manages a ReplicaSet of Pods with declarative rolling updates." }], standalone: "How do I scale a Kubernetes Deployment automatically?" },
    { id: "fu-05", cat: "follow-up", q: "Where is it located?", history: [{ role: "user", content: "What is the tsukubai in a tea garden?" }, { role: "model", content: "A low stone water basin used for ritual purification." }], standalone: "Where is the tsukubai located in a tea garden?" },
    { id: "fu-06", cat: "follow-up", q: "How many positions could it evaluate?", history: [{ role: "user", content: "Tell me about Deep Blue vs Kasparov" }, { role: "model", content: "Deep Blue beat Kasparov in their 1997 rematch." }], standalone: "How many positions per second could Deep Blue evaluate?" },
];

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(GOLD), { recursive: true });

    // Follow-up gold resolution: the standalone query's expected doc is the
    // file its history discusses — resolve by topic overlap is fragile, so we
    // assign gold explicitly via a lookup the generator keeps obvious.
    const followUpGold = {
        "fu-01": [{ f: "d03-hohmann-transfer.txt", m: "two engine burns" }],
        "fu-02": [{ f: "d05-sourdough-schedule.txt", m: "4 hours at 24" }],
        "fu-03": [{ f: "d07-fischer-spassky.txt", m: "12.5 to 8.5" }],
        "fu-04": [{ f: "d11-k8s-deployments.txt", m: "ReplicaSet" }],
        "fu-05": [{ f: "d13-tsukubai.txt", m: "entrance of a Japanese tea garden" }],
        "fu-06": [{ f: "d09-kasparov-deepblue.txt", m: "200 million positions" }],
    };

    for (const d of DOCS) {
        // Guard: every marker referenced by gold must exist in its doc.
        const body = d.t;
        const refs = [];
        for (const q of QUERIES) {
            for (const g of q.gold || followUpGold[q.id] || []) {
                if (g.f === d.f) refs.push({ q: q.id, m: g.m });
            }
        }
        for (const r of refs) {
            if (!body.toLowerCase().includes(r.m.toLowerCase())) {
                throw new Error(`marker "${r.m}" for ${r.q} not found in ${d.f}`);
            }
        }
        fs.writeFileSync(path.join(OUT_DIR, d.f), body + "\n");
    }

    const golden = QUERIES.map((q) => ({
        id: q.id,
        category: q.cat,
        query: q.q,
        gold: q.gold || followUpGold[q.id],
        ...(q.history ? { history: q.history, standaloneQuery: q.standalone } : {}),
    }));
    fs.writeFileSync(GOLD, JSON.stringify(golden, null, 2) + "\n");
    console.log(`wrote ${DOCS.length} docs -> ${path.relative(process.cwd(), OUT_DIR)}`);
    console.log(`wrote ${golden.length} queries -> ${path.relative(process.cwd(), GOLD)}`);
    const cats = {};
    for (const g of golden) cats[g.category] = (cats[g.category] || 0) + 1;
    console.log("categories:", cats);
}

main().catch((e) => { console.error(e); process.exit(1); });
