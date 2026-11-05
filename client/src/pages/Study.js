import React, { useEffect, useState, useCallback } from "react";
import {
    Box, Typography, Paper, Button, IconButton, TextField, Dialog, DialogTitle,
    DialogContent, DialogActions, Chip, LinearProgress, CircularProgress, Grid,
    Tooltip, Divider, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SchoolIcon from "@mui/icons-material/School";
import QuizIcon from "@mui/icons-material/Quiz";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import DownloadIcon from "@mui/icons-material/Download";
import axios from "../axiosConfig";
import toast from "react-hot-toast";

const GRADE_BUTTONS = [
    { grade: 0, label: "Again", key: "1" },
    { grade: 3, label: "Hard", key: "2" },
    { grade: 4, label: "Good", key: "3" },
    { grade: 5, label: "Easy", key: "4" },
];

// Study mode — SM-2 spaced repetition + quizzes. Decks → review session → stats.
const Study = () => {
    const [view, setView] = useState("decks"); // decks | review | quiz | quizResult
    const [decks, setDecks] = useState(null);
    const [stats, setStats] = useState(null);
    const [session, setSession] = useState(null); // {cards, idx, flipped, done, results}
    const [quiz, setQuiz] = useState(null); // {quizId, questions, answers, submitting}
    const [quizResult, setQuizResult] = useState(null);
    const [newDeck, setNewDeck] = useState("");
    const [deckDlg, setDeckDlg] = useState(false);
    const [cardDlg, setCardDlg] = useState(null); // deckId
    const [newCard, setNewCard] = useState({ front: "", back: "" });
    const [quizDlg, setQuizDlg] = useState(null); // deckId

    const load = useCallback(async () => {
        const [d, s] = await Promise.all([
            axios.get("/api/v1/study/decks"),
            axios.get(`/api/v1/study/stats?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`),
        ]);
        setDecks(d.data.decks);
        setStats(s.data);
    }, []);
    useEffect(() => { load().catch(() => setDecks([])); }, [load]);

    const createDeck = async () => {
        if (!newDeck.trim()) return;
        await axios.post("/api/v1/study/decks", { name: newDeck.trim() });
        setNewDeck(""); setDeckDlg(false); load();
    };
    const deleteDeck = async (id) => {
        await axios.delete(`/api/v1/study/decks/${id}`); load();
    };
    const addCard = async () => {
        if (!newCard.front.trim() || !newCard.back.trim()) return;
        await axios.post(`/api/v1/study/decks/${cardDlg}/cards`, newCard);
        setNewCard({ front: "", back: "" }); setCardDlg(null); load();
    };

    // ---- Review session ----
    const startSession = async (deckId) => {
        const { data } = await axios.get(`/api/v1/study/due?deck=${deckId}&limit=50`);
        if (!data.cards.length) return toast.success("Nothing due — all caught up!");
        setSession({ cards: data.cards, idx: 0, flipped: false, results: [] });
        setView("review");
    };
    const grade = async (g) => {
        const card = session.cards[session.idx];
        try {
            await axios.post("/api/v1/study/review", { cardId: card._id, grade: g });
        } catch { toast.error("Review failed — try again"); return; }
        const results = [...session.results, g];
        if (session.idx + 1 >= session.cards.length) {
            setSession({ ...session, results, done: true });
            load();
        } else {
            setSession({ ...session, idx: session.idx + 1, flipped: false, results });
        }
    };

    // ---- Quiz ----
    const startQuiz = async (deckId, count) => {
        try {
            const { data } = await axios.post("/api/v1/study/quiz", { deckId, count });
            setQuiz({ quizId: data.quizId, questions: data.questions, answers: new Array(data.questions.length).fill(null), idx: 0 });
            setQuizDlg(null); setView("quiz");
        } catch (e) {
            toast.error(e.response?.data?.message || "Quiz generation failed");
        }
    };
    const submitQuiz = async () => {
        const { data } = await axios.post(`/api/v1/study/quiz/${quiz.quizId}/submit`, { answers: quiz.answers });
        setQuizResult(data); setView("quizResult");
    };

    // Keyboard shortcuts during review
    useEffect(() => {
        if (view !== "review" || !session || session.done) return;
        const onKey = (e) => {
            if (e.key === " " || e.key === "Enter") { e.preventDefault(); setSession((s) => ({ ...s, flipped: true })); }
            if (session.flipped) {
                const btn = GRADE_BUTTONS.find((b) => b.key === e.key);
                if (btn) grade(btn.grade);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, session?.idx, session?.flipped]);

    if (!decks) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;

    // ---------- Review session view ----------
    if (view === "review" && session) {
        const card = session.cards[session.idx];
        if (session.done) {
            const good = session.results.filter((g) => g >= 3).length;
            return (
                <Box maxWidth={560} mx="auto" mt={8} textAlign="center">
                    <SchoolIcon sx={{ fontSize: 56, color: "success.main" }} />
                    <Typography variant="h4" mt={2}>Session complete</Typography>
                    <Typography variant="body1" color="text.secondary" mt={1}>
                        {session.results.length} cards reviewed — {good} passed ({Math.round(100 * good / session.results.length)}%)
                    </Typography>
                    <Button variant="contained" sx={{ mt: 3 }} onClick={() => { setView("decks"); setSession(null); }}>Back to decks</Button>
                </Box>
            );
        }
        return (
            <Box maxWidth={560} mx="auto" mt={4} px={2}>
                <LinearProgress variant="determinate" value={(100 * session.idx) / session.cards.length} sx={{ mb: 2 }} />
                <Typography variant="caption" color="text.secondary">Card {session.idx + 1} / {session.cards.length}</Typography>
                <Paper
                    onClick={() => setSession((s) => ({ ...s, flipped: true }))}
                    sx={{ p: 5, mt: 1, minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "pointer" }}
                >
                    <Typography variant="h6">{session.flipped ? card.back : card.front}</Typography>
                </Paper>
                {session.flipped ? (
                    <Box display="flex" gap={1} mt={2} justifyContent="center">
                        {GRADE_BUTTONS.map((b) => (
                            <Button key={b.grade} variant="outlined" onClick={() => grade(b.grade)}>
                                {b.label} <Typography variant="caption" sx={{ ml: 0.5, opacity: 0.6 }}>{b.key}</Typography>
                            </Button>
                        ))}
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary" textAlign="center" mt={2}>
                        Click card or press Space to reveal — then grade 1-4
                    </Typography>
                )}
            </Box>
        );
    }

    // ---------- Quiz views ----------
    if (view === "quiz" && quiz) {
        const q = quiz.questions[quiz.idx];
        return (
            <Box maxWidth={640} mx="auto" mt={4} px={2}>
                <LinearProgress variant="determinate" value={(100 * quiz.idx) / quiz.questions.length} sx={{ mb: 2 }} />
                <Typography variant="caption" color="text.secondary">Question {quiz.idx + 1} / {quiz.questions.length}</Typography>
                <Typography variant="h6" mt={1} mb={2}>{q.q}</Typography>
                {q.options.map((opt, i) => (
                    <Paper
                        key={i}
                        onClick={() => setQuiz((z) => { const a = [...z.answers]; a[z.idx] = i; return { ...z, answers: a }; })}
                        sx={{
                            p: 2, mb: 1, cursor: "pointer",
                            border: "1px solid", borderColor: quiz.answers[quiz.idx] === i ? "primary.main" : "divider",
                            bgcolor: quiz.answers[quiz.idx] === i ? "action.selected" : "background.paper",
                        }}
                    >
                        {opt}
                    </Paper>
                ))}
                <Box display="flex" justifyContent="space-between" mt={2}>
                    <Button disabled={quiz.idx === 0} onClick={() => setQuiz((z) => ({ ...z, idx: z.idx - 1 }))}>Back</Button>
                    {quiz.idx + 1 < quiz.questions.length ? (
                        <Button variant="contained" disabled={quiz.answers[quiz.idx] === null} onClick={() => setQuiz((z) => ({ ...z, idx: z.idx + 1 }))}>Next</Button>
                    ) : (
                        <Button variant="contained" disabled={quiz.answers.some((a) => a === null)} onClick={submitQuiz}>Submit</Button>
                    )}
                </Box>
            </Box>
        );
    }
    if (view === "quizResult" && quizResult) {
        return (
            <Box maxWidth={640} mx="auto" mt={4} px={2} pb={6}>
                <Typography variant="h4" textAlign="center">Score: {quizResult.score}/{quizResult.total}</Typography>
                {quizResult.results.map((r, i) => (
                    <Paper key={i} sx={{ p: 2, mt: 2, borderLeft: "3px solid", borderColor: r.correct ? "success.main" : "error.main" }}>
                        <Typography fontWeight="bold">{i + 1}. {r.q}</Typography>
                        <Typography variant="body2" color={r.correct ? "success.main" : "error.main"}>
                            Your answer: {r.chosenIndex != null ? r.options[r.chosenIndex] : "—"}{!r.correct && ` · Correct: ${r.options[r.correctIndex]}`}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" mt={0.5}>{r.explanation}</Typography>
                    </Paper>
                ))}
                <Box textAlign="center" mt={3}>
                    <Button variant="contained" onClick={() => { setView("decks"); setQuiz(null); setQuizResult(null); }}>Done</Button>
                </Box>
            </Box>
        );
    }

    // ---------- Decks view ----------
    const totalDue = decks.reduce((s, d) => s + (d.due || 0), 0);
    return (
        <Box maxWidth={900} mx="auto" mt={4} px={2} pb={6}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
                <Box display="flex" alignItems="center" gap={1.5}>
                    <SchoolIcon sx={{ fontSize: 30 }} />
                    <Typography variant="h4" fontWeight="bold">Study</Typography>
                </Box>
                <Box display="flex" gap={1}>
                    <Tooltip title="Download all cards as CSV (UTF-8, Anki/Excel-safe)">
                        <span><IconButton component="a" href="/api/v1/export/cards.csv" download disabled={!decks.length}><DownloadIcon /></IconButton></span>
                    </Tooltip>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDeckDlg(true)}>New deck</Button>
                </Box>
            </Box>

            {stats && (
                <Grid container spacing={2} mb={3}>
                    <Grid item xs={6} sm={3}>
                        <Paper sx={{ p: 2, textAlign: "center" }}>
                            <Typography variant="h4">{totalDue}</Typography>
                            <Typography variant="caption" color="text.secondary">due now</Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                        <Paper sx={{ p: 2, textAlign: "center" }}>
                            <Typography variant="h4" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                {stats.streak}<LocalFireDepartmentIcon color="warning" fontSize="small" />
                            </Typography>
                            <Typography variant="caption" color="text.secondary" display="block">day streak</Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                        <Paper sx={{ p: 2, textAlign: "center" }}>
                            <Typography variant="h4">{stats.retention == null ? "—" : `${Math.round(stats.retention * 100)}%`}</Typography>
                            <Typography variant="caption" color="text.secondary">30-day retention</Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                        <Paper sx={{ p: 2, textAlign: "center" }}>
                            <Typography variant="h4">{stats.totalCards}</Typography>
                            <Typography variant="caption" color="text.secondary">total cards</Typography>
                        </Paper>
                    </Grid>
                </Grid>
            )}

            {decks.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    No decks yet. Create one, generate cards in Studio and click "Add to deck", or ask the agent to create flashcards.
                </Alert>
            )}

            {decks.map((d) => (
                <Paper key={d._id} sx={{ p: 2, mb: 1.5, display: "flex", alignItems: "center", gap: 2 }}>
                    <Box flex={1}>
                        <Typography variant="subtitle1" fontWeight="bold">{d.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{d.total} cards</Typography>
                    </Box>
                    {d.due > 0 && <Chip size="small" color="primary" label={`${d.due} due`} />}
                    <Button size="small" variant="contained" disabled={!d.due} onClick={() => startSession(d._id)}>Study</Button>
                    <Tooltip title="Generate a quiz from this deck">
                        <span><IconButton size="small" disabled={!d.total} onClick={() => setQuizDlg(d._id)}><QuizIcon fontSize="small" /></IconButton></span>
                    </Tooltip>
                    <Tooltip title="Add card manually">
                        <IconButton size="small" onClick={() => setCardDlg(d._id)}><AddIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <IconButton size="small" color="error" onClick={() => deleteDeck(d._id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </Paper>
            ))}

            <Dialog open={deckDlg} onClose={() => setDeckDlg(false)} maxWidth="xs" fullWidth>
                <DialogTitle>New deck</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth size="small" label="Deck name" sx={{ mt: 1 }}
                        value={newDeck} onChange={(e) => setNewDeck(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && createDeck()} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeckDlg(false)}>Cancel</Button>
                    <Button variant="contained" onClick={createDeck} disabled={!newDeck.trim()}>Create</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={!!cardDlg} onClose={() => setCardDlg(null)} maxWidth="sm" fullWidth>
                <DialogTitle>Add card</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth size="small" label="Front" sx={{ mt: 1 }}
                        value={newCard.front} onChange={(e) => setNewCard({ ...newCard, front: e.target.value })} />
                    <TextField fullWidth size="small" label="Back" multiline rows={3} sx={{ mt: 2 }}
                        value={newCard.back} onChange={(e) => setNewCard({ ...newCard, back: e.target.value })} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCardDlg(null)}>Cancel</Button>
                    <Button variant="contained" onClick={addCard} disabled={!newCard.front.trim() || !newCard.back.trim()}>Add</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={!!quizDlg} onClose={() => setQuizDlg(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Generate quiz</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        AI generates multiple-choice questions from this deck's cards. Grading happens on the server.
                    </Typography>
                    {[3, 5, 10].map((n) => (
                        <Button key={n} variant="outlined" sx={{ mr: 1 }} onClick={() => startQuiz(quizDlg, n)}>{n} questions</Button>
                    ))}
                </DialogContent>
            </Dialog>

            <Divider sx={{ my: 3 }} />
            {stats && stats.forecast.some((f) => f.due > 0) && (
                <>
                    <Typography variant="subtitle2" color="text.secondary" mb={1}>7-day forecast</Typography>
                    <Box display="flex" gap={1}>
                        {stats.forecast.map((f) => (
                            <Paper key={f.day} sx={{ p: 1, flex: 1, textAlign: "center" }}>
                                <Typography variant="caption" display="block">{f.day.slice(5)}</Typography>
                                <Typography variant="body2" fontWeight="bold">{f.due}</Typography>
                            </Paper>
                        ))}
                    </Box>
                </>
            )}
        </Box>
    );
};

export default Study;
