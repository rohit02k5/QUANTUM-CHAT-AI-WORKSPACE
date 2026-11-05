/**
 * utils/image.js — image ingestion helpers (Phase 3B.2).
 *  - magic-byte sniffing for png/jpg/jpeg/webp (extension/MIME never trusted)
 *  - IMAGE_MAX_MB cap; FEATURE_MULTIMODAL flag
 */
const IMAGE_MAX_BYTES = () => parseInt(process.env.IMAGE_MAX_MB || "8") * 1024 * 1024;
const MULTIMODAL_FEATURE = () => process.env.FEATURE_MULTIMODAL !== "false";

const SIGNATURES = [
    { mime: "image/png", ext: "png", test: (b) => b.length > 8 && b[0] === 0x89 && b.slice(1, 4).toString("latin1") === "PNG" },
    { mime: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    // webp: "RIFF....WEBP"
    { mime: "image/webp", ext: "webp", test: (b) => b.length > 12 && b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP" },
];

const ACCEPTED_MIMES = new Set(["image/png", "image/jpg", "image/jpeg", "image/webp"]);

/**
 * Validate an upload's head bytes as an image.
 * @returns {{mime,ext}|{error}}
 */
function sniffImage(head, declaredMime, sizeBytes) {
    if (!MULTIMODAL_FEATURE()) return { error: "Image uploads are disabled" };
    const size = sizeBytes != null ? sizeBytes : head.length;
    if (size > IMAGE_MAX_BYTES()) {
        return { error: `Images are limited to ${Math.round(IMAGE_MAX_BYTES() / 1024 / 1024)}MB` };
    }
    const hit = SIGNATURES.find((s) => s.test(head));
    if (!hit) {
        return { error: "Unsupported image format — use png, jpg, jpeg or webp" };
    }
    return hit;
}

const isImageMime = (mime) => ACCEPTED_MIMES.has((mime || "").toLowerCase());

/**
 * Turn a describeImage result into chunk docs (caption / OCR / insights),
 * each tagged type:"image". The caller embeds them like any chunk.
 */
function descriptionToDocs(desc, fileName) {
    const docs = [];
    if (desc.caption) {
        docs.push({
            pageContent: `Image "${fileName}": ${desc.caption}${desc.tags?.length ? ` [tags: ${desc.tags.join(", ")}]` : ""}`,
            metadata: { imagePart: "caption" },
        });
    }
    if (desc.ocrText && desc.ocrText.trim()) {
        docs.push({
            pageContent: `Text visible in image "${fileName}":\n${desc.ocrText}`,
            metadata: { imagePart: "ocr" },
        });
    }
    if (desc.dataInsights && desc.dataInsights.trim()) {
        docs.push({
            pageContent: `Data shown in image "${fileName}": ${desc.dataInsights}`,
            metadata: { imagePart: "insights" },
        });
    }
    return docs;
}

module.exports = { sniffImage, isImageMime, descriptionToDocs, IMAGE_MAX_BYTES, MULTIMODAL_FEATURE };
