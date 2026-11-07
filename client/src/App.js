import './App.css';
import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { CssBaseline, CircularProgress, Box } from '@mui/material';
import { Toaster } from 'react-hot-toast';
import { ThemeContextProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import Register from './pages/Register';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword'; // Added ForgotPassword
import ResetPassword from './pages/ResetPassword'; // Added ResetPassword
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import ErrorBoundary from './components/ErrorBoundary';
import ServerStatusBanner from './components/ServerStatusBanner';

// Authenticated pages are lazy — keeps Plotly/pdfjs/heavy panels out of the
// public landing/login bundle (Phase 6.5).
const Homepage = React.lazy(() => import('./pages/Homepage'));
const Chat = React.lazy(() => import('./pages/Chat'));
const Studio = React.lazy(() => import('./pages/Studio'));
const KnowledgeBase = React.lazy(() => import('./pages/KnowledgeBase'));
const ExecutiveAssistant = React.lazy(() => import('./pages/ExecutiveAssistant'));
const InsightEngine = React.lazy(() => import('./pages/InsightEngine'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Memory = React.lazy(() => import('./pages/Memory'));
const Study = React.lazy(() => import('./pages/Study'));

const LazyFallback = (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
    <CircularProgress />
  </Box>
);

function App() {
  return (
    <>
      <ThemeContextProvider>
        <CssBaseline />
        <Toaster />
        <ServerStatusBanner />
        <ErrorBoundary>
          <Suspense fallback={LazyFallback}>
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
              <Route path='settings' element={<Settings />} />
              <Route path='memory' element={<Memory />} />
              <Route path='study' element={<Study />} />
            </Route>

            <Route path="/welcome" element={<Landing />} />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
      </ThemeContextProvider>
    </>
  );
}

export default App;
