import React, { useState, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ColorModeContext } from "../context/ThemeContext"; // Add this import
import Brightness4Icon from "@mui/icons-material/Brightness4"; // Add this import
import Brightness7Icon from "@mui/icons-material/Brightness7";
import axios from "../axiosConfig";

import {
  Box,
  Typography,
  useTheme,
  useMediaQuery,
  TextField,
  Button,
  Alert,
  Collapse,
  Card,
  IconButton,
} from "@mui/material";

const Summary = () => {
  const colorMode = useContext(ColorModeContext);
  const theme = useTheme();
  const navigate = useNavigate();
  const isNotMobile = useMediaQuery("(min-width: 1000px)");

  const [text, settext] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post("/api/v1/openai/summary", { text });
      setSummary(data); // Store the full structured object

      // Store the specific property
    } catch (err) {
      console.log(err);
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.message) {
        setError(err.message);
      }
      setTimeout(() => {
        setError("");
      }, 5000);
    }
  };

  return (
    <Box
      width={isNotMobile ? "40%" : "80%"}
      p={"2rem"}
      m={"2rem auto"}
      borderRadius={5}
      sx={{ boxShadow: 5 }}
      backgroundColor={theme.palette.background.alt}
    >
      <Collapse in={error}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      </Collapse>
      <form onSubmit={handleSubmit}>
        <Typography variant="h3">Summarize Text</Typography>
        <TextField
          placeholder="Add your text"
          type="text"
          multiline={true}
          required
          margin="normal"
          fullWidth
          value={text}
          onChange={(e) => {
            settext(e.target.value);
          }}
        />
        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          sx={{ color: "white", mt: 2 }}
        >
          Submit
        </Button>
        <Typography mt={2}>
          Not this tool? <Link to="/">Go Back</Link>
        </Typography>
      </form>
      {summary && (
        <Box mt={4} display="flex" flexDirection="column" gap={3}>
          {/* Main Summary Card */}
          <Card sx={{ p: 4, borderRadius: "20px", bgcolor: theme.palette.background.alt, borderLeft: "6px solid " + theme.palette.primary.main }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom color="primary">Executive Summary</Typography>
            <Typography variant="body1" lineHeight={1.8}>
              {summary.summary}
            </Typography>
          </Card>

          <Box display="flex" gap={3} flexDirection={isNotMobile ? "row" : "column"}>
            {/* Key Points Card */}
            <Card sx={{ flex: 2, p: 3, borderRadius: "20px", bgcolor: theme.palette.background.paper }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom color="secondary">Key Takeaways</Typography>
              {summary.keyPoints && summary.keyPoints.map((point, i) => (
                <Box key={i} display="flex" alignItems="center" mb={1}>
                  <Box sx={{ minWidth: 8, height: 8, borderRadius: "50%", bgcolor: theme.palette.secondary.main, mr: 2 }} />
                  <Typography variant="body2">{point}</Typography>
                </Box>
              ))}
            </Card>

            {/* Sentiment Card */}
            <Card sx={{ flex: 1, p: 3, borderRadius: "20px", bgcolor: theme.palette.background.paper, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyItems: 'center' }}>
              <Typography variant="h6" fontWeight="bold" gutterBottom>Tone</Typography>
              <Box sx={{
                mt: 2,
                p: 3,
                borderRadius: "50%",
                bgcolor: summary.sentiment === "Positive" ? "success.light" : summary.sentiment === "Negative" ? "error.light" : "info.light",
                color: summary.sentiment === "Positive" ? "success.dark" : summary.sentiment === "Negative" ? "error.dark" : "info.dark",
                fontWeight: "bold"
              }}>
                {summary.sentiment || "Neutral"}
              </Box>
            </Card>
          </Box>
        </Box>
      )}

      {!summary && (
        <Card
          sx={{
            mt: 4,
            border: `1px dashed ${theme.palette.divider}`,
            boxShadow: 0,
            height: "300px",
            borderRadius: 5,
            bgcolor: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Typography variant="h6" color="text.secondary">
            Summary results will appear here...
          </Typography>
        </Card>
      )}
      <IconButton onClick={colorMode.toggleColorMode} sx={{ position: 'absolute', top: 16, right: 16 }}>
        {theme.palette.mode === "dark" ? (<Brightness7Icon />) : (<Brightness4Icon />)}
      </IconButton>
    </Box>
  );
};

export default Summary;
