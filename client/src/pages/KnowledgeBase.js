import React, { useState, useEffect, useRef } from "react";
import { Box, Typography, TextField, InputAdornment, Grid, Paper, Chip, useTheme, Card, CardContent, IconButton, LinearProgress, Tooltip } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DescriptionIcon from "@mui/icons-material/Description";
import ImageIcon from "@mui/icons-material/Image";
import DeleteIcon from "@mui/icons-material/Delete";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import ReplayIcon from "@mui/icons-material/Replay";
import axios from "../axiosConfig";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import AudioPlayerModal from "../components/AudioPlayerModal";

const baseURL = axios.baseURL;

const STAGE_LABELS = {
    extract: "Extracting text",
    transcribe: "Transcribing audio",
    chunk: "Chunking",
    embed: "Embedding",
    index: "Indexing",
    describe: "Finishing",
};

const KnowledgeBase = () => {
    const theme = useTheme();
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState([]);
    const [mediaItems, setMediaItems] = useState([]);
    const [stats, setStats] = useState({ chats: 0, files: 0 });
    const [player, setPlayer] = useState({ open: false, fileId: null, fileName: "", seekSec: null });
    const sseFailed = useRef(false);
    const sseAbort = useRef(new Map());

    const fetchData = async () => {
        try {
            const [chatsRes, filesRes] = await Promise.all([
                axios.get("/api/v1/chat/history"),
                axios.get("/api/v1/files/list")
            ]);

            const chats = chatsRes.data.chats || [];
            const files = filesRes.data.files || [];

            setStats({ chats: chats.length, files: files.length });
            setMediaItems(files.map((f) => ({
                id: f._id,
                type: f.kind === "audio" || (f.mimetype || "").startsWith("audio/") ? "audio" : "doc",
                name: f.originalName,
                originalName: f.originalName,
                filename: f.filename,
                status: f.status || "ready",
                job: f.job || null,
                durationSec: f.durationSec,
                date: new Date(f.uploadDate).toLocaleDateString()
            })));
        } catch (error) {
            console.error("Failed to load knowledge base data", error);
        }
    };

    useEffect(() => {
        fetchData();
        const aborted = sseAbort.current;
        return () => { for (const c of aborted.values()) c.abort(); };
    }, []);

    const updateJob = (fileId, evt) => {
        setMediaItems((prev) => prev.map((it) =>
            it.id === fileId
                ? {
                    ...it,
                    status: evt.status === "done" ? "ready" : evt.status === "failed" ? "failed" : "processing",
                    job: { ...(it.job || {}), status: evt.status, stage: evt.stage, progress: evt.progress, error: evt.error },
                }
                : it
        ));
        if (evt.status === "done" || evt.status === "failed") fetchData();
    };

    // Open one SSE stream per processing file (polling fallback when SSE fails)
    useEffect(() => {
        if (sseFailed.current) return;
        for (const item of mediaItems) {
            if (item.status !== "processing" || sseAbort.current.has(item.id)) continue;
            const ctrl = new AbortController();
            sseAbort.current.set(item.id, ctrl);
            (async () => {
                try {
                    const token = localStorage.getItem("authToken");
                    const res = await fetch(`${baseURL}/api/v1/files/${item.id}/ingestion/stream`, {
                        headers: { Authorization: `Bearer ${token}` },
                        signal: ctrl.signal,
                    });
                    if (!res.ok || !res.body) throw new Error("sse unavailable");
                    const reader = res.body.getReader();
                    const dec = new TextDecoder();
                    let buf = "";
                    for (;;) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buf += dec.decode(value, { stream: true });
                        const events = buf.split("\n\n");
                        buf = events.pop();
                        for (const ev of events) {
                            const line = ev.split("\n").find((l) => l.startsWith("data:"));
                            if (!line) continue;
                            try { updateJob(item.id, JSON.parse(line.slice(5))); } catch { /* ignore */ }
                        }
                    }
                } catch (e) {
                    if (!ctrl.signal.aborted) {
                        sseFailed.current = true;
                        fetchData(); // drop to polling
                    }
                } finally {
                    sseAbort.current.delete(item.id);
                }
            })();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaItems]);

    // Polling fallback while anything is still processing (or SSE unavailable)
    const anyProcessing = mediaItems.some((it) => it.status === "processing");
    useEffect(() => {
        if (!anyProcessing && !sseFailed.current) return undefined;
        const t = setInterval(fetchData, 4000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anyProcessing, sseFailed.current]);

    const handleDeleteFile = async (id, e) => {
        e.stopPropagation();
        try {
            await axios.delete(`/api/v1/files/${id}`);
            setMediaItems((prev) => prev.filter((item) => item.id !== id));
            setStats((prev) => ({ ...prev, files: prev.files - 1 }));
            toast.success("File deleted");
        } catch (err) {
            toast.error("Delete failed");
        }
    };

    const handleRetry = async (item, e) => {
        e.stopPropagation();
        try {
            const jobId = item.job?.id;
            if (jobId) await axios.post(`/api/v1/jobs/${jobId}/retry`);
            toast.success("Retry queued");
            fetchData();
        } catch (err) {
            toast.error(err.response?.data?.message || "Retry failed");
        }
    };

    // Files live behind auth — audio opens the player, docs open as blob
    const handleViewFile = async (item) => {
        if (item.type === "audio") {
            setPlayer({ open: true, fileId: item.id, fileName: item.originalName, seekSec: null });
            return;
        }
        try {
            const { data } = await axios.get(`/api/v1/files/${item.id}/view`, { responseType: "blob" });
            const url = URL.createObjectURL(data);
            window.open(url, "_blank");
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
            toast.error("Could not open file");
        }
    };

    const handleSearch = async (e) => {
        setSearchTerm(e.target.value);
        if (e.target.value.length > 2) {
            try {
                const { data } = await axios.get(`/api/v1/search?query=${e.target.value}`);
                const mixedResults = [
                    ...(data.files || []).map(f => ({ ...f, type: 'file' })),
                    ...(data.chats || []).map(c => ({ ...c, type: 'chat' }))
                ];
                setResults(mixedResults);
            } catch (err) {
                console.error(err);
            }
        } else {
            setResults([]);
        }
    };

    const fileIcon = (item) => {
        if (item.type === "audio") return <AudiotrackIcon sx={{ fontSize: 60, opacity: 0.5 }} />;
        if (item.type === "image") return <ImageIcon sx={{ fontSize: 60, opacity: 0.5 }} />;
        return <DescriptionIcon sx={{ fontSize: 60, opacity: 0.5 }} />;
    };

    return (
        <Box>
            <Typography variant="h3" fontWeight="bold" sx={{ mb: 4, background: "linear-gradient(90deg, #38bdf8, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Knowledge Base
            </Typography>

            {/* Stats Row */}
            <Grid container spacing={3} sx={{ mb: 5 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 3, borderRadius: "16px", bgcolor: theme.palette.background.paper, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Typography variant="h2" color="primary">{stats.chats}</Typography>
                        <Typography color="text.secondary">Total Chats</Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper sx={{ p: 3, borderRadius: "16px", bgcolor: theme.palette.background.paper, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Typography variant="h2" color="secondary">{stats.files}</Typography>
                        <Typography color="text.secondary">Uploaded Files</Typography>
                    </Paper>
                </Grid>
            </Grid>

            {/* Search */}
            <TextField
                fullWidth
                placeholder="Search across your entire workspace..."
                value={searchTerm}
                onChange={handleSearch}
                InputProps={{
                    startAdornment: <InputAdornment position="start"><SearchIcon color="primary" /></InputAdornment>,
                    sx: { borderRadius: "12px", bgcolor: theme.palette.background?.glass || "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)" }
                }}
                sx={{ mb: 4 }}
            />

            {/* Search Results */}
            {results.length > 0 && (
                <Box sx={{ mb: 5 }}>
                    <Typography variant="h5" sx={{ mb: 2 }}>Search Results</Typography>
                    <Grid container spacing={2}>
                        {results.map((item, i) => (
                            <Grid item xs={12} key={i}>
                                <Paper sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <Box display="flex" alignItems="center">
                                        {item.type === 'chat' ? <SearchIcon color="secondary" sx={{ mr: 2 }} /> : <DescriptionIcon color="action" sx={{ mr: 2 }} />}
                                        <Box>
                                            <Typography fontWeight="bold">{item.title || item.originalName}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {item.type === 'chat' ? "Conversation" : "Document"} • {new Date(item.createdAt || item.uploadDate).toLocaleDateString()}
                                            </Typography>
                                        </Box>
                                    </Box>
                                    <Chip
                                        label={item.type === 'chat' ? "Chat" : "File"}
                                        size="small"
                                        color={item.type === 'chat' ? "secondary" : "primary"}
                                        variant="outlined"
                                    />
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                </Box>
            )}

            {/* Media Gallery */}
            <Typography variant="h5" sx={{ mb: 2 }}>Media & Files Library</Typography>
            <Grid container spacing={3}>
                {mediaItems.map((item, i) => (
                    <Grid item xs={12} sm={6} md={4} key={i}>
                        <motion.div whileHover={{ y: -5 }}>
                            <Card
                                sx={{ borderRadius: "16px", overflow: "hidden", cursor: "pointer" }}
                                onClick={() => handleViewFile(item)}
                            >
                                <Box sx={{ height: 140, bgcolor: theme.palette.neutral?.light || "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                                    {fileIcon(item)}
                                    {item.type === "audio" && item.durationSec != null && (
                                        <Chip size="small" label={`${Math.floor(item.durationSec / 60)}:${String(Math.floor(item.durationSec % 60)).padStart(2, "0")}`} sx={{ position: "absolute", bottom: 8, right: 8 }} />
                                    )}
                                </Box>
                                <CardContent>
                                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="h6" noWrap>{item.originalName}</Typography>
                                            <Typography variant="caption" color="text.secondary">{item.date}</Typography>
                                        </Box>
                                        <Box>
                                            {item.status === "failed" && (
                                                <Tooltip title={item.job?.error || "Ingestion failed — retry"}>
                                                    <IconButton size="small" color="error" onClick={(e) => handleRetry(item, e)}>
                                                        <ReplayIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            <IconButton size="small" onClick={(e) => handleDeleteFile(item.id, e)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    </Box>
                                    {item.status === "processing" && (
                                        <Box sx={{ mt: 1 }}>
                                            <LinearProgress
                                                variant={item.job?.progress != null ? "determinate" : "indeterminate"}
                                                value={item.job?.progress || 0}
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                                {STAGE_LABELS[item.job?.stage] || "Queued"}{item.job?.progress != null ? ` • ${item.job.progress}%` : ""}
                                            </Typography>
                                        </Box>
                                    )}
                                    {item.status === "failed" && (
                                        <Chip size="small" color="error" label="Ingestion failed" sx={{ mt: 1 }} />
                                    )}
                                </CardContent>
                            </Card>
                        </motion.div>
                    </Grid>
                ))}
            </Grid>

            <AudioPlayerModal
                open={player.open}
                onClose={() => setPlayer((p) => ({ ...p, open: false }))}
                fileId={player.fileId}
                fileName={player.fileName}
                seekSec={player.seekSec}
            />
        </Box>
    );
};

export default KnowledgeBase;
