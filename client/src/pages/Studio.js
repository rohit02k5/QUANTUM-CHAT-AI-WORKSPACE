import React, { useState } from "react";
import { Box, Typography, Button, Paper, Grid, Chip, IconButton, useTheme } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import SchoolIcon from "@mui/icons-material/School";
import DeleteIcon from "@mui/icons-material/Delete";
import { motion } from "framer-motion";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

const Studio = () => {
    const theme = useTheme();
    const [files, setFiles] = useState([]);
    const [comparisonResult, setComparisonResult] = useState(null);
    const [flashcards, setFlashcards] = useState([]);
    const [loading, setLoading] = useState(false);

    const handleFileUpload = async (e) => {
        const uploadedFiles = Array.from(e.target.files);
        if (files.length + uploadedFiles.length > 3) {
            toast.error("Max 3 files allowed for comparison");
            return;
        }

        for (const file of uploadedFiles) {
            const formData = new FormData();
            formData.append("file", file);
            const toastId = toast.loading(`Uploading ${file.name}...`);
            try {
                const token = localStorage.getItem("authToken");
                const { data } = await axios.post("/api/v1/files/upload", formData, {
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                });
                setFiles(prev => [...prev, { id: data.file._id, name: data.file.originalName }]);
                toast.success("Uploaded!", { id: toastId });
            } catch (error) {
                console.error(error);
                toast.error("Upload failed", { id: toastId });
            }
        }
    };

    const removeFile = (index) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);
    };

    const handleCompare = async () => {
        if (files.length < 2) return toast.error("Upload at least 2 files to compare");
        setLoading(true);
        const toastId = toast.loading("Analyzing Documents...");
        try {
            const fileIds = files.map(f => f.id);
            const { data } = await axios.post("/api/v1/studio/compare", { fileIds });
            setComparisonResult(data);
            toast.success("Comparison Complete", { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Comparison failed", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateFlashcards = async () => {
        if (files.length === 0) return toast.error("Upload a file first");
        setLoading(true);
        const toastId = toast.loading("Generating Flashcards...");
        try {
            // Use the last uploaded file for now, or allow selection
            const fileId = files[files.length - 1].id;
            const { data } = await axios.post("/api/v1/studio/flashcards", { fileId });
            setFlashcards(data.flashcards);
            toast.success("Flashcards Generated", { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Generation failed", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box>
            <Typography variant="h3" fontWeight="bold" sx={{ mb: 4, background: "linear-gradient(45deg, #22d3ee, #d946ef)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Quantum Studio
            </Typography>

            <Grid container spacing={4}>
                {/* Upload Section */}
                <Grid item xs={12} md={5}>
                    <Paper sx={{ p: 4, borderRadius: "20px", border: "1px dashed " + theme.palette.divider, textAlign: "center", bgcolor: theme.palette.background.alt }}>
                        <CloudUploadIcon sx={{ fontSize: 60, color: theme.palette.primary.main, mb: 2 }} />
                        <Typography variant="h6" gutterBottom>Upload Documents (PDF, TXT)</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Max 3 files for comparison</Typography>

                        <Button variant="contained" component="label">
                            Select Files
                            <input type="file" hidden multiple onChange={handleFileUpload} accept=".pdf,.txt,.docx" />
                        </Button>

                        <Box sx={{ mt: 3 }}>
                            {files.map((f, i) => (
                                <Box key={i} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, p: 1, border: "1px solid " + theme.palette.divider, borderRadius: "8px" }}>
                                    <Typography variant="body2" noWrap sx={{ maxWidth: "200px" }}>{f.name}</Typography>
                                    <IconButton size="small" color="error" onClick={() => removeFile(i)}><DeleteIcon /></IconButton>
                                </Box>
                            ))}
                        </Box>
                    </Paper>

                    <Box sx={{ mt: 3, display: "flex", gap: 2 }}>
                        <Button fullWidth variant="outlined" startIcon={<CompareArrowsIcon />} onClick={handleCompare} disabled={loading}>
                            Compare Docs
                        </Button>
                        <Button fullWidth variant="outlined" startIcon={<SchoolIcon />} onClick={handleGenerateFlashcards} disabled={loading}>
                            Flashcards
                        </Button>
                    </Box>
                </Grid>

                {/* Results Section */}
                <Grid item xs={12} md={7}>
                    {comparisonResult && (
                        <Paper sx={{ p: 3, mb: 3, borderRadius: "20px", bgcolor: theme.palette.background.glass }}>
                            <Typography variant="h5" gutterBottom color="primary">Comparison Analysis</Typography>

                            <Typography variant="subtitle1" fontWeight="bold" mt={2}>Similarities</Typography>
                            {comparisonResult.similarities.map((s, i) => (
                                <Typography key={i} variant="body2" sx={{ mb: 1 }}>
                                    • {typeof s === 'object' ? <span><strong>{s.point}</strong>: {s.description}</span> : s}
                                </Typography>
                            ))}

                            <Typography variant="subtitle1" fontWeight="bold" mt={2}>Differences</Typography>
                            {comparisonResult.differences.map((s, i) => (
                                <Typography key={i} variant="body2" sx={{ mb: 1 }}>
                                    • {typeof s === 'object' ? <span><strong>{s.point}</strong>: {s.description}</span> : s}
                                </Typography>
                            ))}

                            <Typography variant="subtitle1" fontWeight="bold" mt={2}>Synthesis</Typography>
                            <Typography variant="body2">{comparisonResult.keyInsights}</Typography>
                        </Paper>
                    )}

                    {flashcards.length > 0 && (
                        <Box>
                            <Typography variant="h5" mb={2}>Flashcards</Typography>
                            <Grid container spacing={2}>
                                {flashcards.map((card, i) => (
                                    <Grid item xs={12} sm={6} key={i}>
                                        <motion.div whileHover={{ scale: 1.02 }}>
                                            <Paper sx={{ p: 3, borderRadius: "16px", bgcolor: theme.palette.background.paper, borderLeft: "4px solid " + theme.palette.secondary.main }}>
                                                <Typography variant="h6" fontSize="1rem" gutterBottom>Q: {card.q}</Typography>
                                                <Typography variant="body2" color="text.secondary">A: {card.a}</Typography>
                                            </Paper>
                                        </motion.div>
                                    </Grid>
                                ))}
                            </Grid>
                        </Box>
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};

export default Studio;
