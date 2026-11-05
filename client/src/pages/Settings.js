import React, { useEffect, useState } from "react";
import {
    Box, Typography, Paper, Button, TextField, Dialog, DialogTitle,
    DialogContent, DialogActions, Alert, CircularProgress, IconButton,
    List, ListItem, ListItemText, Chip,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useNavigate } from "react-router-dom";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

// Settings > API keys — create (shown once), list (prefix only), revoke.
// The plaintext key is never stored server-side; we hold it in state only
// until the user dismisses the shown-once dialog.
const ApiKeysPanel = () => {
    const [keys, setKeys] = useState([]);
    const [name, setName] = useState("");
    const [newKey, setNewKey] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = () => axios.get("/api/v1/keys")
        .then((r) => setKeys(r.data.keys || []))
        .catch(() => toast.error("Could not load API keys"));
    useEffect(() => { load(); }, []);

    const create = async () => {
        setBusy(true);
        try {
            const r = await axios.post("/api/v1/keys", { name: name.trim() || "default" });
            setNewKey(r.data.key);
            setName("");
            load();
        } catch (e) {
            toast.error(e.response?.data?.message || "Could not create key");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (id) => {
        try {
            await axios.delete(`/api/v1/keys/${id}`);
            toast.success("Key revoked");
            load();
        } catch {
            toast.error("Revoke failed");
        }
    };

    const copy = () => {
        navigator.clipboard?.writeText(newKey).then(() => toast.success("Copied"));
    };

    return (
        <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6">API keys</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                Programmatic access to your knowledge base via <code>POST /api/v1/public/chat</code>.
                Keys are shown once and stored only as hashes. Max 5 active keys.
            </Typography>

            <Box display="flex" gap={1} mb={2}>
                <TextField
                    size="small" label="Key name" value={name}
                    onChange={(e) => setName(e.target.value)} sx={{ flexGrow: 1 }}
                />
                <Button variant="contained" onClick={create} disabled={busy || keys.filter((k) => !k.revokedAt).length >= 5}>
                    Create key
                </Button>
            </Box>

            <List dense>
                {keys.map((k) => (
                    <ListItem
                        key={k._id}
                        secondaryAction={!k.revokedAt && (
                            <IconButton edge="end" onClick={() => revoke(k._id)} aria-label="revoke">
                                <DeleteOutlineIcon />
                            </IconButton>
                        )}
                    >
                        <ListItemText
                            primary={<>{k.name} <Chip size="small" label={k.prefix + "…"} sx={{ ml: 1 }} />{k.revokedAt && <Chip size="small" color="error" label="revoked" sx={{ ml: 1 }} />}</>}
                            secondary={`created ${new Date(k.createdAt).toLocaleDateString()}${k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}` : " · never used"}`}
                        />
                    </ListItem>
                ))}
                {!keys.length && <Typography variant="body2" color="text.secondary">No keys yet.</Typography>}
            </List>

            <Paper variant="outlined" sx={{ p: 1.5, mt: 2, bgcolor: "action.hover" }}>
                <Typography variant="caption" component="pre" sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap", m: 0 }}>
{`curl -X POST $API_BASE/api/v1/public/chat \\
  -H "Authorization: Bearer qk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"message":"summarize my notes","topK":5}'`}
                </Typography>
            </Paper>

            <Dialog open={!!newKey} onClose={() => setNewKey(null)} maxWidth="sm" fullWidth>
                <DialogTitle>Your new API key</DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        This is the only time the key is shown — store it somewhere safe.
                    </Alert>
                    <Box display="flex" gap={1} alignItems="center">
                        <TextField fullWidth value={newKey || ""} InputProps={{ readOnly: true }} size="small" />
                        <IconButton onClick={copy} aria-label="copy"><ContentCopyIcon /></IconButton>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button variant="contained" onClick={() => setNewKey(null)}>Done</Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

// Account settings — currently the "danger zone": irreversible account
// deletion with type-appropriate confirmation (password vs OAuth email+token).
const Settings = () => {
    const navigate = useNavigate();
    const [me, setMe] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmEmail, setConfirmEmail] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        axios.get("/api/v1/auth/me")
            .then((r) => setMe(r.data.user))
            .catch(() => setMe({ hasPassword: true })); // safest default
    }, []);

    const handleDelete = async () => {
        setBusy(true);
        setError("");
        try {
            const body = me?.hasPassword
                ? { password }
                : {
                    confirmEmail,
                    confirmToken: (await axios.post("/api/v1/auth/account/delete-token")).data.confirmToken,
                };
            await axios.delete("/api/v1/auth/account", { data: body });
            toast.success("Account deleted");
            ["authToken", "refreshToken"].forEach((k) => {
                localStorage.removeItem(k); sessionStorage.removeItem(k);
            });
            navigate("/login");
        } catch (e) {
            setError(e.response?.data?.message || "Deletion failed — please retry");
        } finally {
            setBusy(false);
        }
    };

    const ready = me?.hasPassword ? password.length >= 6 : confirmEmail.trim() !== "";

    return (
        <Box maxWidth={640} mx="auto" mt={4} px={2}>
            <Typography variant="h4" fontWeight="bold" gutterBottom>Settings</Typography>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6">Account</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {me ? `${me.username || "User"} — ${me.email || ""}` : <CircularProgress size={16} />}
                </Typography>
                {me?.oauth && !me?.hasPassword && (
                    <Typography variant="caption" color="text.secondary">
                        Signed in via OAuth (no password set)
                    </Typography>
                )}
            </Paper>

            <ApiKeysPanel />

            <Paper sx={{ p: 3, border: "1px solid", borderColor: "error.main" }}>
                <Typography variant="h6" color="error">Danger zone</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
                    Permanently delete your account and everything it owns — chats, files,
                    embeddings, flashcards, personas, and usage history. This cannot be undone.
                </Typography>
                <Button variant="outlined" color="error" onClick={() => setOpen(true)}>
                    Delete my account
                </Button>
            </Paper>

            <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Delete account permanently?</DialogTitle>
                <DialogContent>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    {me?.hasPassword ? (
                        <>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                Confirm with your account password.
                            </Typography>
                            <TextField
                                autoFocus type="password" label="Password" fullWidth
                                value={password} onChange={(e) => setPassword(e.target.value)}
                            />
                        </>
                    ) : (
                        <>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                Type your account email to confirm: <b>{me?.email}</b>
                            </Typography>
                            <TextField
                                autoFocus label="Email" fullWidth
                                value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)}
                            />
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                    <Button
                        color="error" variant="contained"
                        disabled={busy || !ready}
                        onClick={handleDelete}
                    >
                        {busy ? "Deleting…" : "Delete everything"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Settings;
