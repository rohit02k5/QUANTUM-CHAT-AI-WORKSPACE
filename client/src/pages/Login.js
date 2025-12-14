import React, { useState } from 'react';
import {
  Box, Typography, useTheme, TextField, Button, Alert,
  Collapse, FormControlLabel, Checkbox, InputAdornment, IconButton, Divider
} from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import axios from "../axiosConfig"; // CRITICAL FIX: Use configured axios instance
import toast from "react-hot-toast";
import AuthLayout from '../components/AuthLayout';

// Icons
import EmailIcon from '@mui/icons-material/Email';
import LockIcon from '@mui/icons-material/Lock';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import GoogleIcon from '@mui/icons-material/Google';
import GitHubIcon from '@mui/icons-material/GitHub';

const Login = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  // State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Handle OAuth Callback
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && token !== "undefined" && token !== "null") {
      localStorage.setItem("authToken", token); // Default to local for OAuth
      toast.success("Successfully logged in via Social!");
      toast.success("Successfully logged in via Social!");
      navigate("/");
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await axios.post("/api/v1/auth/login", { email, password });

      // CRITICAL FIX: Ensure token actually exists in response
      // This prevents "Login Success" when server returns 200 OK HTML page (SPA issue)
      const authToken = response.data?.token;

      if (!authToken) {
        throw new Error("Invalid response from server");
      }

      if (rememberMe) {
        localStorage.setItem("authToken", authToken);
      } else {
        sessionStorage.setItem("authToken", authToken);
      }

      toast.success("Welcome back!");
      navigate("/");

    } catch (err) {
      console.error(err);
      if (err.response && (err.response.status === 401 || err.response.status === 400)) {
        setError("Invalid email or password");
      } else if (err.response && err.response.data.error) {
        setError(err.response.data.error);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // OAuth Handlers (Direct Links)
  const API_URL = process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production"
    ? "https://quantum-chat-backend.onrender.com"
    : "http://localhost:8080");

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/api/v1/auth/google`;
  };

  const handleGithubLogin = () => {
    window.location.href = `${API_URL}/api/v1/auth/github`;
  };

  return (
    <AuthLayout
      title="Sign In"
      subtitle="Enter your credentials to access your workspace."
    >
      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>{error}</Alert>
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
          sx={{ mb: 2 }}
        />

        <TextField
          label="Password"
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
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            )
          }}
        />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1, mb: 3 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                color="primary"
              />
            }
            label="Remember me"
          />
          <Link to="/forgot-password" style={{ textDecoration: "none", color: theme.palette.primary.main, fontSize: "0.875rem" }}>
            Forgot Password?
          </Link>
        </Box>

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
            boxShadow: "0 4px 14px 0 rgba(14, 165, 233, 0.39)"
          }}
        >
          {loading ? "Signing In..." : "Sign In"}
        </Button>

        <Box sx={{ my: 4, display: "flex", alignItems: "center" }}>
          <Divider sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mx: 2 }}>OR</Typography>
          <Divider sx={{ flex: 1 }} />
        </Box>

        <Box sx={{ display: "flex", gap: 2 }}>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<GoogleIcon />}
            onClick={handleGoogleLogin}
            sx={{ borderRadius: "10px", py: 1, borderColor: theme.palette.divider, color: theme.palette.text.primary }}
          >
            Google
          </Button>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<GitHubIcon />}
            onClick={handleGithubLogin}
            sx={{ borderRadius: "10px", py: 1, borderColor: theme.palette.divider, color: theme.palette.text.primary }}
          >
            GitHub
          </Button>
        </Box>

        <Typography variant="body2" sx={{ mt: 4, textAlign: "center", color: 'text.secondary' }}>
          Don't have an account? {' '}
          <Link to="/register" style={{ textDecoration: "none", color: theme.palette.primary.main, fontWeight: 600 }}>
            Create an account
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
};

export default Login;
