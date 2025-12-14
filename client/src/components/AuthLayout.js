import React, { useContext } from "react";
import { Box, Typography, useTheme, useMediaQuery, IconButton } from "@mui/material";
import { motion } from "framer-motion";
import { ColorModeContext } from "../context/ThemeContext";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";

const AuthLayout = ({ children, title, subtitle }) => {
    const theme = useTheme();
    const colorMode = useContext(ColorModeContext);
    const isDesktop = useMediaQuery("(min-width:1000px)");

    return (
        <Box sx={{
            height: "100vh",
            width: "100vw",
            display: "flex",
            overflow: "hidden",
            bgcolor: theme.palette.background.default
        }}>
            {/* Left Side - Branding (Desktop Only) */}
            {isDesktop && (
                <Box sx={{
                    flex: 1,
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    p: 8,
                    background: "linear-gradient(135deg, #0f172a 0%, #000000 100%)",
                    overflow: "hidden"
                }}>
                    {/* Animated Background Elements */}
                    <motion.div
                        animate={{
                            rotate: 360,
                            scale: [1, 1.1, 1],
                        }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                        style={{
                            position: "absolute",
                            top: "-20%",
                            right: "-20%",
                            width: "60vw",
                            height: "60vw",
                            borderRadius: "50%",
                            background: "radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, rgba(0,0,0,0) 70%)",
                            zIndex: 1
                        }}
                    />

                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8 }}
                        style={{ zIndex: 2 }}
                    >
                        <Typography variant="h1" fontWeight="900" sx={{
                            background: "linear-gradient(90deg, #22d3ee, #d946ef)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            fontSize: "4rem",
                            mb: 2,
                            letterSpacing: "-0.02em"
                        }}>
                            QUANTUM
                        </Typography>
                        <Typography variant="h2" color="white" fontWeight="300" sx={{ fontSize: "2.5rem", mb: 4, opacity: 0.9 }}>
                            Intelligence Suite
                        </Typography>
                        <Typography variant="body1" color="grey.400" sx={{ maxWidth: 500, fontSize: "1.1rem", lineHeight: 1.8 }}>
                            Experience the next evolution of AI workspace.
                            Seamlessly integrate Chat, Data Analysis, and Creative Tools in one unified platform.
                        </Typography>
                    </motion.div>
                </Box>
            )}

            {/* Right Side - Form */}
            <Box sx={{
                flex: isDesktop ? 0.8 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                background: theme.palette.mode === 'dark'
                    ? "radial-gradient(circle at top right, #1e293b 0%, #0f172a 100%)"
                    : "#F3F4F6",
            }}>
                {/* Theme Toggle Button */}
                <Box sx={{ position: "absolute", top: 20, right: 20, zIndex: 20 }}>
                    <IconButton onClick={colorMode.toggleColorMode}>
                        {theme.palette.mode === "dark" ? (
                            <DarkModeOutlinedIcon sx={{ fontSize: "25px", color: "white" }} />
                        ) : (
                            <LightModeOutlinedIcon sx={{ fontSize: "25px", color: "black" }} />
                        )}
                    </IconButton>
                </Box>

                <Box sx={{ width: "100%", maxWidth: 500, p: 4, zIndex: 10 }}>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <Box mb={4} textAlign={isDesktop ? "left" : "center"}>
                            <Typography variant="h3" fontWeight="bold" gutterBottom color="text.primary">
                                {title}
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                {subtitle}
                            </Typography>
                        </Box>

                        {children}
                    </motion.div>
                </Box>
            </Box>
        </Box>
    );
};

export default AuthLayout;
