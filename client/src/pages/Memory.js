import React, { useEffect, useState, useMemo } from "react";
import {
    Box, Typography, Paper, Button, IconButton, TextField, Select, MenuItem,
    Dialog, DialogTitle, DialogContent, DialogActions, Switch, Chip, Alert,
    CircularProgress, Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import PsychologyIcon from "@mui/icons-material/Psychology";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

const CATEGORIES = ["preference", "fact", "goal", "project"];

// Long-term memory management — grouped list, inline edit, global toggle,
// forget-all, JSON export. Everything the assistant can remember about you.
const Memory = () => {
    const [data, setData] = useState(null);
    const [editing, setEditing] = useState(null); // {id, text, category}
    const [confirmAll, setConfirmAll] = useState(false);
    const [newText, setNewText] = useState("");
    const [newCat, setNewCat] = useState("preference");
    const [busy, setBusy] = useState(false);

    const load = () =>
        axios.get("/api/v1/memories").then((r) => setData(r.data)).catch(() => setData({ memories: [], total: 0, cap: 200, enabled: true }));
    useEffect(() => { load(); }, []);

    const grouped = useMemo(() => {
        const g = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
        for (const m of data?.memories || []) (g[m.category] = g[m.category] || []).push(m);
        return g;
    }, [data]);

    const toggle = async (enabled) => {
        await axios.patch("/api/v1/me/memory", { enabled });
        setData((d) => ({ ...d, enabled }));
        toast.success(enabled ? "Memory enabled" : "Memory disabled — nothing new will be remembered or injected");
    };

    const save = async () => {
        setBusy(true);
        try {
            await axios.patch(`/api/v1/memories/${editing.id}`, { text: editing.text, category: editing.category });
            setEditing(null); load();
        } catch (e) {
            toast.error(e.response?.data?.message || "Update failed");
        } finally { setBusy(false); }
    };

    const remove = async (id) => {
        await axios.delete(`/api/v1/memories/${id}`); load();
    };

    const add = async () => {
        if (!newText.trim()) return;
        setBusy(true);
        try {
            await axios.post("/api/v1/memories", { text: newText.trim(), category: newCat });
            setNewText(""); load();
        } catch (e) {
            toast.error(e.response?.data?.message || "Couldn't save memory");
        } finally { setBusy(false); }
    };

    const forgetAll = async () => {
        await axios.delete("/api/v1/memories");
        setConfirmAll(false); load();
        toast.success("All memories forgotten");
    };

    if (!data) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;

    return (
        <Box maxWidth={760} mx="auto" mt={4} px={2} pb={6}>
            <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                <PsychologyIcon sx={{ fontSize: 28 }} />
                <Typography variant="h4" fontWeight="bold">Memory</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Quantum remembers durable facts and preferences you state in chat — never
                from your documents — and uses them to personalize replies. Review, edit,
                or delete anything here at any time.
            </Typography>

            <Paper sx={{ p: 2.5, mb: 3, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                    <Typography variant="subtitle1" fontWeight="bold">Memory is {data.enabled ? "on" : "off"}</Typography>
                    <Typography variant="caption" color="text.secondary">
                        {data.total}/{data.cap} memories stored
                    </Typography>
                </Box>
                <Box display="flex" alignItems="center" gap={1}>
                    <Tooltip title="Download all memories as JSON">
                        <IconButton href="/api/v1/memories/export" component="a" size="small"><DownloadIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Switch checked={data.enabled} onChange={(e) => toggle(e.target.checked)} />
                </Box>
            </Paper>

            <Paper sx={{ p: 2.5, mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom>Add a memory manually</Typography>
                <Box display="flex" gap={1}>
                    <TextField
                        size="small" fullWidth placeholder="e.g. I prefer short, bullet-point answers"
                        value={newText} onChange={(e) => setNewText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && add()}
                    />
                    <Select size="small" value={newCat} onChange={(e) => setNewCat(e.target.value)}>
                        {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </Select>
                    <Button variant="contained" onClick={add} disabled={busy || !newText.trim()}>Add</Button>
                </Box>
            </Paper>

            {CATEGORIES.map((cat) => grouped[cat]?.length > 0 && (
                <Box key={cat} mb={3}>
                    <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.1em" }}>
                        {cat} ({grouped[cat].length})
                    </Typography>
                    {grouped[cat].map((m) => (
                        <Paper key={m._id} sx={{ p: 1.5, mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                            {editing?.id === m._id ? (
                                <>
                                    <TextField size="small" fullWidth value={editing.text}
                                        onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                                    <Select size="small" value={editing.category}
                                        onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                                        {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                    </Select>
                                    <IconButton size="small" onClick={save} disabled={busy}><CheckIcon fontSize="small" /></IconButton>
                                    <IconButton size="small" onClick={() => setEditing(null)}><CloseIcon fontSize="small" /></IconButton>
                                </>
                            ) : (
                                <>
                                    <Typography variant="body2" sx={{ flex: 1 }}>{m.text}</Typography>
                                    {m.useCount > 0 && <Chip size="small" label={`used ${m.useCount}×`} variant="outlined" />}
                                    <IconButton size="small" onClick={() => setEditing({ id: m._id, text: m.text, category: m.category })}><EditIcon fontSize="small" /></IconButton>
                                    <IconButton size="small" color="error" onClick={() => remove(m._id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                                </>
                            )}
                        </Paper>
                    ))}
                </Box>
            ))}

            {data.total === 0 && (
                <Alert severity="info">No memories yet. As you chat, Quantum saves durable preferences and facts — you can also add one above.</Alert>
            )}

            {data.total > 0 && (
                <Button variant="outlined" color="error" onClick={() => setConfirmAll(true)} sx={{ mt: 1 }}>
                    Forget everything
                </Button>
            )}

            <Dialog open={confirmAll} onClose={() => setConfirmAll(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Forget all memories?</DialogTitle>
                <DialogContent>
                    <Typography variant="body2">
                        This permanently deletes all {data.total} memories. The assistant will no longer personalize replies from them.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={forgetAll}>Forget all</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Memory;
