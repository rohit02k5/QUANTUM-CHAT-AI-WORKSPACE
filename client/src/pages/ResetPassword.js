import React, { useState } from "react";
import { Box, TextField, Button, Alert, Collapse, InputAdornment, IconButton } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import axios from "../axiosConfig";
import toast from "react-hot-toast";
import AuthLayout from "../components/AuthLayout";
import LockIcon from "@mui/icons-material/Lock";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";

const ResetPassword = () => {
    const navigate = useNavigate();
    const { token } = useParams();
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            setLoading(false);
            return;
        }

        try {
            await axios.post(`/api/v1/auth/reset-password/${token}`, { password });
            toast.success("Password Reset Successfully!");
            navigate("/login");
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || "Invalid or Expired Token");
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title="Reset Password"
            subtitle="Enter your new password below."
        >
            <Collapse in={!!error}>
                <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>
                    {error}
                </Alert>
            </Collapse>

            <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                    label="New Password"
                    type={showPassword ? "text" : "password"}
                    fullWidth
                    required
                    margin="normal"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <LockIcon color="action" />
                            </InputAdornment>
                        ),
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        )
                    }}
                    sx={{ mb: 2 }}
                />

                <TextField
                    label="Confirm Password"
                    type={showPassword ? "text" : "password"}
                    fullWidth
                    required
                    margin="normal"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <LockIcon color="action" />
                            </InputAdornment>
                        ),
                    }}
                    sx={{ mb: 3 }}
                />

                <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    size="large"
                    disabled={loading}
                    sx={{
                        py: 1.5,
                        fontSize: "1rem",
                        borderRadius: "12px",
                        background: "linear-gradient(90deg, #0ea5e9, #2563eb)",
                        boxShadow: "0 4px 14px 0 rgba(14, 165, 233, 0.39)",
                    }}
                >
                    {loading ? "Resetting..." : "Set New Password"}
                </Button>
            </Box>
        </AuthLayout>
    );
};

export default ResetPassword;
