import React from 'react';
import { Box, Typography, Grid, Card, CardContent, Button, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

// Icons
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import VisibilityIcon from "@mui/icons-material/Visibility";
import AssignmentIcon from "@mui/icons-material/Assignment";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

const FeatureCard = ({ title, description, icon, onClick, delay, gradient }) => {
  const theme = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay, duration: 0.5 }}
    >
      <Card
        onClick={onClick}
        sx={{
          height: "100%",
          minHeight: 220,
          borderRadius: "24px",
          cursor: "pointer",
          position: "relative",
          overflow: "hidden",
          background: theme.palette.mode === 'dark' ? "rgba(255, 255, 255, 0.03)" : "rgba(255, 255, 255, 0.6)",
          backdropFilter: "blur(20px)",
          border: `1px solid ${theme.palette.divider}`,
          transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          "&:hover": {
            transform: "translateY(-8px)",
            boxShadow: `0 15px 30px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)'}`,
            borderColor: "rgba(255, 255, 255, 0.2)",
            "& .icon-box": {
              transform: "scale(1.1) rotate(5deg)",
              background: gradient
            }
          }
        }}
      >
        <CardContent sx={{ p: 4, display: "flex", flexDirection: "column", height: "100%" }}>
          <Box
            className="icon-box"
            sx={{
              width: 60,
              height: 60,
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mb: 3,
              background: theme.palette.mode === 'dark' ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
              transition: "all 0.4s ease",
              color: theme.palette.mode === 'dark' ? "#fff" : "#333"
            }}
          >
            {React.cloneElement(icon, { sx: { fontSize: 30 } })}
          </Box>
          <Typography variant="h5" fontWeight="bold" gutterBottom>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flexGrow: 1 }}>
            {description}
          </Typography>

          <Typography variant="button" fontWeight="bold" sx={{
            opacity: 0.6,
            display: "flex",
            alignItems: "center",
            gap: 1,
            fontSize: "0.75rem",
            letterSpacing: "0.1em"
          }}>
            LAUNCH <RocketLaunchIcon sx={{ fontSize: 14 }} />
          </Typography>
        </CardContent>
      </Card>
    </motion.div>
  );
};

const Homepage = () => {
  const navigate = useNavigate();
  const theme = useTheme();

  const features = [
    {
      title: "Neurapix",
      description: "Advanced AI Image Generation from text prompts.",
      icon: <AutoAwesomeIcon />,
      path: "https://neurapix-frontend-3.onrender.com/",
      gradient: "linear-gradient(135deg, #FF0080 0%, #7928CA 100%)" // Pink to Purple
    },
    {
      title: "Quantum Chat",
      description: "Intelligent conversational AI with context retention.",
      icon: <ChatBubbleOutlineIcon />,
      path: "/chat",
      gradient: "linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)" // Cyan to Blue
    },
    {
      title: "Insight Engine",
      description: "3D Visualizations, SEO Analytics & Knowledge Graphs.",
      icon: <VisibilityIcon />,
      path: "/insight-engine",
      gradient: "linear-gradient(135deg, #F59E0B 0%, #D946EF 100%)" // Orange to Pink
    },
    {
      title: "Exec. Assistant",
      description: "Strategic planning, action items & executive summaries.",
      icon: <AssignmentIcon />,
      path: "/executive-assistant",
      gradient: "linear-gradient(135deg, #10B981 0%, #3B82F6 100%)" // Green to Blue
    },
    {
      title: "Quantum Studio",
      description: "Document analysis, comparisons & creative tools.",
      icon: <AutoAwesomeIcon />,
      path: "/studio",
      gradient: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" // Indigo to Violet
    },
    {
      title: "Knowledge Base",
      description: "Vector-search powered asset management system.",
      icon: <LibraryBooksIcon />,
      path: "/knowledge-base",
      gradient: "linear-gradient(135deg, #EC4899 0%, #EF4444 100%)" // Pink to Red
    },
  ];

  const handleNavigate = (path) => {
    if (path.startsWith("http")) {
      window.open(path, "_blank");
    } else {
      navigate(path);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto", pt: 4 }}>
      {/* Hero Section */}
      <Box sx={{ textAlign: "center", mb: 8 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
        >
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: "3rem", md: "5rem" },
              fontWeight: 900,
              mb: 2,
              background: "linear-gradient(to right, #fff, #94a3b8)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: theme.palette.mode === 'dark' ? "transparent" : "#111827",
              textShadow: theme.palette.mode === 'dark' ? "0 0 40px rgba(255,255,255,0.2)" : "none"
            }}
          >
            QUANTUM
          </Typography>
          <Typography
            variant="h2"
            sx={{
              fontSize: { xs: "1.5rem", md: "2.5rem" },
              fontWeight: 300,
              mb: 4,
              background: "linear-gradient(90deg, #22d3ee, #d946ef)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "0.2em"
            }}
          >
            YOUR AI WORKSPACE
          </Typography>
        </motion.div>
      </Box>

      {/* Feature Grid */}
      <Grid container spacing={4}>
        {features.map((feature, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <FeatureCard
              {...feature}
              onClick={() => handleNavigate(feature.path)}
              delay={index * 0.1}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Homepage;
