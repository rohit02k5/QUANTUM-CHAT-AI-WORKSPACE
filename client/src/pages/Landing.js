import React, { useEffect, useState } from 'react';
import { Box, Typography, Button, Grid, Paper, Chip, Container } from '@mui/material';
import { Link } from 'react-router-dom';
import axios from '../axiosConfig';
import metrics from '../landingMetrics.json';

const PILLARS = [
    { title: 'Ingest anything', body: 'PDFs, audio meetings, images, CSVs — chunked, embedded, timestamp-aware and resumable on a sleeping free tier.' },
    { title: 'Ask anything', body: 'RAG answers with inline citations you can click — page, timestamp, or audio seek. Memory that personalizes without poisoning.' },
    { title: 'Act on it', body: 'Agent mode with a visible tool trace: search your KB, list documents, run grounded web search — capped, owner-scoped, auditable.' },
    { title: 'Trust layer', body: 'Prompt-injection scanning, guardrails-last prompts, per-user quotas, cascade deletion, and an eval suite that measures quality on every change.' },
];

const FEATURES = [
    'Cited RAG answers', 'Agent mode + tool trace', 'Audio → timestamped minutes',
    'PDF deep analysis', 'CSV ask-your-data charts', 'Long-term memory',
    'Study decks (SM-2)', 'Markdown/CSV/JSON export', 'Public API keys',
    'Multi-provider failover', 'Degraded extractive mode', 'Recorded demo replay',
];

function PipelineDiagram() {
    return (
        <Box component="svg" viewBox="0 0 760 130" sx={{ width: '100%', maxWidth: 820, display: 'block', mx: 'auto' }} role="img" aria-label="Pipeline diagram">
            {[
                { x: 10, label: 'Uploads', sub: 'PDF · audio · CSV' },
                { x: 160, label: 'Chunk + embed', sub: '768-dim vectors' },
                { x: 310, label: 'Retrieval', sub: 'vector ± keyword' },
                { x: 460, label: 'Guard layer', sub: 'injection scan' },
                { x: 610, label: 'LLM router', sub: 'failover + circuit' },
            ].map((n, i) => (
                <g key={n.label}>
                    <rect x={n.x} y={30} width={130} height={56} rx={12} fill="currentColor" opacity={0.09} />
                    <text x={n.x + 65} y={55} textAnchor="middle" fontSize={15} fontWeight={700} fill="currentColor">{n.label}</text>
                    <text x={n.x + 65} y={74} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.7}>{n.sub}</text>
                    {i < 4 && <text x={n.x + 146} y={62} fontSize={18} fill="currentColor" opacity={0.5}>→</text>}
                </g>
            ))}
            <text x={380} y={118} textAnchor="middle" fontSize={12} fill="currentColor" opacity={0.65}>
                every answer carries provider + model + citations
            </text>
        </Box>
    );
}

const Metric = ({ label, value, suffix = '%' }) => (
    <Box sx={{ textAlign: 'center', px: 1 }}>
        <Typography variant="h4" fontWeight={800} color="primary.main">
            {value}{suffix}
        </Typography>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
);

