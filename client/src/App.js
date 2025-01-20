import './App.css';
import { Routes, Route } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import SentimentChart from './components/SentimentChart';
import { generateWordFrequency,analyzeSentiment } from './utils/textProcessing';
import WordFrequencyChart from './components/WordFrequencyChart';
import { Toaster } from 'react-hot-toast';
import { ThemeContextProvider } from './context/ThemeContext'; // Adjust path if necessary
import NavBar from './components/NavBar';
import Homepage from './pages/Homepage';
import Register from './pages/Register';
import Login from './pages/Login';
import Summary from './pages/Summary';
import Chatbot from './pages/Chatbot';
import ProtectedRoute from './components/ProtectedRoute';
import { useState } from 'react';
import DataVisualize from './pages/DataVisualize';

// Fix the ResizeObserver loop error warning (if not already patched in browser)
window.addEventListener("error", (e) => {
  if (e.message === "ResizeObserver loop completed with undelivered notifications.") {
    e.stopImmediatePropagation();
  }
});

function App() {
  const [text,setText]=useState("");
  const [wordFrequency,setWordFrequency]=useState([]);
  const [sentiment,setSentiment]=useState(null);
  const handleAnalyze=()=>{
    setWordFrequency(generateWordFrequency(text));
    setSentiment(analyzeSentiment(text));
  };
  return (
    <>
      <ThemeContextProvider>
        <CssBaseline />
        <NavBar />
        <Toaster />
        <Routes>
          <Route path="/" element={<ProtectedRoute> <Homepage /></ProtectedRoute>} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/chatbot" element={<Chatbot />} />
          <Route path="/datavisualizer" element={<DataVisualize />} />
        </Routes>
      </ThemeContextProvider>
    </>
  );
}

export default App;
