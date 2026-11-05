import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle, DialogContent, Box, Typography, IconButton, CircularProgress } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import axios from "../axiosConfig";

const fmt = (sec) => {
    if (sec == null || Number.isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Authenticated audio player: fetches the file through /api/v1/files/:id/view
 * as a blob (never a public URL) and plays it from an object URL.
 * `seekSec` jumps the playhead once audio is loaded — used by timestamp chips.
 */
const AudioPlayerModal = ({ open, onClose, fileId, fileName, seekSec }) => {
    const audioRef = useRef(null);
    const [url, setUrl] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!open || !fileId) return undefined;
        let objectUrl = null;
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const { data } = await axios.get(`/api/v1/files/${fileId}/view`, { responseType: "blob" });
                if (cancelled) return;
                objectUrl = URL.createObjectURL(data);
                setUrl(objectUrl);
            } catch (e) {
                if (!cancelled) setError("Could not load audio");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [open, fileId]);

    // Seek once the audio element has metadata
    useEffect(() => {
        const el = audioRef.current;
        if (!el || seekSec == null) return;
        const seek = () => { el.currentTime = seekSec; };
        if (el.readyState >= 1) seek();
        else el.addEventListener("loadedmetadata", seek, { once: true });
    }, [url, seekSec]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box display="flex" alignItems="center" gap={1}>
                    <GraphicEqIcon color="primary" />
                    <Typography variant="h6" noWrap sx={{ maxWidth: 360 }}>{fileName || "Audio"}</Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ pb: 3 }}>
                {loading && <Box display="flex" justifyContent="center" p={3}><CircularProgress /></Box>}
                {error && <Typography color="error">{error}</Typography>}
                {url && (
                    <>
                        <audio ref={audioRef} controls src={url} style={{ width: "100%" }} />
                        {seekSec != null && (
                            <Typography variant="caption" color="text.secondary">
                                Jumped to {fmt(seekSec)}
                            </Typography>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default AudioPlayerModal;
export { fmt as formatTimestamp };
