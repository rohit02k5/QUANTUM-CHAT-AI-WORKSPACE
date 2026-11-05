/**
 * services/tableQuery.js — deterministic CSV analytics (Phase 3B.4).
 *
 * The model never writes code or queries: it only produces a STRUCTURED spec
 * {filters, groupBy, aggs, orderBy, limit, chart}, which this module validates
 * against the file's tableMeta allow-list and executes in plain server code.
 *
 * CSVs are re-parsed on demand with a streaming parser — never held whole in
 * memory — within a time and row cap (TABLE_QUERY_TIMEOUT_MS/TABLE_MAX_ROWS).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const gridfs = require("../utils/gridfs");

const TABLE_MAX_ROWS = () => Math.max(100, parseInt(process.env.TABLE_MAX_ROWS || "50000", 10));
const TABLE_QUERY_TIMEOUT_MS = () => Math.max(1000, parseInt(process.env.TABLE_QUERY_TIMEOUT_MS || "10000", 10));
const QUERY_LIMIT_MAX = 1000;

const csv = () => import("csv-parse");

/** Stream the file's CSV bytes to a temp path; caller unlinks. */
async function csvToTemp(file) {
    const tmp = path.join(os.tmpdir(), `csv-${file._id}-${Date.now()}.csv`);
    if (file.gridfsId) {
        await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(tmp);
            gridfs.openDownloadStream(file.gridfsId).on("error", reject).pipe(ws);
            ws.on("error", reject).on("finish", resolve);
        });
    } else if (file.path && fs.existsSync(path.resolve(file.path))) {
        fs.copyFileSync(path.resolve(file.path), tmp);
    } else {
        throw new Error("file bytes not found");
    }
    return tmp;
}

/** Iterate parsed rows (objects keyed by header) from a temp CSV path. */
async function* streamRows(csvPath, { maxRows = Infinity } = {}) {
    const { parse } = await csv();
    const parser = fs.createReadStream(csvPath).pipe(
        parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true })
    );
    let n = 0;
    for await (const row of parser) {
        if (++n > maxRows) return;
        yield row;
    }
}

const isBlank = (v) => v == null || String(v).trim() === "";
const num = (v) => {
    if (isBlank(v)) return null;
    const n = Number(String(v).replace(/[$,%]/g, "").trim());
    return Number.isFinite(n) ? n : null;
};
const looksDate = (v) => !isBlank(v) && !Number.isNaN(Date.parse(v)) && /[-/:]|\d{4}/.test(String(v));

/**
 * Compute File.tableMeta by streaming the CSV once:
 * {columns:[{name,type,nullCount,min,max,mean?,topValues?}], rowCount,
 *  sampleRows(5), truncated}
 */
async function computeTableMeta(csvPath) {
    const maxRows = TABLE_MAX_ROWS();
    const cols = new Map(); // name -> accumulator (Map is __proto__-safe)
    const order = [];
    const sampleRows = [];
    let rowCount = 0;
    let truncated = false;

    for await (const row of streamRows(csvPath, { maxRows: maxRows + 1 })) {
        rowCount++;
        if (rowCount > maxRows) { truncated = true; rowCount--; break; }
        if (sampleRows.length < 5) sampleRows.push({ ...row });
        for (const [name, raw] of Object.entries(row)) {
            let c = cols.get(name);
            if (!c) {
                c = { nullCount: 0, numeric: 0, dates: 0, seen: 0, min: null, max: null, sum: 0, values: new Map() };
                cols.set(name, c);
                order.push(name);
            }
            c.seen++;
            if (isBlank(raw)) { c.nullCount++; continue; }
            const n = num(raw);
            if (n != null) {
                c.numeric++;
                c.sum += n;
                c.min = c.min == null ? n : Math.min(c.min, n);
                c.max = c.max == null ? n : Math.max(c.max, n);
            } else if (looksDate(raw)) c.dates++;
            if (c.values.size <= 20 || c.values.has(String(raw))) {
                c.values.set(String(raw), (c.values.get(String(raw)) || 0) + 1);
            }
        }
    }

    const columns = order.map((name) => {
        const c = cols.get(name);
        const nonNull = c.seen - c.nullCount;
        // A column is number-typed when every non-null value parsed numerically
        const type = nonNull > 0 && c.numeric === nonNull ? "number"
            : nonNull > 0 && c.dates === nonNull ? "date"
            : nonNull === 0 ? "string"
            : c.values.size <= 2 && [...c.values.keys()].every((v) => /^(true|false|yes|no|0|1)$/i.test(v)) ? "boolean"
            : "string";
        const col = { name, type, nullCount: c.nullCount };
        if (type === "number") {
            col.min = c.min;
            col.max = c.max;
            col.mean = Math.round((c.sum / c.numeric) * 10000) / 10000;
        } else {
            const top = [...c.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, n]) => ({ value: v, count: n }));
            if (top.length) col.topValues = top;
            const strs = [...c.values.keys()].filter((v) => !isBlank(v));
            if (strs.length) {
                col.min = strs.reduce((a, b) => (a < b ? a : b));
                col.max = strs.reduce((a, b) => (a > b ? a : b));
            }
        }
        return col;
    });

    return { columns, rowCount, sampleRows, truncated };
}