export default function Landing() {
    const [demoEnabled, setDemoEnabled] = useState(false);
    useEffect(() => {
        document.title = 'Quantum — an AI second brain that cites its sources';
        axios.get('/api/v1/auth/demo-status').then((r) => setDemoEnabled(!!r.data?.enabled)).catch(() => {});
    }, []);

    const q = metrics.quality;
    const src = metrics.sources?.answer || {};

    return (
        <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100vh' }}>
            {/* Nav */}
            <Container maxWidth="lg" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 2 }}>
                <Typography variant="h6" fontWeight={800}>Quantum</Typography>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button component={Link} to="/login" variant="outlined" size="small">Sign in</Button>
                    {demoEnabled && <Button component={Link} to="/login?demo=1" variant="contained" size="small">Try the demo</Button>}
                    <Button href="https://github.com/rohit02k5/QUANTUM-CHAT-AI-WORKSPACE" target="_blank" rel="noopener noreferrer" variant="text" size="small">GitHub</Button>
                </Box>
            </Container>

            {/* Hero */}
            <Container maxWidth="md" sx={{ textAlign: 'center', py: { xs: 6, md: 10 } }}>
                <Typography variant="h3" fontWeight={900} sx={{ lineHeight: 1.15 }}>
                    An AI second brain that cites its sources and shows its work
                </Typography>
                <Typography variant="h6" color="text.secondary" sx={{ mt: 2, fontWeight: 400 }}>
                    Upload documents, meetings and data. Ask questions, run agents, study — every answer is grounded in your files, labelled with the model that wrote it, and measurable.
                </Typography>
                <Box sx={{ mt: 4, display: 'flex', gap: 2, justifyContent: 'center' }}>
                    {demoEnabled
                        ? <Button component={Link} to="/login?demo=1" variant="contained" size="large">Try the demo</Button>
                        : <Button component={Link} to="/register" variant="contained" size="large">Get started</Button>}
                    <Button component={Link} to="/login" variant="outlined" size="large">Sign in</Button>
                </Box>
            </Container>

            {/* Pillars */}
            <Container maxWidth="lg" sx={{ pb: 6 }}>
                <Grid container spacing={2}>
                    {PILLARS.map((p) => (
                        <Grid item xs={12} sm={6} md={3} key={p.title}>
                            <Paper sx={{ p: 3, height: '100%', borderRadius: 3 }} elevation={1}>
                                <Typography variant="subtitle1" fontWeight={800} gutterBottom>{p.title}</Typography>
                                <Typography variant="body2" color="text.secondary">{p.body}</Typography>
                            </Paper>
                        </Grid>
                    ))}
                </Grid>
            </Container>

            {/* How it works */}
            <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} gutterBottom>How it works</Typography>
                <PipelineDiagram />
            </Container>

            {/* Feature grid */}
            <Container maxWidth="md" sx={{ py: 4, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                    {FEATURES.map((f) => <Chip key={f} label={f} variant="outlined" />)}
                </Box>
            </Container>

            {/* Quality — real numbers from committed eval reports */}
            <Container maxWidth="lg" sx={{ py: 6 }}>
                <Typography variant="h5" fontWeight={800} textAlign="center" gutterBottom>
                    Quality — measured, not claimed
                </Typography>
                <Grid container spacing={2} justifyContent="center" sx={{ mt: 1 }}>
                    <Grid item xs={6} sm={3}><Metric label="Faithfulness" value={q.faithfulness} /></Grid>
                    <Grid item xs={6} sm={3}><Metric label="Fact coverage" value={q.factCoverage} /></Grid>
                    <Grid item xs={6} sm={3}><Metric label="Citation accuracy (page/timestamp)" value={q.pageCitationAccuracy} /></Grid>
                    <Grid item xs={6} sm={3}><Metric label="Injection-safe answers" value={q.injectionSafety} /></Grid>
                    <Grid item xs={6} sm={3}><Metric label="Retrieval hit@k" value={q.hitAtK} /></Grid>
                    <Grid item xs={6} sm={3}><Metric label="Agent tool-selection" value={q.agent?.toolSelectionAccuracy} /></Grid>
                </Grid>
                <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 2 }}>
                    From {src.file} · run {src.runAt?.slice(0, 10)} · provider {src.provider}/{src.model}
                    {' · '}methodology: evals/golden + scripts/eval.js in the repo
                </Typography>
            </Container>

            {/* Resilience */}
            <Container maxWidth="md" sx={{ py: 4, textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} gutterBottom>Built for free-tier reality</Typography>
                <Typography variant="body1" color="text.secondary">
                    A multi-provider LLM router with per-model circuit breakers, chain failover,
                    capability gating and a dev disk cache. When every provider is down the app
                    degrades to extractive answers with citations instead of an error screen —
                    and a recorded replay demos the product with zero quota.
                </Typography>
            </Container>

            {/* Security */}
            <Container maxWidth="md" sx={{ py: 4, pb: 8, textAlign: 'center' }}>
                <Typography variant="h5" fontWeight={800} gutterBottom>Security model</Typography>
                <Typography variant="body1" color="text.secondary">
                    Owner-scoped everything (enforced by an enumerated route-auth test), private
                    file streaming, prompt-injection defense in depth, hashed single-use API keys,
                    cascade account deletion, and an honest threat model in docs/SECURITY.md.
                </Typography>
                <Box sx={{ mt: 3 }}>
                    <Button component={Link} to="/login" variant="contained">Sign in</Button>
                </Box>
            </Container>
        </Box>
    );
}
