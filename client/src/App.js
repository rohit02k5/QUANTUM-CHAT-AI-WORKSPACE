import './App.css';
import { Routes, Route } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { Toaster } from 'react-hot-toast';
import { ThemeContextProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import AuthLayout from './components/AuthLayout'; // Added AuthLayout
import Homepage from './pages/Homepage'; // Dashboard
import Register from './pages/Register';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword'; // Added ForgotPassword
import ResetPassword from './pages/ResetPassword'; // Added ResetPassword
import Chat from './pages/Chat'; // Replaces Chatbot
import Studio from './pages/Studio'; // Import Studio
import KnowledgeBase from './pages/KnowledgeBase';
import ExecutiveAssistant from './pages/ExecutiveAssistant';
import InsightEngine from './pages/InsightEngine';
import ProtectedRoute from './components/ProtectedRoute';

import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <>
      <ThemeContextProvider>
        <CssBaseline />
        <Toaster />
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<Homepage />} />
              <Route path='chat' element={<Chat />} />
              <Route path='knowledge-base' element={<KnowledgeBase />} />
              <Route path='studio' element={<Studio />} />
              <Route path='executive-assistant' element={<ExecutiveAssistant />} />
              <Route path='insight-engine' element={<InsightEngine />} />
            </Route>

            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
          </Routes>
        </ErrorBoundary>
      </ThemeContextProvider>
    </>
  );
}

export default App;
