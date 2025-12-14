import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{
          p: 4,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#f8fafc',
          color: '#1e293b'
        }}>
          <Typography variant="h4" fontWeight="bold" gutterBottom color="error">
            Something went wrong.
          </Typography>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {this.state.error && this.state.error.toString()}
          </Typography>
          <Paper sx={{ p: 2, bgcolor: '#e2e8f0', borderRadius: 2, maxWidth: '80%', overflow: 'auto', mb: 4 }}>
            <pre style={{ margin: 0 }}>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </Paper>
          <Button variant="contained" onClick={() => window.location.href = '/'}>
            Go Home
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
