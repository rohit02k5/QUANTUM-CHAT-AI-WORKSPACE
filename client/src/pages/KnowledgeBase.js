import React, { useState, useEffect } from "react";
import { Box, Typography, TextField, InputAdornment, Grid, Paper, Chip, useTheme, Card, CardContent, IconButton } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import DescriptionIcon from "@mui/icons-material/Description";
import ImageIcon from "@mui/icons-material/Image";
import DeleteIcon from "@mui/icons-material/Delete";
import axios from "../axiosConfig";
import toast from "react-hot-toast";
import { motion } from "framer-motion";

const KnowledgeBase = () => {
    const theme = useTheme();
    const [searchTerm, setSearchTerm] = useState("");
    const [results, setResults] = useState([]);
    const [mediaItems, setMediaItems] = useState([]);
    const [stats, setStats] = useState({ chats: 0, files: 0 });

    useEffect(() => {
        console.log("KnowledgeBase Mounted"); // Debug Log
        const fetchData = async () => {
            try {
                const [chatsRes, filesRes] = await Promise.all([
                    axios.get("/api/v1/chat/history"),
                    axios.get("/api/v1/files/list")
                ]);

                const chats = chatsRes.data.chats || [];
                const files = filesRes.data.files || [];

                setStats({ chats: chats.length, files: files.length });

                // Map files to media items format
                const recentFiles = files.slice(0, 6).map(f => ({
                    id: f._id,
                    type: f.mimetype.includes("image") ? "image" : "doc",
                    name: f.originalName,
                    originalName: f.originalName,
                    filename: f.filename,
                    date: new Date(f.uploadDate).toLocaleDateString()
                }));
                setMediaItems(recentFiles);

            } catch (error) {
                console.error("Failed to load knowledge base data", error);
            }
        };
        fetchData();
    }, []);

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

    // Files live behind auth — fetch as blob and open an object URL
    const handleViewFile = async (item) => {
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
                // Use global search endpoint
                const { data } = await axios.get(`/api/v1/search?query=${e.target.value}`);
                // Combine results for display (Files + Chats)
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
                                <Box sx={{ height: 140, bgcolor: theme.palette.neutral?.light || "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {item.type === "image" ? <ImageIcon sx={{ fontSize: 60, opacity: 0.5 }} /> : <DescriptionIcon sx={{ fontSize: 60, opacity: 0.5 }} />}
                                </Box>
                                <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="h6" noWrap>{item.originalName}</Typography>
                                        <Typography variant="caption" color="text.secondary">{item.date}</Typography>
                                    </Box>
                                    <IconButton size="small" onClick={(e) => handleDeleteFile(item.id, e)}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </CardContent>
                            </Card>
                        </motion.div>
                    </Grid>
                ))}
            </Grid>
        </Box>
    );
};

export default KnowledgeBase;
