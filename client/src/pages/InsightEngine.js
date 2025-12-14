import React, { useState, useContext } from "react";
import { Box, Typography, useTheme, TextField, Button, Collapse, Grid, Paper, IconButton, Chip } from "@mui/material";
import axios from "../axiosConfig";
import { ColorModeContext } from "../context/ThemeContext";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import Plot from "react-plotly.js";
import toast from "react-hot-toast";
import DownloadIcon from "@mui/icons-material/Download";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";

const InsightEngine = () => {
    const theme = useTheme();
    const colorMode = useContext(ColorModeContext);

    const [text, setText] = useState("");
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);

    const handleAnalyze = async (e) => {
        e.preventDefault();
        if (!text.trim()) return toast.error("Please enter text.");

        setLoading(true);
        const toastId = toast.loading("Igniting analysis engine...");

        try {
            const { data: responseData } = await axios.post("/api/v1/openai/analyze", { text });
            // Assign stable coordinates
            if (responseData.entities) {
                responseData.entities = responseData.entities.map(e => ({
                    ...e,
                    x: Math.random() * 10,
                    y: Math.random() * 10,
                    z: Math.random() * 10
                }));
            }
            // Ensure relationships exists
            if (!responseData.relationships) responseData.relationships = [];

            setData(responseData);
            toast.success("Analysis Complete", { id: toastId });
        } catch (err) {
            console.error(err);
            toast.error("Analysis Failed", { id: toastId });
            toast.error("Analysis Failed", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <Box p={3} sx={{ minHeight: "100vh", bgcolor: theme.palette.background.default }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h3" fontWeight="800" sx={{
                    background: "linear-gradient(45deg, #0ea5e9, #d946ef)",
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    filter: "drop-shadow(0px 2px 4px rgba(0,0,0,0.1))"
                }}>
                    Insight Engine
                </Typography>
                <Box>
                    <IconButton onClick={handlePrint} sx={{ mr: 2 }}><DownloadIcon /></IconButton>
                    <IconButton onClick={colorMode.toggleColorMode}>
                        {theme.palette.mode === "dark" ? <Brightness7Icon /> : <Brightness4Icon />}
                    </IconButton>
                </Box>
            </Box>

            <form onSubmit={handleAnalyze}>
                <Paper sx={{ p: 3, mb: 4, borderRadius: "16px", bgcolor: theme.palette.background.paper }}>
                    <TextField
                        fullWidth multiline rows={6}
                        placeholder="Paste content here to generate entities, knowledge graphs, and sentiment mapping..."
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
                        sx={{
                            bgcolor: "secondary.main",
                            "&:hover": { bgcolor: "secondary.dark" },
                            boxShadow: "0 0 15px rgba(217, 70, 239, 0.5)"
                        }}
                    >
                        {loading ? "Processing..." : "Run Deep Analysis"}
                    </Button>
                </Paper>
            </form>

            <Collapse in={!!data}>
                {data && (
                    <Grid container spacing={4}>
                        {/* Metrics Row */}
                        <Grid item xs={12}>
                            <Grid container spacing={2}>
                                <Grid item xs={12} md={3}>
                                    <Paper sx={{
                                        p: 3,
                                        textAlign: "center",
                                        height: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "center",
                                        background: theme.palette.mode === 'dark' ? "linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)" : "#fff",
                                        backdropFilter: "blur(10px)",
                                        border: `1px solid ${theme.palette.divider}`
                                    }}>
                                        <Typography variant="h6" color="text.secondary" gutterBottom>Readability</Typography>
                                        <Typography variant="h2" fontWeight="800" sx={{ color: "#38bdf8" }}>
                                            {data.seo.readability.score}
                                        </Typography>
                                        <Typography variant="caption" sx={{ mt: 1, opacity: 0.7 }}>{data.seo.readability.level}</Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={12} md={3}>
                                    <Paper sx={{
                                        p: 3,
                                        textAlign: "center",
                                        height: "100%",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "center",
                                        background: theme.palette.mode === 'dark' ? "linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)" : "#fff",
                                        backdropFilter: "blur(10px)",
                                        border: `1px solid ${theme.palette.divider}`
                                    }}>
                                        <Typography variant="h6" color="text.secondary" gutterBottom>Reading Time</Typography>
                                        <Typography variant="h2" fontWeight="800" sx={{ color: "#d946ef" }}>
                                            {data.seo.readability.time}
                                        </Typography>
                                    </Paper>
                                </Grid>
                                <Grid item xs={12} md={6}>
                                    <Paper sx={{ p: 2, borderRadius: "12px", height: "100%" }}>
                                        <Typography variant="h6" mb={1}>Tone Analysis</Typography>
                                        <Chip label={data.seo.tone} color="info" sx={{ fontSize: "1.2rem", py: 2 }} />
                                    </Paper>
                                </Grid>
                            </Grid>
                        </Grid>

                        {/* 3D Knowledge Graph */}
                        <Grid item xs={12} md={8}>
                            <Paper sx={{ p: 2, borderRadius: "16px", height: "500px", overflow: "hidden" }}>
                                <Typography variant="h5" mb={2}>3D Knowledge Graph - Entities</Typography>
                                <Plot
                                    data={[
                                        // Nodes
                                        {
                                            x: data.entities.map(e => e.x || Math.random() * 10),
                                            y: data.entities.map(e => e.y || Math.random() * 10),
                                            z: data.entities.map(e => e.z || Math.random() * 10),
                                            text: data.entities.map(e => `${e.name} (${e.type})`),
                                            mode: 'markers+text',
                                            marker: {
                                                size: data.entities.map(e => e.importance * 5),
                                                color: data.entities.map(e => e.type === "Person" ? '#22d3ee' : e.type === "Org" ? '#d946ef' : '#facc15'),
                                                opacity: 0.9,
                                                line: { color: 'white', width: 0.5 }
                                            },
                                            type: 'scatter3d',
                                            name: 'Entities'
                                        },
                                        // Edges (Relationships)
                                        ...data.relationships.map(rel => {
                                            const source = data.entities.find(e => e.name === rel.source);
                                            const target = data.entities.find(e => e.name === rel.target);
                                            if (!source || !target) return null;
                                            return {
                                                x: [source.x || Math.random() * 10, target.x || Math.random() * 10],
                                                y: [source.y || Math.random() * 10, target.y || Math.random() * 10],
                                                z: [source.z || Math.random() * 10, target.z || Math.random() * 10],
                                                mode: 'lines',
                                                line: {
                                                    color: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                                                    width: 2
                                                },
                                                type: 'scatter3d',
                                                hoverinfo: 'none',
                                                showlegend: false
                                            };
                                        }).filter(Boolean)
                                    ]}
                                    layout={{
                                        autosize: true,
                                        margin: { l: 0, r: 0, b: 0, t: 0 },
                                        paper_bgcolor: 'rgba(0,0,0,0)',
                                        plot_bgcolor: 'rgba(0,0,0,0)',
                                        showlegend: false,
                                        scene: {
                                            xaxis: { visible: false },
                                            yaxis: { visible: false },
                                            zaxis: { visible: false }
                                        }
                                    }}
                                    useResizeHandler={true}
                                    style={{ width: "100%", height: "100%" }}
                                />
                            </Paper>
                        </Grid>

                        {/* Topic Radar */}
                        <Grid item xs={12} md={4}>
                            <Paper sx={{ p: 2, borderRadius: "16px", height: "500px" }}>
                                <Typography variant="h5" mb={2}>Content DNA</Typography>
                                <Plot
                                    data={[{
                                        type: 'scatterpolar',
                                        r: data.topics.map(t => t.score),
                                        theta: data.topics.map(t => t.label),
                                        fill: 'toself',
                                        line: { color: "#d946ef" }
                                    }]}
                                    layout={{
                                        polar: {
                                            radialaxis: { visible: true, range: [0, 100] }
                                        },
                                        margin: { l: 30, r: 30, b: 30, t: 30 },
                                        paper_bgcolor: 'rgba(0,0,0,0)',
                                    }}
                                    useResizeHandler={true}
                                    style={{ width: "100%", height: "100%" }}
                                />
                            </Paper>
                        </Grid>

                        {/* Entities List */}
                        <Grid item xs={12}>
                            <Paper sx={{ p: 3, borderRadius: "16px" }}>
                                <Typography variant="h5" mb={2}>Detected Entities</Typography>
                                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                                    {data.entities.map((e, i) => (
                                        <Chip
                                            key={i}
                                            label={e.name}
                                            color={e.type === "Person" ? "primary" : e.type === "Org" ? "secondary" : "default"}
                                            variant="outlined"
                                        />
                                    ))}
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>
                )}
            </Collapse>
        </Box>
    );
};

export default InsightEngine;
