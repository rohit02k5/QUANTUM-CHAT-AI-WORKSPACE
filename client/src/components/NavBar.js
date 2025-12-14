import React, { useContext } from "react";
import { Box, Typography, useTheme, IconButton } from "@mui/material";
import { ColorModeContext, ThemeContext } from "../context/ThemeContext";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import { useNavigate, useLocation, Link } from "react-router-dom";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

const NavBar = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const colorMode = useContext(ColorModeContext);
  // Fix: authToken is read as a plain string
  const loggedIn = !!localStorage.getItem("authToken"); // Use Boolean() to safely check presence of authToken
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await axios.post("/api/v1/auth/logout");
      localStorage.removeItem("authToken");
      toast.success("Logout successful");
      navigate("/login");
    } catch (error) {
      toast.error("Logout failed");
      console.error("Logout error:", error);
    }
  };

  return (
    <Box
      width="100%"
      p="1rem 6%"
      sx={{
        background: "linear-gradient(90deg, #6a11cb 0%, #2575fc 100%)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: 3,
        mb: 2,
      }}
    >
      {/* Logo */}
      <Box display="flex" alignItems="center">
        {/*<img
  src="logo.webp"
  alt="Intellecta Logo"
  onClick={() => navigate("/")} // Corrected the onClick handler
  style={{
    height: "120px", // Increased height for better visibility
    width: "auto",
    marginRight: "20px",
    boxShadow: "0px 6px 8px rgba(0, 0, 0, 0.2)", // Enhanced shadow
    borderRadius: "12px", // Slightly more rounded corners
    cursor: "pointer", // Adds a pointer cursor to indicate it's clickable
  }}
/>
*/}
      </Box>

      {/* Heading */}
      <Typography
        variant="h1" // Larger heading size
        fontWeight="bold"
        sx={{
          textAlign: "center",
          flexGrow: 1,
          letterSpacing: "2px", // Adds more prominence
        }}
      >
        QUANTUM CHAT
      </Typography>

      {/* Links and Theme Toggle */}
      <Box display="flex" alignItems="center">
        {loggedIn ? (
          <NavLink
            to="/login"
            onClick={handleLogout}
            style={{
              color: "white",
              variant: "h1",
              textDecoration: "none",
            }}
          >
            Logout
          </NavLink>
        ) : (
          <>
            <NavLink
              to="/register"
              style={{
                color: "white",
                textDecoration: "none",
                marginRight: "15px",
              }}
            >
              Sign Up
            </NavLink>
            <NavLink
              to="/login"
              style={{
                color: "white",
                textDecoration: "none",
                marginRight: "15px",
              }}
            >
              Sign In
            </NavLink>
          </>
        )}

        {(location.pathname === "/login" || location.pathname === "/register") && (
          <IconButton
            onClick={colorMode.toggleColorMode}
            sx={{
              ml: 2,
              color: "white",
            }}
          >
            {theme.palette.mode === "dark" ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
        )}
      </Box>
    </Box>
  );
};

export default NavBar;
