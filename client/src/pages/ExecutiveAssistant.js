import React, { useState, useContext, useRef } from "react";
import { Box, Typography, useTheme, TextField, Button, Collapse, Grid, Paper, IconButton, Chip, List, ListItem, ListItemIcon, ListItemText, Card, CardContent, Select, MenuItem, FormControl, InputLabel, CircularProgress } from "@mui/material";
import axios from "../axiosConfig";
import { ColorModeContext } from "../context/ThemeContext";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import toast from "react-hot-toast";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import WarningIcon from "@mui/icons-material/Warning";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DescriptionIcon from "@mui/icons-material/Description";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import GroupsIcon from "@mui/icons-material/Groups";
import DownloadIcon from "@mui/icons-material/Download";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { formatTimestamp } from "../components/AudioPlayerModal";

const ExecutiveAssistant = () => {
    const theme = useTheme();
    const colorMode = useContext(ColorModeContext);
    const fileInputRef = useRef(null);
    const audioRef = useRef(null);

    const [template, setTemplate] = useState("plan"); // "plan" | "meeting"
    const [text, setText] = useState("");
    const [file, setFile] = useState(null);
    const [readyFile, setReadyFile] = useState(null); // {id, name, kind, durationSec}
    const [ingesting, setIngesting] = useState(false);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState(null);
    const [audioUrl, setAudioUrl] = useState(null);

    const pollJob = async (jobId) => {
        for (let i = 0; i < 300; i++) {
            const { data } = await axios.get(`/api/v1/jobs/${jobId}`);
            if (data.job?.status === "done") return data.job;
            if (data.job?.status === "failed") throw new Error(data.job.error || "ingestion failed");
            await new Promise((r) => setTimeout(r, 2000));
        }
        throw new Error("ingestion timed out");
    };

    const handleFileSelect = async (e) => {
        const selected = e.target.files[0];
        if (!selected) return;
        setFile(selected);
        setReadyFile(null);
        setAudioUrl(null);

        const formData = new FormData();
        formData.append("file", selected);
        const isAudio = selected.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|flac)$/i.test(selected.name);
        formData.append("isTemp", isAudio ? "false" : "true");

        const toastId = toast.loading(isAudio ? "Uploading audio..." : "Reading document...");
        try {
            const token = localStorage.getItem("authToken");
            const { data } = await axios.post("/api/v1/files/upload", formData, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (data.jobId) {
                // Async ingestion — wait for the transcript/embedding to finish
                setIngesting(true);
                toast.loading("Transcribing...", { id: toastId });
                await pollJob(data.jobId);
                setIngesting(false);
                const fid = data.fileId || data.file?._id;
                setReadyFile({ id: fid, name: data.file?.originalName || selected.name, kind: data.file?.kind, durationSec: data.file?.durationSec });
                toast.success("Transcript ready", { id: toastId });
                if (isAudio) loadAudio(fid);
            } else {
                setText(data.file.content);
                toast.success("Document read successfully", { id: toastId });
            }
        } catch (err) {
            setIngesting(false);
            toast.error(err.response?.data?.message || err.message || "Failed to read document", { id: toastId });
        }
    };

    // Authenticated audio playback — blob URL, never a public link
    const loadAudio = async (fileId) => {
        try {
            const { data } = await axios.get(`/api/v1/files/${fileId}/view`, { responseType: "blob" });
            setAudioUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(data); });
        } catch { /* audio preview optional */ }
    };

    const seekTo = (sec) => {
        const el = audioRef.current;
        if (el && sec != null) { el.currentTime = sec; el.play().catch(() => {}); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (template === "meeting" && !readyFile && !text.trim()) {
            return toast.error("Upload an audio file or paste a transcript.");
        }
        if (template === "plan" && !text.trim()) {
            return toast.error("Please provide text or upload a document.");
        }

        setLoading(true);
        const toastId = toast.loading(template === "meeting" ? "Generating Meeting Minutes..." : "Generating Action Plan...");
        try {
            const payload = readyFile ? { fileId: readyFile.id } : { text };
            const endpoint = template === "meeting" ? "/api/v1/openai/meeting-minutes" : "/api/v1/openai/action-plan";
            const { data } = await axios.post(endpoint, payload);
            setData({ ...data, __template: template });
            toast.success(template === "meeting" ? "Minutes Generated" : "Plan Generated", { id: toastId });
        } catch (err) {
            toast.error(err.response?.data?.message || "Generation Failed", { id: toastId });
        } finally {
            setLoading(false);
        }
    };

    const secChip = (sec) =>
        sec != null ? (
            <Chip
                size="small"
                icon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
                label={formatTimestamp(sec)}
                variant="outlined"
                color="info"
                clickable={!!audioUrl}
                onClick={() => seekTo(sec)}
                sx={{ ml: 1 }}
            />
        ) : null;

    const exportMarkdown = () => {
        if (!data) return;
        let md = `# ${data.fileName ? `Meeting Minutes — ${data.fileName}` : "Meeting Minutes"}\n\n`;
        md += `## Summary\n${data.summary || ""}\n\n`;
        const list = (title, items, fmt) => {
            if (!items?.length) return;
            md += `## ${title}\n`;
            for (const it of items) md += `- ${fmt(it)}${it.sourceSec != null ? ` (${formatTimestamp(it.sourceSec)})` : ""}\n`;
            md += "\n";
        };
        list("Decisions", data.decisions, (d) => d.text);
        list("Action Items", data.actionItems, (a) => `**${a.owner || "?"}** — ${a.task}${a.due ? ` (due ${a.due})` : ""}`);
        list("Open Questions", data.openQuestions, (q) => q.text);
        list("Risks", data.risks, (r) => r.text);
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `meeting-minutes-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const isMeeting = data?.__template === "meeting";

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
                    <Box mb={2} display="flex" alignItems="center" gap={2} flexWrap="wrap">
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel>Template</InputLabel>
                            <Select value={template} label="Template" onChange={(e) => setTemplate(e.target.value)}>
                                <MenuItem value="plan">Strategic Action Plan</MenuItem>
                                <MenuItem value="meeting">Meeting Minutes</MenuItem>
                            </Select>
                        </FormControl>
                        <Button
                            variant="outlined"
                            startIcon={<AttachFileIcon />}
                            onClick={() => fileInputRef.current.click()}
                        >
                            {template === "meeting" ? "Upload Audio or Document" : "Upload Document (PDF/Docx)"}
                        </Button>
                        <input type="file" hidden ref={fileInputRef} onChange={handleFileSelect} accept={template === "meeting" ? ".pdf,.docx,.txt,.mp3,.m4a,.wav,.ogg,.flac,audio/*" : ".pdf,.docx,.txt"} />
                        {file && <Chip icon={readyFile?.kind === "audio" ? <AudiotrackIcon /> : <DescriptionIcon />} label={file.name} onDelete={() => { setFile(null); setText(""); setReadyFile(null); setAudioUrl(null); }} />}
                        {ingesting && <Chip icon={<CircularProgress size={14} />} label="Transcribing..." color="info" variant="outlined" />}
                    </Box>

                    {audioUrl && (
                        <Box mb={2}>
                            <audio ref={audioRef} controls src={audioUrl} style={{ width: "100%" }} />
                        </Box>
                    )}

                    <TextField
                        fullWidth multiline rows={6}
                        placeholder={template === "meeting" ? "Or paste a transcript here..." : "Or paste text here..."}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        variant="outlined"
                        sx={{ mb: 2 }}
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={loading || ingesting}
                        startIcon={template === "meeting" ? <GroupsIcon /> : <AutoFixHighIcon />}
                        fullWidth
                        sx={{
                            bgcolor: "primary.main",
                            "&:hover": { bgcolor: "primary.dark" },
                            py: 1.5
                        }}
                    >
                        {loading ? (template === "meeting" ? "Writing Minutes..." : "Analyzing Strategy...") : (template === "meeting" ? "Generate Meeting Minutes" : "Generate Action Plan")}
                    </Button>
                </Paper>
            </form>

            <Collapse in={!!data}>
                {data && isMeeting && (
                    <Box>
                        <Box display="flex" justifyContent="flex-end" mb={2}>
                            <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={exportMarkdown}>
                                Export Markdown
                            </Button>
                        </Box>
                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <Card sx={{ p: 2, borderLeft: `6px solid ${theme.palette.primary.main}`, bgcolor: theme.palette.background.alt }}>
                                    <CardContent>
                                        <Typography variant="h5" gutterBottom color="primary" fontWeight="bold">Summary</Typography>
                                        <Typography variant="body1" lineHeight={1.8}>{data.summary}</Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <Paper sx={{ p: 3, height: "100%", borderRadius: "16px" }}>
                                    <Typography variant="h6" display="flex" alignItems="center" gap={1} mb={2} color="secondary.main">
                                        <AssignmentTurnedInIcon /> Decisions
                                    </Typography>
                                    <List>
                                        {(data.decisions || []).map((d, i) => (
                                            <ListItem key={i} disablePadding sx={{ mb: 1, alignItems: "center" }}>
                                                <ListItemIcon sx={{ minWidth: 32 }}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "secondary.main" }} />
                                                </ListItemIcon>
                                                <ListItemText primary={d.text} />
                                                {secChip(d.sourceSec)}
                                            </ListItem>
                                        ))}
                                    </List>
                                    <Typography variant="h6" display="flex" alignItems="center" gap={1} mt={2} mb={2} color="primary.main">
                                        <AssignmentTurnedInIcon /> Action Items
                                    </Typography>
                                    <List>
                                        {(data.actionItems || []).map((a, i) => (
                                            <ListItem key={i} disablePadding sx={{ mb: 1, alignItems: "center" }}>
                                                <ListItemIcon sx={{ minWidth: 32 }}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main" }} />
                                                </ListItemIcon>
                                                <ListItemText
                                                    primary={a.task}
                                                    secondary={`${a.owner || "unassigned"}${a.due ? ` • due ${a.due}` : ""}`}
                                                />
                                                {secChip(a.sourceSec)}
                                            </ListItem>
                                        ))}
                                    </List>
                                </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <Paper sx={{ p: 3, height: "100%", borderRadius: "16px" }}>
                                    <Typography variant="h6" display="flex" alignItems="center" gap={1} mb={2} color="warning.main">
                                        <WarningIcon /> Open Questions
                                    </Typography>
                                    <List>
                                        {(data.openQuestions || []).map((q, i) => (
                                            <ListItem key={i} disablePadding sx={{ mb: 1, alignItems: "center" }}>
                                                <ListItemIcon sx={{ minWidth: 32 }}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main" }} />
                                                </ListItemIcon>
                                                <ListItemText primary={q.text} />
                                                {secChip(q.sourceSec)}
                                            </ListItem>
                                        ))}
                                    </List>
                                    <Typography variant="h6" display="flex" alignItems="center" gap={1} mt={2} mb={2} color="error.main">
                                        <WarningIcon /> Risks
                                    </Typography>
                                    <List>
                                        {(data.risks || []).map((r, i) => (
                                            <ListItem key={i} disablePadding sx={{ mb: 1, alignItems: "center" }}>
                                                <ListItemIcon sx={{ minWidth: 32 }}>
                                                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main" }} />
                                                </ListItemIcon>
                                                <ListItemText primary={r.text} />
                                                {secChip(r.sourceSec)}
                                            </ListItem>
                                        ))}
                                    </List>
                                </Paper>
                            </Grid>
                        </Grid>
                    </Box>
                )}
                {data && !isMeeting && (
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
