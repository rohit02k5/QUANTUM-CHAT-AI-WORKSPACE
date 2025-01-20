import React, { useState, useContext } from "react";
import { Box, Typography, useTheme, useMediaQuery, TextField, Button, Alert, Collapse, Card, IconButton } from "@mui/material";
import { Link } from "react-router-dom";
import axios from "../axiosConfig";
import { ColorModeContext } from "../context/ThemeContext"; // Add this import
import Brightness4Icon from "@mui/icons-material/Brightness4"; // Add this import
import Brightness7Icon from "@mui/icons-material/Brightness7"; // Add this import
import toast from "react-hot-toast";

const ChatBot = () => {
  const theme = useTheme();
  const isNotMobile = useMediaQuery("(min-width: 1000px)");
  const colorMode = useContext(ColorModeContext); // Access the ColorModeContext to toggle modes

  // States
  const [text, setText] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");

  // Chat submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post("/api/v1/openai/chatbot", { text });
      setResponse(data.response);
    } catch (err) {
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
      sx={{
        boxShadow: 5,
        backgroundColor: theme.palette.background.alt,
        color: theme.palette.text.primary,
      }}
    >
      <Collapse in={!!error}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      </Collapse>
      <form onSubmit={handleSubmit}>
        <Typography variant="h3">Ask with Chatbot</Typography>

        <TextField
          placeholder="Add your text"
          type="text"
          multiline
          required
          margin="normal"
          fullWidth
          value={text}
          onChange={(e) => setText(e.target.value)}
          sx={{
            backgroundColor: theme.palette.background.default,
            borderRadius: "4px",
          }}
        />

        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          sx={{
            mt: 2,
            color: theme.palette.getContrastText(theme.palette.primary.main),
          }}
        >
          Chat
        </Button>
        <Typography mt={2}>
          Not this tool? <Link to="/">GO BACK</Link>
        </Typography>
      </form>

      {response ? (
        <Card
          sx={{
            mt: 4,
            border: 1,
            boxShadow: 0,
            maxHeight: "500px",
            overflowY: "auto",
            borderRadius: 5,
            borderColor: theme.palette.divider,
            bgcolor: theme.palette.background.default,
          }}
        >
          <Typography p={2}>{response}</Typography>
        </Card>
      ) : (
        <Card
          sx={{
            mt: 4,
            border: 1,
            boxShadow: 0,
            height: "500px",
            borderRadius: 5,
            borderColor: theme.palette.divider,
            bgcolor: theme.palette.background.default,
          }}
        >
          <Typography
            variant="h5"
            color={theme.palette.text.secondary}
            sx={{
              textAlign: "center",
              verticalAlign: "middle",
              lineHeight: "450px",
            }}
          >
            Bot Response
          </Typography>
        </Card>
      )}

      {/* Dark Mode Toggle Button */}
      <IconButton onClick={colorMode.toggleColorMode} sx={{ position: 'absolute', top: 16, right: 16 }}>
        {theme.palette.mode === "dark" ? (
          <Brightness7Icon />
        ) : (
          <Brightness4Icon />
        )}
      </IconButton>
    </Box>
  );
};

export default ChatBot;
