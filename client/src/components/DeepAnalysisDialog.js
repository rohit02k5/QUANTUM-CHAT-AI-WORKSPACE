import React, { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, TextField, IconButton, Button, Chip, LinearProgress } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

const API_BASE = process.env.REACT_APP_API_URL || "";

/**
 * "Deep analysis" — vision pass over a PDF page range. Page cap enforced
 * server-side; daily quota shown. Follows progress via the ingestion SSE.
 */
const DeepAnalysisDialog = ({ open, onClose, file, onDone }) => {
    const [quota, setQuota] = useState(null); // {used, cap}
    const [maxPages, setMaxPages] = useState(20);
    const [pageStart, setPageStart] = useState("");
    const [pageEnd, setPageEnd] = useState("");
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(null);

    useEffect(() => {
        if (!open || !file) return;
        setRunning(false); setProgress(null); setPageStart(""); setPageEnd("");
        axios.get(`/api/v1/files/${file._id}/deep-analysis/quota`)
            .then(({ data }) => { setQuota(data.quota); setMaxPages(data.maxPages || 20); })
            .catch(() => setQuota(null));
    }, [open, file]);

    // Follow the job through the ingestion SSE once queued
    useEffect(() => {
        if (!running || !file) return;
        const es = new EventSource(`${API_BASE}/api/v1/files/${file._id}/ingestion/stream`, { withCredentials: true });
        es.onmessage = (e) => {
            try {
                const evt = JSON.parse(e.data);
                if (evt.status === "processing") setProgress(evt.progress);
                if (evt.status === "done" || evt.status === "failed") {
                    es.close(); setRunning(false); setProgress(null);
                    if (evt.status === "done") { toast.success("Deep analysis complete"); onDone?.(); }
                    else toast.error(evt.error || "Deep analysis failed");
                }
            } catch { /* ignore */ }
        };
        es.onerror = () => { es.close(); setRunning(false); setProgress(null); };
        return () => es.close();
    }, [running, file, onDone]);

    const start = async () => {
        try {
            const body = {};
            if (pageStart) body.pageStart = parseInt(pageStart, 10);
            if (pageEnd) body.pageEnd = parseInt(pageEnd, 10);
            await axios.post(`/api/v1/files/${file._id}/deep-analysis`, body);
            setQuota((q) => (q ? { used: (q.used || 0) + 1, cap: q.cap } : q));
            setRunning(true);
        } catch (e) {
            toast.error(e.response?.data?.message || "Could not start deep analysis");
        }
    };

    const suggested = file?.pagesWithoutText?.length
        ? `${file.pagesWithoutText[0]}${file.pagesWithoutText.length > 1 ? `-${file.pagesWithoutText[Math.min(file.pagesWithoutText.length - 1, 4)]}` : ""}`
        : `1-${Math.min(file?.pageCount || maxPages, maxPages)}`;

    return (
        <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box display="flex" alignItems="center" gap={1}>
                    <AutoAwesomeIcon color="primary" />
                    <Typography variant="h6">Deep analysis</Typography>
                </Box>
                <IconButton onClick={onClose} size="small" disabled={running}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Reads figures, tables, charts and scanned pages in <b>{file?.originalName}</b> — the results become citable.
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                    <TextField label="From page" size="small" type="number" value={pageStart} onChange={(e) => setPageStart(e.target.value)} inputProps={{ min: 1, max: file?.pageCount }} />
                    <TextField label="To page" size="small" type="number" value={pageEnd} onChange={(e) => setPageEnd(e.target.value)} inputProps={{ min: 1, max: file?.pageCount }} />
                </Box>
                <Box display="flex" gap={1} flexWrap="wrap">
                    <Chip size="small" variant="outlined" label={`max ${maxPages} pages/run`} />
                    {file?.pageCount != null && <Chip size="small" variant="outlined" label={`${file.pageCount} pages total`} />}
                    {quota && <Chip size="small" variant="outlined" color={quota.used >= quota.cap ? "error" : "default"} label={`${Math.max(0, quota.cap - (quota.used || 0))} runs left today`} />}
                </Box>
                {running && (
                    <Box sx={{ mt: 2 }}>
                        <LinearProgress variant={progress != null ? "determinate" : "indeterminate"} value={progress || 0} />
                        <Typography variant="caption" color="text.secondary">Analyzing pages…</Typography>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Typography variant="caption" color="text.secondary" sx={{ mr: "auto", pl: 1 }}>
                    e.g. {suggested}
                </Typography>
                <Button onClick={onClose} disabled={running}>Cancel</Button>
                <Button variant="contained" onClick={start} disabled={running || (quota && quota.used >= quota.cap)}>
                    {running ? "Running…" : "Analyze"}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DeepAnalysisDialog;
