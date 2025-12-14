import React, { useState } from "react";
import { Box, Typography, useTheme, TextField, Button, Alert, Collapse, InputAdornment } from "@mui/material";
import { useNavigate, Link } from "react-router-dom";
import axios from "../axiosConfig";
import toast from "react-hot-toast";
import AuthLayout from "../components/AuthLayout";
import EmailIcon from "@mui/icons-material/Email";

const ForgotPassword = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await axios.post("/api/v1/auth/forgot-password", { email });
            toast.success("Email Sent! Check your inbox.");
            navigate("/login");
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.error || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthLayout
            title="Forgot Password"
            subtitle="Enter your email to reset your password."
        >
            <Collapse in={!!error}>
                <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>
                    {error}
                </Alert>
            </Collapse>

            <Box component="form" onSubmit={handleSubmit} noValidate>
                <TextField
                    label="Email Address"
                    fullWidth
                    required
                    margin="normal"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <EmailIcon color="action" />
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
                    {loading ? "Sending..." : "Send Reset Link"}
                </Button>

                <Button
                    fullWidth
                    variant="text"
                    onClick={() => navigate("/login")}
                    sx={{ mt: 2, borderRadius: "12px" }}
                >
                    Back to Login
                </Button>
            </Box>
        </AuthLayout>
    );
};

export default ForgotPassword;
