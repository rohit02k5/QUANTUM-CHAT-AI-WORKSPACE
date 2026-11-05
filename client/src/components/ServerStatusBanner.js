import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, Button, LinearProgress } from '@mui/material';
import axios from '../axiosConfig';

/**
 * ServerStatusBanner — cold-start + outage banner (Phase 6.3).
 * Pings the unauthenticated /health on mount. If the first response takes
 * >2.5s (Render free tier waking) or fails, shows a friendly banner with
 * retry. Non-AI pages keep working underneath it.
 */
const WAKE_AFTER_MS = 2500;
const GIVE_UP_MS = 30000;

export default function ServerStatusBanner() {
  const [state, setState] = useState('ok'); // ok | waking | down
  const timerRef = useRef(null);

  const ping = async () => {
    setState('ok');
    timerRef.current = setTimeout(() => setState('waking'), WAKE_AFTER_MS);
    const deadline = setTimeout(() => {
      clearTimeout(timerRef.current);
      setState('down');
    }, GIVE_UP_MS);
    try {
      await axios.get('/health', { timeout: GIVE_UP_MS });
      clearTimeout(timerRef.current);
      clearTimeout(deadline);
      setState('ok');
    } catch {
      clearTimeout(timerRef.current);
      clearTimeout(deadline);
      setState('down');
    }
  };

  useEffect(() => {
    ping();
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'ok') return null;

  return (
    <Box
      role="status"
      sx={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
        bgcolor: state === 'waking' ? '#1e3a5f' : '#7f1d1d',
        color: '#fff', px: 2, py: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
      }}
    >
      <Typography variant="body2">
        {state === 'waking'
          ? 'Waking the server (free tier) — this can take up to a minute…'
          : 'Cannot reach the server right now.'}
      </Typography>
      {state === 'waking' && (
        <LinearProgress sx={{ width: 120, bgcolor: 'rgba(255,255,255,0.3)', '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }} />
      )}
      {state === 'down' && (
        <Button size="small" variant="outlined" sx={{ color: '#fff', borderColor: '#fff' }} onClick={ping}>
          Retry
        </Button>
      )}
    </Box>
  );
}
