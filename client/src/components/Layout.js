import React, { useState, useContext } from "react";
import { Box, IconButton, useTheme, Typography, Divider, Tooltip } from "@mui/material";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { ColorModeContext } from "../context/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";

// Icons
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome"; // For Studio/Visualizer
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks"; // For Knowledge Base
import DashboardIcon from "@mui/icons-material/Dashboard"; // For Summary/Dash
import LogoutIcon from "@mui/icons-material/Logout";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import VisibilityIcon from "@mui/icons-material/Visibility";
import AssignmentIcon from "@mui/icons-material/Assignment";

const SidebarItem = ({ icon, label, path, active, collapsed, onClick }) => {
    const theme = useTheme();

    return (
        <Tooltip title={collapsed ? label : ""} placement="right">
            <Box
                onClick={onClick}
                sx={{
                    display: "flex",
                    alignItems: "center",
                    p: "12px 20px",
                    mx: "10px",
                    mb: "5px",
                    borderRadius: "12px",
                    cursor: "pointer",
                    backgroundColor: active ? "transparent" : "transparent",
                    backgroundImage: active ? "linear-gradient(90deg, #0ea5e9 0%, #22d3ee 100%)" : "none",
                    color: active ? "#ffffff" : theme.palette.text.secondary,
                    boxShadow: active ? "0 0 15px rgba(34, 211, 238, 0.4)" : "none",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    "&:hover": {
                        backgroundColor: active ? "transparent" : theme.palette.action.hover,
                        color: active ? "#ffffff" : theme.palette.text.primary,
                        transform: "translateX(5px)",
                    },
                }}
            >
                {React.cloneElement(icon, { sx: { fontSize: "24px", minWidth: "24px" } })}
                {!collapsed && (
                    <Typography
                        sx={{
                            ml: 2,
                            fontWeight: active ? 600 : 400,
                            fontSize: "0.95rem",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {label}
                    </Typography>
                )}
            </Box>
        </Tooltip>
    );
};

const Layout = () => {
    const theme = useTheme();
    const colorMode = useContext(ColorModeContext);
    const navigate = useNavigate();
    const location = useLocation();
    const [collapsed, setCollapsed] = useState(false);

    const handleLogout = () => {
        localStorage.removeItem("authToken");
        navigate("/login");
    };

    const menuItems = [
        { label: "Dashboard", path: "/", icon: <DashboardIcon /> },
        { label: "Neurapix", path: "https://neurapix-frontend-3.onrender.com/", icon: <AutoAwesomeIcon /> },
        { label: "Quantum Chat", path: "/chat", icon: <ChatBubbleOutlineIcon /> },
        { label: "Studio", path: "/studio", icon: <AutoAwesomeIcon /> },
        { label: "Knowledge Base", path: "/knowledge-base", icon: <LibraryBooksIcon /> },
        { label: "Insight Engine", path: "/insight-engine", icon: <VisibilityIcon /> },
        { label: "Exec. Assistant", path: "/executive-assistant", icon: <AssignmentIcon /> },
    ];

    return (
        <Box sx={{ display: "flex", height: "100vh", overflow: "hidden", bgcolor: theme.palette.background.default }}>
            {/* Sidebar */}
            <motion.div
                animate={{ width: collapsed ? "80px" : "260px" }}
                style={{
                    height: "100%",
                    borderRight: `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.mode === "dark" ? "rgba(9, 9, 11, 0.6)" : "rgba(255, 255, 255, 0.7)",
                    backdropFilter: "blur(20px)",
                    display: "flex",
                    flexDirection: "column",
                    zIndex: 10,
                }}
            >
                {/* Logo Area */}
                <Box sx={{ p: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {!collapsed && (
                        <Typography variant="h4" sx={{ fontWeight: "bold", background: "linear-gradient(45deg, #22d3ee, #d946ef)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                            QUANTUM
                        </Typography>
                    )}
                    <IconButton onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? <MenuIcon /> : <MenuOpenIcon />}
                    </IconButton>
                </Box>

                <Divider sx={{ mb: 2 }} />

                {/* Menu Items */}
                <Box sx={{ flexGrow: 1 }}>
                    {menuItems.map((item) => (
                        <SidebarItem
                            key={item.path}
                            icon={item.icon}
                            label={item.label}
                            path={item.path}
                            active={location.pathname === item.path}
                            collapsed={collapsed}
                            onClick={() => {
                                if (item.path.startsWith("http")) {
                                    window.open(item.path, "_blank");
                                } else {
                                    navigate(item.path);
                                }
                            }}
                        />
                    ))}
                </Box>

                {/* Footer Area (User & Theme) */}
                <Box sx={{ p: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", p: 1, borderRadius: "12px", bgcolor: theme.palette.background.default }}>

                        <IconButton onClick={colorMode.toggleColorMode}>
                            {theme.palette.mode === "dark" ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>

                        {!collapsed && (
                            <Tooltip title="Logout">
                                <IconButton onClick={handleLogout} color="error">
                                    <LogoutIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                </Box>
            </motion.div>

            {/* Main Content */}
            <Box sx={{ flexGrow: 1, height: "100%", overflowY: "auto", position: "relative" }}>
                <AnimatePresence mode="wait">
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        style={{ padding: "2rem", minHeight: "100%" }}
                    >
                        <Outlet />
                    </motion.div>
                </AnimatePresence>
            </Box>
        </Box>
    );
};

export default Layout;
