import React, { useState, useContext, useRef } from "react";
import { Box, Typography, useTheme, TextField, Button, Collapse, Grid, Paper, IconButton, Chip, List, ListItem, ListItemIcon, ListItemText, Card, CardContent } from "@mui/material";
import axios from "../axiosConfig";
import { ColorModeContext } from "../context/ThemeContext";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import toast from "react-hot-toast";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import WarningIcon from "@mui/icons-material/Warning";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DescriptionIcon from "@mui/icons-material/Description";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";

const ExecutiveAssistant = () => {
    const theme = useTheme();
    const colorMode = useContext(ColorModeContext);
    const fileInputRef = useRef(null);

    const [text, setText] = useState("");
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);

    const handleFileSelect = async (e) => {
        const selected = e.target.files[0];
        if (selected) {
            setFile(selected);
            // In a real app, we might extract text here or upload it to a temp endpoint to get text back.
            // For this demo, since we want to analyze it, let's assume we send the file content to the "analyze" endpoint 
            // OR we upload it to /files/upload (temp) then ask to analyze that file ID.
            // Simplified: We'll stick to text for now or implement text extraction on backend if I had time to change backend to accept multipart.
            // Strategy: Upload to /api/v1/files/upload with isTemp=true, then use the returned content if available (our backend extracts it!).

            const formData = new FormData();
            formData.append("file", selected);
            formData.append("isTemp", "true");

            const toastId = toast.loading("Reading document...");
            try {
                const token = localStorage.getItem("authToken");
                const { data } = await axios.post("/api/v1/files/upload", formData, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                // Auto-fill text with extracted content for review
                setText(data.file.content);
                toast.success("Document read successfully", { id: toastId });
            } catch (err) {
                toast.error("Failed to read document", { id: toastId });
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!text.trim()) return toast.error("Please provide text or upload a document.");

        setLoading(true);
        const toastId = toast.loading("Generating Action Plan...");

        try {
            const { data } = await axios.post("/api/v1/openai/action-plan", { text });
            setData(data);
            toast.success("Plan Generated", { id: toastId });
        } catch (err) {
            toast.error("Generation Failed", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box p={3} sx={{ minHeight: "100vh", bgcolor: theme.palette.background.default }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h3" fontWeight="bold" sx={{ background: "linear-gradient(90deg, #38bdf8, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    Executive Assistant
                </Typography>
                <IconButton onClick={colorMode.toggleColorMode}>
                    {theme.palette.mode === "dark" ? <Brightness7Icon /> : <Brightness4Icon />}
                </IconButton>
            </Box>

            <form onSubmit={handleSubmit}>
                <Paper sx={{ p: 3, mb: 4, borderRadius: "16px", bgcolor: theme.palette.background.paper }}>
                    <Box mb={2} display="flex" alignItems="center" gap={2}>
                        <Button
                            variant="outlined"
                            startIcon={<AttachFileIcon />}
                            onClick={() => fileInputRef.current.click()}
                        >
                            Upload Document (PDF/Docx)
                        </Button>
                        <input type="file" hidden ref={fileInputRef} onChange={handleFileSelect} accept=".pdf,.docx,.txt" />
                        {file && <Chip icon={<DescriptionIcon />} label={file.name} onDelete={() => { setFile(null); setText(""); }} />}
                    </Box>

                    <TextField
                        fullWidth multiline rows={6}
                        placeholder="Or paste text here..."
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        variant="outlined"
                        sx={{ mb: 2 }}
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={loading}
                        startIcon={<AutoFixHighIcon />}
                        fullWidth
                        sx={{
                            bgcolor: "primary.main",
                            "&:hover": { bgcolor: "primary.dark" },
                            py: 1.5
                        }}
                    >
                        {loading ? "Analyzing Strategy..." : "Generate Action Plan"}
                    </Button>
                </Paper>
            </form>

            <Collapse in={!!data}>
                {data && (
                    <Grid container spacing={3}>
                        {/* Executive Summary */}
                        <Grid item xs={12}>
                            <Card sx={{ p: 2, borderLeft: `6px solid ${theme.palette.primary.main}`, bgcolor: theme.palette.background.alt }}>
                                <CardContent>
                                    <Typography variant="h5" gutterBottom color="primary" fontWeight="bold">Executive Summary</Typography>
                                    <Typography variant="body1" lineHeight={1.8}>{data.executiveSummary}</Typography>
                                </CardContent>
                            </Card>
                        </Grid>

                        {/* Action Items */}
                        <Grid item xs={12} md={6}>
                            <Paper sx={{ p: 3, height: "100%", borderRadius: "16px" }}>
                                <Typography variant="h6" display="flex" alignItems="center" gap={1} mb={2} color="secondary.main">
                                    <AssignmentTurnedInIcon /> Action Items
                                </Typography>
                                <List>
                                    {data.actionItems.map((item, i) => (
                                        <ListItem key={i} disablePadding sx={{ mb: 1 }}>
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "secondary.main" }} />
                                            </ListItemIcon>
                                            <ListItemText primary={item} />
                                        </ListItem>
                                    ))}
                                </List>
                            </Paper>
                        </Grid>

                        {/* Strategic Gaps & Risks */}
                        <Grid item xs={12} md={6}>
                            <Paper sx={{ p: 3, height: "100%", borderRadius: "16px" }}>
                                <Typography variant="h6" display="flex" alignItems="center" gap={1} mb={2} color="error.main">
                                    <WarningIcon /> Strategic Gaps & Risks
                                </Typography>
                                <Typography variant="subtitle2" color="text.secondary" mt={2}>MISSING ELEMENTS</Typography>
                                <List>
                                    {data.strategicGaps.map((item, i) => (
                                        <ListItem key={i} disablePadding sx={{ mb: 1 }}>
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main" }} />
                                            </ListItemIcon>
                                            <ListItemText primary={item} />
                                        </ListItem>
                                    ))}
                                </List>
                                <Typography variant="subtitle2" color="text.secondary" mt={2}>KEY RISKS</Typography>
                                <List>
                                    {data.keyRisks.map((item, i) => (
                                        <ListItem key={i} disablePadding sx={{ mb: 1 }}>
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main" }} />
                                            </ListItemIcon>
                                            <ListItemText primary={item} />
                                        </ListItem>
                                    ))}
                                </List>
                            </Paper>
                        </Grid>
                    </Grid>
                )}
            </Collapse>
        </Box>
    );
};

export default ExecutiveAssistant;