// ---------------------------------------------------------------------------
// Spec validation
// ---------------------------------------------------------------------------

const OPS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]);
const NUMERIC_OPS = new Set(["gt", "gte", "lt", "lte"]);
const AGG_FNS = new Set(["sum", "avg", "count", "min", "max"]);
const CHART_TYPES = new Set(["bar", "line", "pie", "scatter"]);

class SpecError extends Error {
    constructor(msg) { super(msg); this.name = "SpecError"; this.retryable = true; }
}

/**
 * Validate a spec against tableMeta. Throws SpecError with a friendly,
 * retryable message. Returns a normalized spec.
 */
function validateSpec(spec, tableMeta) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
        throw new SpecError("the question couldn't be turned into a table query — try rephrasing");
    }
    const cols = tableMeta?.columns || [];
    const colMap = new Map(cols.map((c) => [c.name, c]));
    const known = (name, ctx) => {
        if (!colMap.has(name)) {
            throw new SpecError(`unknown column "${name}" in ${ctx} — the CSV has: ${cols.map((c) => c.name).slice(0, 10).join(", ")}`);
        }
        return colMap.get(name);
    };

    const out = {};
    const filters = Array.isArray(spec.filters) ? spec.filters : [];
    out.filters = filters.map((f, i) => {
        if (!f || typeof f !== "object") throw new SpecError(`filter ${i} is malformed`);
        const col = known(f.col, `filter ${i}`);
        if (!OPS.has(f.op)) throw new SpecError(`filter ${i}: unsupported op "${f.op}"`);
        if (NUMERIC_OPS.has(f.op) && col.type !== "number") {
            throw new SpecError(`can't compare "${col.name}" (${col.type}) with ${f.op} — that op needs a number column`);
        }
        if (f.op === "contains" && col.type === "number") {
            throw new SpecError(`"contains" doesn't apply to the number column "${col.name}"`);
        }
        if (f.op === "in" && !Array.isArray(f.value)) {
            throw new SpecError(`filter ${i}: "in" needs a list of values`);
        }
        return { col: f.col, op: f.op, value: f.value };
    });

    const groupBy = Array.isArray(spec.groupBy) ? spec.groupBy.slice(0, 3) : [];
    groupBy.forEach((g) => known(g, "groupBy"));
    out.groupBy = groupBy;

    const aggs = Array.isArray(spec.aggs) ? spec.aggs.slice(0, 5) : [];
    out.aggs = aggs.map((a, i) => {
        if (!a || typeof a !== "object") throw new SpecError(`aggregation ${i} is malformed`);
        const col = known(a.col, `aggregation ${i}`);
        if (!AGG_FNS.has(a.fn)) throw new SpecError(`aggregation ${i}: unsupported fn "${a.fn}"`);
        if ((a.fn === "sum" || a.fn === "avg") && col.type !== "number") {
            throw new SpecError(`can't ${a.fn} a ${col.type} column ("${col.name}") — use count, min or max`);
        }
        return { col: a.col, fn: a.fn, alias: a.alias || `${a.fn}_${a.col}` };
    });

    if (spec.orderBy && typeof spec.orderBy === "object") {
        const aliases = new Set(out.aggs.map((a) => a.alias));
        const c = spec.orderBy.col;
        if (!colMap.has(c) && !aliases.has(c)) {
            throw new SpecError(`orderBy "${c}" isn't a column or an aggregation alias`);
        }
        out.orderBy = { col: c, dir: spec.orderBy.dir === "desc" ? "desc" : "asc" };
    }

    const limit = Number(spec.limit);
    out.limit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), QUERY_LIMIT_MAX) : Math.min(100, QUERY_LIMIT_MAX);

    if (spec.chart && typeof spec.chart === "object" && spec.chart.type) {
        if (!CHART_TYPES.has(spec.chart.type)) throw new SpecError(`unsupported chart type "${spec.chart.type}"`);
        const x = spec.chart.x ?? groupBy[0];
        const y = spec.chart.y ?? out.aggs[0]?.alias;
        const aliases = new Set(out.aggs.map((a) => a.alias));
        if (x != null && !colMap.has(x) && !groupBy.includes(x)) throw new SpecError(`chart x "${x}" isn't a group column`);
        if (y != null && !colMap.has(y) && !aliases.has(y)) throw new SpecError(`chart y "${y}" isn't a column or aggregation`);
        if (x != null && y != null) out.chart = { type: spec.chart.type, x, y };
    }
    return out;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const cmpVal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function rowPasses(row, filters) {
    for (const f of filters) {
        const raw = row[f.col];
        switch (f.op) {
            case "eq": if (String(raw ?? "").trim() !== String(f.value).trim()) return false; break;
            case "ne": if (String(raw ?? "").trim() === String(f.value).trim()) return false; break;
            case "gt": { const n = num(raw); if (n == null || !(n > num(f.value))) return false; break; }
            case "gte": { const n = num(raw); if (n == null || !(n >= num(f.value))) return false; break; }
            case "lt": { const n = num(raw); if (n == null || !(n < num(f.value))) return false; break; }
            case "lte": { const n = num(raw); if (n == null || !(n <= num(f.value))) return false; break; }
            case "in": {
                const set = new Set((f.value || []).map((v) => String(v).trim()));
                if (!set.has(String(raw ?? "").trim())) return false;
                break;
            }
            case "contains": {
                // Plain substring — never a RegExp from user input.
                const hay = String(raw ?? "").toLowerCase();
                if (!hay.includes(String(f.value ?? "").toLowerCase())) return false;
                break;
            }
            default: return false;
        }
    }
    return true;
}

