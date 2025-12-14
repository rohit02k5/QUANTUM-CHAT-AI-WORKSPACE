import React, { useState } from 'react';
import {
  Box, Typography, useTheme, TextField, Button, Alert,
  Collapse, InputAdornment, IconButton, Divider
} from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import axios from "../axiosConfig";
import toast from "react-hot-toast";
import AuthLayout from '../components/AuthLayout';

// Icons
import PersonIcon from '@mui/icons-material/Person';
import EmailIcon from '@mui/icons-material/Email';
import LockIcon from '@mui/icons-material/Lock';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import GoogleIcon from '@mui/icons-material/Google';
import GitHubIcon from '@mui/icons-material/GitHub';

const Register = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  // State
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await axios.post("/api/v1/auth/register", { username, email, password });
      toast.success("Account created successfully!");
      navigate("/login");
    } catch (err) {
      console.error(err);
      if (err.response && err.response.data.error) {
        setError(err.response.data.error);
      } else if (err.message) {
        setError(err.message);
      } else {
        setError("Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create Account"
      subtitle="Join the Quantum Intelligence workspace today."
    >
      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 3, borderRadius: "12px" }}>{error}</Alert>
      </Collapse>

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <TextField
          label="Full Name"
          fullWidth
          required
          margin="normal"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <PersonIcon color="action" />
              </InputAdornment>
            ),
          }}
        />

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
            background: "linear-gradient(90deg, #d946ef, #8b5cf6)", // Purple Gradient for Register
            boxShadow: "0 4px 14px 0 rgba(217, 70, 239, 0.39)",
            "&:hover": {
              background: "linear-gradient(90deg, #c026d3, #7c3aed)",
            }
          }}
        >
          {loading ? "Creating Account..." : "Sign Up"}
        </Button>

        <Box sx={{ my: 4, display: "flex", alignItems: "center" }}>
          <Divider sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mx: 2 }}>OR SIGN UP WITH</Typography>
          <Divider sx={{ flex: 1 }} />
        </Box>

        <Box sx={{ display: "flex", gap: 2 }}>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<GoogleIcon />}
            sx={{ borderRadius: "10px", py: 1, borderColor: theme.palette.divider, color: theme.palette.text.primary }}
          >
            Google
          </Button>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<GitHubIcon />}
            sx={{ borderRadius: "10px", py: 1, borderColor: theme.palette.divider, color: theme.palette.text.primary }}
          >
            GitHub
          </Button>
        </Box>

        <Typography variant="body2" sx={{ mt: 4, textAlign: "center", color: 'text.secondary' }}>
          Already have an account? {' '}
          <Link to="/login" style={{ textDecoration: "none", color: theme.palette.secondary.main, fontWeight: 600 }}>
            Log In
          </Link>
        </Typography>
      </Box>
    </AuthLayout>
  );
};

export default Register;
