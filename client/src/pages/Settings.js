import React, { useEffect, useState } from "react";
import {
    Box, Typography, Paper, Button, TextField, Dialog, DialogTitle,
    DialogContent, DialogActions, Alert, CircularProgress,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

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
