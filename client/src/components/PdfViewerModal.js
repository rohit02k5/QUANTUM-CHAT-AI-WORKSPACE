import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle, DialogContent, Box, Typography, IconButton, CircularProgress, TextField } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import axios from "../axiosConfig";

/**
 * Authenticated PDF viewer: fetches bytes through /api/v1/files/:id/view as a
 * blob (never a public URL) and renders pages with pdfjs-dist — lazy-loaded so
 * the main bundle stays small and page navigation works identically in every
 * browser (blob-URL #page=N is NOT reliable cross-browser).
 */
const PdfViewerModal = ({ open, onClose, fileId, fileName, initialPage }) => {
    const canvasRef = useRef(null);
    const docRef = useRef(null);
    const [page, setPage] = useState(1);
    const [pageCount, setPageCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch bytes + open the document when the modal opens
    useEffect(() => {
        if (!open || !fileId) return undefined;
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const pdfjs = await import("pdfjs-dist");
                pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                    "pdfjs-dist/build/pdf.worker.min.mjs",
                    import.meta.url
                ).toString();
                const { data } = await axios.get(`/api/v1/files/${fileId}/view`, { responseType: "arraybuffer" });
                if (cancelled) return;
                const doc = await pdfjs.getDocument({ data }).promise;
                if (cancelled) { doc.destroy(); return; }
                docRef.current = doc;
                setPageCount(doc.numPages);
                setPage(Math.min(Math.max(1, initialPage || 1), doc.numPages));
            } catch (e) {
                if (!cancelled) setError("Could not load PDF");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
            docRef.current?.destroy();
            docRef.current = null;
        };
    }, [open, fileId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Render the current page onto the canvas
    useEffect(() => {
        const doc = docRef.current;
        const canvas = canvasRef.current;
        if (!doc || !canvas || !open) return undefined;
        let cancelled = false;
        let renderTask = null;
        (async () => {
            try {
                const pg = await doc.getPage(page);
                if (cancelled) return;
                const scale = Math.min(2, (canvas.parentElement?.clientWidth || 800) / pg.getViewport({ scale: 1 }).width);
                const viewport = pg.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
                renderTask = pg.render({ canvasContext: canvas.getContext("2d"), viewport });
                await renderTask.promise;
            } catch (e) {
                if (!cancelled && e?.name !== "RenderingCancelledException") setError("Could not render page");
            }
        })();
        return () => {
            cancelled = true;
            renderTask?.cancel();
        };
    }, [page, pageCount, open]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                    <PictureAsPdfIcon color="primary" />
                    <Typography variant="h6" noWrap sx={{ maxWidth: 360 }}>{fileName || "PDF"}</Typography>
                </Box>
                <Box display="flex" alignItems="center" gap={0.5}>
                    <IconButton size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><NavigateBeforeIcon /></IconButton>
                    <TextField
                        size="small"
                        value={page}
                        onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            if (n >= 1 && n <= pageCount) setPage(n);
                        }}
                        inputProps={{ style: { width: 36, textAlign: "center", padding: 4 } }}
                    />
                    <Typography variant="body2" color="text.secondary">/ {pageCount || "…"}</Typography>
                    <IconButton size="small" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}><NavigateNextIcon /></IconButton>
                    <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
                </Box>
            </DialogTitle>
            <DialogContent sx={{ pb: 3, display: "flex", justifyContent: "center", minHeight: 300 }}>
                {loading && <Box display="flex" alignItems="center" p={3}><CircularProgress /></Box>}
                {error && <Typography color="error">{error}</Typography>}
                <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", display: loading || error ? "none" : "block" }} />
            </DialogContent>
        </Dialog>
    );
};

export default PdfViewerModal;
