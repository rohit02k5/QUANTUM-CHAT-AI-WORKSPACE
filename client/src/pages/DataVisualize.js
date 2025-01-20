import React, { useState, useContext } from "react";
import { Box, Typography, useTheme, useMediaQuery, TextField, Button, Alert, Collapse, Card, IconButton } from "@mui/material";
import { Link } from "react-router-dom";
import axios from "../axiosConfig";
import { ColorModeContext } from "../context/ThemeContext"; // Add this import
import Brightness4Icon from "@mui/icons-material/Brightness4"; // Add this import
import Brightness7Icon from "@mui/icons-material/Brightness7"; // Add this import
import WordFrequencyChart from "../components/WordFrequencyChart";
import SentimentChart from "../components/SentimentChart";
import { generateWordFrequency, analyzeSentiment, generateKeyTakeawaysForWordFrequency, generateKeyTakeawaysForSentiment } from "../utils/textProcessing";
import toast from "react-hot-toast";
import ErrorBoundary from "../components/ErrorBoundary";
const DataVisualize = () => {
  const theme = useTheme();
  const isNotMobile = useMediaQuery("(min-width: 1000px)");
  const colorMode = useContext(ColorModeContext); // Access the ColorModeContext to toggle modes

  // States
  const [text, setText] = useState("");
  const [error, setError] = useState("");
const [wordFrequency,setWordFrequency]=useState([]);
const [sentiment,setSentiment]=useState({ positive: [], negative: [], neutral: [] });
const [wordFrequencyInsights,setWordFrequencyInsights]=useState({});
const [sentimentInsights,setSentimentInsights]=useState({});  
// Chat submission
  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!text.trim()) {
      setError("Please enter valid text to analyze.");
      return;
  }
    try {
      const wordFrequency = generateWordFrequency(text);
      const sentimentAnalysis=analyzeSentiment(text);

      setWordFrequency(wordFrequency);
      setSentiment(sentimentAnalysis);
      const wordFrequencySumamry= generateKeyTakeawaysForWordFrequency(wordFrequency);
      const sentimentSummary= generateKeyTakeawaysForSentiment(sentimentAnalysis);
      setWordFrequencyInsights(wordFrequencySumamry);
      setSentimentInsights(sentimentSummary);
    } catch (err) {
      setError("An error occurred while analyzing the text. Please try again.");
      setTimeout(() => {
        setError("");
      }, 5000);
    }
    }
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
      <form onSubmit={handleAnalyze}>
        <Typography variant="h3">Text Visualization</Typography>

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
          Analyze Text
        </Button>
        <Typography mt={2}>
          Not this tool? <Link to="/">GO BACK</Link>
        </Typography>
      </form>

{wordFrequency.length > 0 && (
  <Box
    mt={4}
    sx={{
      width: "absolute",
      minHeight: "fit-content", // Ensure the grey box adjusts based on content
      overflow: "visible",
      display: "flex",
      flexDirection: "column", // Stack content vertically
      alignItems: "stretch", // Ensure child elements take full width
    }}
  >
    <Typography variant="h5" mb={2}>
      Word Frequency
    </Typography>
    <Box
      sx={{
        width: "100%",
        height: "fit-content", // Adjust height dynamically based on chart size
        display: "flex",
        justifyContent: "center", // Center the chart horizontally
        alignItems: "center", // Center the chart vertically
      }}
    >
      <WordFrequencyChart wordFrequency={wordFrequency} />
    </Box>
  </Box>
)}

{sentiment && (sentiment.positive.length || sentiment.negative.length || sentiment.neutral.length) > 0 && (
  <Box
    mt={4}
    sx={{
      width: "100%",
      minHeight: "fit-content", // Ensure the grey box adjusts based on content
      overflow: "hidden",
      display: "flex",
      flexDirection: "column", // Stack content vertically
      alignItems: "stretch", // Ensure child elements take full width
    }}
  >
    <Typography variant="h5" mb={2}>
      Sentiment Analysis
    </Typography>
    <Box
      sx={{
        width: "100%",
        height: "fit-content", // Adjust height dynamically based on chart size
        display: "flex",
        justifyContent: "center", // Center the chart horizontally
        alignItems: "center", // Center the chart vertically
      }}
    >
      <ErrorBoundary>
        <SentimentChart sentiment={sentiment} />
      </ErrorBoundary>
    </Box>
  </Box>
)}



{wordFrequencyInsights.insights && (
  <Box mt={4}>
    <Typography variant="h5" mb={2}>Key Takeaways (Word Frequency)</Typography>
    <Typography>{wordFrequencyInsights.insights}</Typography>
  </Box>
)}

{sentimentInsights.insights && (
  <Box mt={4}>
    <Typography variant="h5" mb={2}>Key Takeaways (Sentiment Analysis)</Typography>
    <Typography>{sentimentInsights.insights}</Typography>
    {sentimentInsights.actionPoints.length > 0 && (
      <Typography mt={2}>
        <strong>Action Points:</strong>
        <ul>
          {sentimentInsights.actionPoints.map((point, index) => (
            <li key={index}>{point}</li>
          ))}
        </ul>
      </Typography>
    )}
  </Box>
)}
      <IconButton
        onClick={colorMode.toggleColorMode}
        sx={{ position: "absolute", top: 16, right: 16 }}
      >
         {theme.palette.mode === "dark" ? (
          <Brightness7Icon />
        ) : (
          <Brightness4Icon />
        )}
        </IconButton>
        </Box>
         );
        };
        export default DataVisualize;