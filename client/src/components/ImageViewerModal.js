import React, { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, Box, Typography, IconButton, CircularProgress, Chip, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ImageIcon from "@mui/icons-material/Image";
import axios from "../axiosConfig";

/**
 * Authenticated image viewer: fetches the original through
 * /api/v1/files/:id/view as a blob (never a public URL) and shows it next to
 * the AI-generated description, extracted text and data insights.
 */
const ImageViewerModal = ({ open, onClose, fileId, fileName, description }) => {
    const [url, setUrl] = useState(null);
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!open || !fileId) return undefined;
        let objectUrl = null;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setInfo(description || null);
        (async () => {
            try {
                const [imgRes, infoRes] = await Promise.all([
                    axios.get(`/api/v1/files/${fileId}/view`, { responseType: "blob" }),
                    description ? Promise.resolve(null) : axios.get(`/api/v1/files/${fileId}/info`).catch(() => null),
                ]);
                if (cancelled) return;
                objectUrl = URL.createObjectURL(imgRes.data);
                setUrl(objectUrl);
                if (infoRes?.data?.file?.description) setInfo(infoRes.data.file.description);
            } catch (e) {
                if (!cancelled) setError("Could not load image");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [open, fileId]); // eslint-disable-line react-hooks/exhaustive-deps

    const desc = info || {};

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                    <ImageIcon color="primary" />
                    <Typography variant="h6" noWrap sx={{ maxWidth: 420 }}>{fileName || "Image"}</Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ pb: 3 }}>
                {loading && <Box display="flex" justifyContent="center" p={3}><CircularProgress /></Box>}
                {error && <Typography color="error">{error}</Typography>}
                {url && (
                    <Box sx={{ display: "flex", gap: 3, flexDirection: { xs: "column", md: "row" } }}>
                        <Box sx={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", bgcolor: "action.hover", borderRadius: 2, p: 1 }}>
                            <img src={url} alt={fileName} style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            {desc.caption && (
                                <>
                                    <Typography variant="overline" color="text.secondary">Caption</Typography>
                                    <Typography variant="body2" paragraph>{desc.caption}</Typography>
                                </>
                            )}
                            {desc.tags?.length > 0 && (
                                <Box sx={{ mb: 2 }}>
                                    {desc.tags.map((t) => <Chip key={t} size="small" label={t} variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />)}
                                </Box>
                            )}
                            {desc.ocrText && (
                                <>
                                    <Divider sx={{ my: 1.5 }} />
                                    <Typography variant="overline" color="text.secondary">Extracted text</Typography>
                                    <Typography variant="body2" component="pre" sx={{ whiteSpace: "pre-wrap", fontFamily: "inherit", mb: 2 }}>{desc.ocrText}</Typography>
                                </>
                            )}
                            {desc.dataInsights && (
                                <>
                                    <Divider sx={{ my: 1.5 }} />
                                    <Typography variant="overline" color="text.secondary">Data insights</Typography>
                                    <Typography variant="body2">{desc.dataInsights}</Typography>
                                </>
                            )}
                        </Box>
                    </Box>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default ImageViewerModal;