function aggInit() { return { sum: 0, count: 0, min: null, max: null }; }
function aggPush(acc, raw, numericCol) {
    acc.count++;
    const n = numericCol ? num(raw) : null;
    if (n != null) {
        acc.sum += n;
        acc.min = acc.min == null ? n : Math.min(acc.min, n);
        acc.max = acc.max == null ? n : Math.max(acc.max, n);
    }
}
const aggOut = (acc, fn) => {
    switch (fn) {
        case "count": return acc.count;
        case "sum": return Math.round(acc.sum * 10000) / 10000;
        case "avg": return acc.count ? Math.round((acc.sum / acc.count) * 10000) / 10000 : null;
        case "min": return acc.min;
        case "max": return acc.max;
        default: return null;
    }
};

/**
 * Execute a validated spec by streaming the CSV once.
 * Returns {rows, rowCount, truncated, chartSpec?}.
 */
async function executeSpec(csvPath, spec, tableMeta) {
    const deadline = Date.now() + TABLE_QUERY_TIMEOUT_MS();
    const colTypes = new Map((tableMeta?.columns || []).map((c) => [c.name, c.type]));
    const groupCols = spec.groupBy || [];
    const groups = new Map(); // Map is __proto__/constructor-safe for group keys
    const flatRows = [];
    let rowCount = 0;
    let truncated = false;

    for await (const row of streamRows(csvPath, { maxRows: TABLE_MAX_ROWS() })) {
        if (Date.now() > deadline) { truncated = true; break; }
        if (!rowPasses(row, spec.filters || [])) continue;
        rowCount++;
        if (groupCols.length) {
            const key = JSON.stringify(groupCols.map((g) => row[g] ?? null));
            let g = groups.get(key);
            if (!g) {
                g = { keyParts: groupCols.map((c) => row[c] ?? null), accs: new Map() };
                groups.set(key, g);
            }
            for (const a of spec.aggs || []) {
                let acc = g.accs.get(a.alias);
                if (!acc) { acc = aggInit(); g.accs.set(a.alias, acc); }
                aggPush(acc, row[a.col], colTypes.get(a.col) === "number");
            }
        } else if (flatRows.length < QUERY_LIMIT_MAX) {
            flatRows.push({ ...row });
        }
    }

    let rows;
    if (groupCols.length) {
        rows = [...groups.values()].map((g) => {
            const out = {};
            groupCols.forEach((c, i) => { out[c] = g.keyParts[i]; });
            for (const a of spec.aggs || []) out[a.alias] = aggOut(g.accs.get(a.alias), a.fn);
            return out;
        });
    } else {
        rows = flatRows;
    }

    if (spec.orderBy) {
        const { col, dir } = spec.orderBy;
        rows.sort((a, b) => {
            const na = num(a[col]); const nb = num(b[col]);
            const va = na != null && nb != null ? cmpVal(na, nb) : cmpVal(String(a[col] ?? ""), String(b[col] ?? ""));
            return dir === "desc" ? -va : va;
        });
    }
    if (rows.length > spec.limit) { rows = rows.slice(0, spec.limit); truncated = true; }

    return {
        rows,
        rowCount,
        truncated: truncated || (tableMeta?.truncated ?? false),
        chartSpec: spec.chart || undefined,
    };
}

module.exports = { computeTableMeta, validateSpec, executeSpec, csvToTemp, streamRows, SpecError, TABLE_MAX_ROWS, TABLE_QUERY_TIMEOUT_MS };
