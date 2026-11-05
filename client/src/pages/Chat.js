import React, { useState, useEffect, useRef } from "react";
import { Box, Typography, TextField, IconButton, Paper, Avatar, Tooltip, CircularProgress, Button, Menu, MenuItem, Checkbox, ListItemText, Select, FormControl } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome"; // For Mindmap
import axios from "../axiosConfig";
import { streamChat } from "../utils/streamChat";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import Chip from "@mui/material/Chip";
import Modal from "@mui/material/Modal";
import DownloadIcon from "@mui/icons-material/Download";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import CloseIcon from "@mui/icons-material/Close";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import AudioPlayerModal, { formatTimestamp } from "../components/AudioPlayerModal";

const Mermaid = ({ chart }) => {
    const ref = useRef(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (ref.current) {
            import("mermaid").then((mermaid) => {
                mermaid.default.init(undefined, ref.current);
            });
        }
    }, [chart]);

    const handleDownload = () => {
        if (ref.current) {
            const svg = ref.current.querySelector("svg");
            if (svg) {
                const svgData = new XMLSerializer().serializeToString(svg);
                const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `mindmap-${Date.now()}.svg`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }
    };

    return (
        <Box sx={{ position: "relative", "&:hover .controls": { opacity: 1 } }}>
            <div className="mermaid" ref={ref}>{chart}</div>

            <Box
                className="controls"
                sx={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    opacity: 0,
                    transition: "opacity 0.2s",
                    display: "flex",
                    gap: 1,
                    bgcolor: "rgba(0,0,0,0.5)",
                    borderRadius: "8px",
                    p: 0.5
                }}
            >
                <Tooltip title="Zoom">
                    <IconButton size="small" onClick={() => setOpen(true)} sx={{ color: "white" }}>
                        <ZoomInIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Download SVG">
                    <IconButton size="small" onClick={handleDownload} sx={{ color: "white" }}>
                        <DownloadIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>

            <Modal open={open} onClose={() => setOpen(false)}>
                <Box sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "90vw",
                    height: "90vh",
                    bgcolor: "background.paper",
                    boxShadow: 24,
                    p: 4,
                    overflow: "auto",
                    borderRadius: "16px",
                    display: "flex",
                    flexDirection: "column"
                }}>
                    <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
                        <IconButton onClick={() => setOpen(false)}><CloseIcon /></IconButton>
                    </Box>
                    <Box sx={{ flexGrow: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
                        <div dangerouslySetInnerHTML={{ __html: ref.current?.innerHTML }} />
                    </Box>
                </Box>
            </Modal>
        </Box>
    );
};

// "How I got this answer" — collapsible agent trace timeline
const TraceTimeline = ({ trace }) => {
    const [open, setOpen] = useState(false);
    if (!trace || !trace.length) return null;
    return (
        <Box sx={{ mt: 1 }}>
            <Typography
                variant="caption"
                color="text.secondary"
                onClick={() => setOpen((o) => !o)}
                sx={{ cursor: "pointer", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
                {open ? "▾" : "▸"} How I got this answer ({trace.length} step{trace.length > 1 ? "s" : ""})
            </Typography>
            {open && (
                <Box sx={{ mt: 1, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
                    {trace.map((t, i) => (
                        <Box key={i} sx={{ mb: 1 }}>
                            <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.75, fontWeight: 600 }}>
                                {t.ok === false ? "✗" : "⚙"} {t.tool}
                                {typeof t.ms === "number" && <span style={{ opacity: 0.6 }}>{t.ms}ms</span>}
                            </Typography>
                            {t.argsPreview && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontFamily: "monospace", fontSize: "0.68rem" }}>
                                    {t.argsPreview}
                                </Typography>
                            )}
                            {t.summary && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                    {t.ok === false ? `failed — ${t.summary}` : t.summary}
                                </Typography>
                            )}
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};

const MessageBubble = ({ role, content, sources, truncated, trace, onSeekAudio }) => {
    const theme = useTheme();
    const isUser = role === "user";

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: "1rem",
            }}
        >
            {!isUser && (
                <Avatar
                    sx={{
                        bgcolor: theme.palette.secondary.main,
                        mr: 1,
                        width: 32,
                        height: 32,
                    }}
                >
                    AI
                </Avatar>
            )}
            <Paper
                elevation={isUser ? 0 : 3}
                sx={{
                    p: "10px 15px",
                    maxWidth: "70%",
                    borderRadius: "15px",
                    borderTopRightRadius: isUser ? 0 : "15px",
                    borderTopLeftRadius: !isUser ? 0 : "15px",
                    bgcolor: isUser ? theme.palette.primary.main : theme.palette.background.paper,
                    color: isUser ? "#fff" : theme.palette.text.primary,
                    overflowWrap: "break-word"
                }}
            >
                {isUser ? (
                    <Typography>{content}</Typography>
                ) : (
                    <ReactMarkdown
                        components={{
                            code({ node, inline, className, children, ...props }) {
                                const match = /language-(\w+)/.exec(className || "");
                                if (!inline && match && match[1] === 'mermaid') {
                                    return <Mermaid chart={String(children).replace(/\n$/, "")} />;
                                }
                                return !inline && match ? (
                                    <SyntaxHighlighter
                                        style={atomDark}
                                        language={match[1]}
                                        PreTag="div"
                                        {...props}
                                    >
                                        {String(children).replace(/\n$/, "")}
                                    </SyntaxHighlighter>
                                ) : (
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                );
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                )}
                {truncated && (
                    <Chip size="small" label="partial answer" color="warning" variant="outlined" sx={{ mb: 1 }} />
                )}
                <TraceTimeline trace={trace} />
                {sources && sources.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                            Sources
                        </Typography>
                        {sources.map((s, idx) =>
                            s.uri ? (
                                <Chip
                                    key={idx}
                                    size="small"
                                    component="a"
                                    href={s.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    clickable
                                    label={s.domain || s.title || s.uri}
                                    variant="outlined"
                                    color="info"
                                    sx={{ mr: 0.5, mb: 0.5 }}
                                    title={s.title || s.uri}
                                />
                            ) : (
                                <Chip
                                    key={idx}
                                    size="small"
                                    clickable={s.startSec != null}
                                    onClick={s.startSec != null ? () => onSeekAudio?.(s.fileId, s.startSec) : undefined}
                                    label={`${s.originalName}${s.startSec != null ? ` ${formatTimestamp(s.startSec)}` : s.page ? ` p.${s.page}` : ""} • ${((s.score || 0) * 100).toFixed(1)}%`}
                                    variant="outlined"
                                    color={s.flagged ? "warning" : "default"}
                                    icon={s.flagged ? <ReportProblemIcon sx={{ fontSize: 14 }} /> : s.startSec != null ? <AudiotrackIcon sx={{ fontSize: 14 }} /> : undefined}
                                    sx={{ mr: 0.5, mb: 0.5 }}
                                    title={s.flagged ? "This source contains instruction-like text (treated as data only)" : s.startSec != null ? `Play from ${formatTimestamp(s.startSec)}` : (s.snippet || s.originalName)}
                                />
                            )
                        )}
                    </Box>
                )}
            </Paper>
        </motion.div>
    );
};



// ... MessageBubble component (unchanged)

const Chat = () => {
    const theme = useTheme();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [chatId, setChatId] = useState(null);
    const [chatHistory, setChatHistory] = useState([]); // List of past chats
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [saveToKB, setSaveToKB] = useState(false); // Default: Don't save to KB
    const [useDocuments, setUseDocuments] = useState(true); // Auto-RAG: on by default
    const [documents, setDocuments] = useState([]); // User's indexed KB files
    const [selectedDocIds, setSelectedDocIds] = useState([]); // Empty = search all docs
    const [docMenuAnchor, setDocMenuAnchor] = useState(null);
    // Agent mode + feature flags
    const [features, setFeatures] = useState({ agent: true });
    const [agentMode, setAgentMode] = useState(false);
    const [browseEnabled, setBrowseEnabled] = useState(false);
    // Streaming state
    const [streaming, setStreaming] = useState(false);
    const streamAbortRef = useRef(null);
    const streamAccRef = useRef("");
    const streamFlushScheduled = useRef(false);
    // Personas + chat meta
    const [presets, setPresets] = useState([]);
    const [customPersonas, setCustomPersonas] = useState([]);
    const [activeChat, setActiveChat] = useState(null); // {title,pinned,tags,personaKey,personaId}
    const [tagFilter, setTagFilter] = useState(null);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [audioSeek, setAudioSeek] = useState(null); // {fileId, sec} for the audio player
    const fileInputRef = useRef(null);
    const bottomRef = useRef(null);

    useEffect(() => {
        loadChatHistory();
        loadDocs();
        loadPersonas();
        axios.get("/api/v1/features").then(({ data }) => {
            setFeatures(data);
            if (!data.agent) setAgentMode(false);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const loadDocs = async () => {
        try {
            const { data } = await axios.get("/api/v1/files/list");
            setDocuments((data.files || []).filter((f) => !f.isTemp && (!f.status || f.status === "ready")));
        } catch (error) {
            console.error("Failed to load documents", error);
        }
    };

    const toggleDoc = (id) => {
        setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const loadChatHistory = async () => {
        try {
            const { data } = await axios.get("/api/v1/chat/history");
            setChatHistory(data.chats);
        } catch (error) {
            console.error("Failed to load history", error);
        }
    };

    const loadPersonas = async () => {
        try {
            const { data } = await axios.get("/api/v1/personas");
            setPresets(data.presets || []);
            setCustomPersonas(data.personas || []);
        } catch {
            /* persona list is optional — ignore */
        }
    };

    const loadChatSession = async (id) => {
        setChatId(id);
        setLoading(true);
        try {
            const { data } = await axios.get(`/api/v1/chat/${id}`);
            setMessages(data.chat.messages);
            setActiveChat({
                title: data.chat.title,
                pinned: data.chat.pinned,
                tags: data.chat.tags || [],
                personaKey: data.chat.personaKey,
                personaId: data.chat.personaId,
            });
        } catch (error) {
            toast.error("Failed to load chat");
        } finally {
            setLoading(false);
        }
    };

    const startNewChat = () => {
        streamAbortRef.current?.abort();
        setChatId(null);
        setActiveChat(null);
        setMessages([]);
        setInput("");
    };

    const patchChat = async (fields) => {
        if (!chatId) return;
        try {
            const { data } = await axios.patch(`/api/v1/chat/${chatId}`, fields);
            setActiveChat((prev) => ({
                ...(prev || {}),
                title: data.chat.title,
                pinned: data.chat.pinned,
                tags: data.chat.tags || [],
                personaKey: data.chat.personaKey,
                personaId: data.chat.personaId,
            }));
            loadChatHistory();
        } catch {
            toast.error("Update failed");
        }
    };

    const saveTitle = async () => {
        setEditingTitle(false);
        if (titleDraft.trim() && titleDraft !== activeChat?.title) {
            await patchChat({ title: titleDraft.trim() });
        }
    };

    const togglePin = (chat, e) => {
        e.stopPropagation();
        axios.patch(`/api/v1/chat/${chat._id}`, { pinned: !chat.pinned }).then(loadChatHistory);
    };

    const deleteChat = async (id, e) => {
        e.stopPropagation();
        try {
            await axios.delete(`/api/v1/chat/${id}`);
            setChatHistory(prev => prev.filter(c => c._id !== id));
            if (chatId === id) startNewChat();
            toast.success("Chat deleted");
        } catch (error) {
            toast.error("Delete failed");
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);
        formData.append("saveToKB", saveToKB ? "true" : "false");

        setUploading(true);
        const toastId = toast.loading("Uploading...");
        try {
            const token = localStorage.getItem("authToken");
            const { data } = await axios.post("/api/v1/files/upload", formData, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (data.jobId && !data.indexed && !data.file?.isTemp) {
                // Async ingestion (202): watch the job, don't attach yet
                toast.success("Uploaded — indexing in background", { id: toastId });
                pollIngestion(data.jobId);
            } else {
                setSelectedFile({ id: data.file._id, name: data.file.originalName, temp: !data.indexed });
                toast.success(data.indexed ? "File saved to knowledge base!" : "File attached (this message only)", { id: toastId });
                if (data.indexed) loadDocs();
            }
        } catch (error) {
            console.error(error);
            toast.error("Upload failed", { id: toastId });
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const clearFile = () => setSelectedFile(null);

    // Poll an ingestion job until it finishes, then refresh the doc list
    const pollIngestion = async (jobId) => {
        for (let i = 0; i < 150; i++) {
            try {
                const { data } = await axios.get(`/api/v1/jobs/${jobId}`);
                if (data.job?.status === "done") {
                    toast.success("File indexed and ready");
                    loadDocs();
                    return;
                }
                if (data.job?.status === "failed") {
                    toast.error(`Indexing failed: ${data.job.error || "unknown error"}`);
                    return;
                }
            } catch { /* keep polling */ }
            await new Promise((r) => setTimeout(r, 2000));
        }
    };

    // Fallback: the original non-streaming endpoint (used when the stream
    // fails before delivering any events).
    const sendNonStream = async (body) => {
        const { data } = await axios.post("/api/v1/chat/message", body);
        setMessages((prev) => [...prev, { role: "model", content: data.response, sources: data.sources }]);
        if (!chatId) {
            setChatId(data.chatId);
            loadChatHistory();
        }
    };

    const handleSend = async () => {
        if (!input.trim() && !selectedFile) return;

        const userContent = selectedFile ? `${input}\n[Attached: ${selectedFile.name}]` : input;
        setMessages((prev) => [...prev, { role: "user", content: userContent }]);

        const msgToSend = input;
        const fileToSend = selectedFile?.id;
        setInput("");
        setSelectedFile(null);
        setLoading(true);

        const body = {
            message: msgToSend,
            chatId, // needed by the non-stream fallback path
            fileId: fileToSend,
            useDocuments,
            documentIds: selectedDocIds,
            mode: agentMode ? "agent" : undefined,
            browse: browseEnabled || undefined,
        };

        const controller = new AbortController();
        streamAbortRef.current = controller;
        setStreaming(true);

        let acc = "";
        let sources = null;
        let newChatId = chatId;
        let sawToken = false;
        let streamFailed = false;
        const liveTrace = [];
        streamAccRef.current = "";

        const updateStreamMessage = (extra = {}) => {
            setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = {
                    role: "model",
                    content: acc,
                    sources,
                    trace: liveTrace.length ? [...liveTrace] : undefined,
                    ...extra,
                };
                return copy;
            });
        };

        // Batch token renders: accumulate text, flush once per animation frame
        const scheduleFlush = () => {
            if (streamFlushScheduled.current) return;
            streamFlushScheduled.current = true;
            requestAnimationFrame(() => {
                streamFlushScheduled.current = false;
                updateStreamMessage();
            });
        };

        try {
            const result = await streamChat({
                chatId,
                body,
                signal: controller.signal,
                onEvent: (evt) => {
                    if (evt.type === "meta") {
                        sources = evt.sources || null;
                        newChatId = evt.chatId || newChatId;
                        setMessages((prev) => [...prev, { role: "model", content: "", sources }]);
                        setLoading(false);
                    } else if (evt.type === "token") {
                        sawToken = true;
                        acc += evt.text;
                        streamAccRef.current = acc;
                        scheduleFlush();
                    } else if (evt.type === "tool_call") {
                        const [step, tool] = String(evt.id).split(":");
                        liveTrace.push({ step: Number(step), tool, argsPreview: evt.argsPreview, pending: true });
                        updateStreamMessage();
                    } else if (evt.type === "tool_result") {
                        const entry = liveTrace.find((t) => t.pending);
                        if (entry) {
                            entry.ok = evt.ok; entry.ms = evt.ms; entry.summary = evt.summary; entry.pending = false;
                        }
                        updateStreamMessage();
                    } else if (evt.type === "done") {
                        newChatId = evt.chatId || newChatId;
                        if (evt.sources?.length) sources = evt.sources; // agent tool sources arrive after meta
                    } else if (evt.type === "error") {
                        streamFailed = true;
                    }
                },
            });

            const wasAborted = controller.signal.aborted || result.aborted;

            // Final synchronous flush so no token is lost to a pending rAF
            if (sawToken) {
                updateStreamMessage({ truncated: wasAborted || streamFailed });
            }

            if (!sawToken && (result.refused || streamFailed || !result.ok)) {
                // Stream failed before producing output — fall back silently
                setMessages((prev) => prev.filter((m) => !(m.role === "model" && m.content === "")));
                await sendNonStream(body);
                return;
            }

            if (newChatId && newChatId !== chatId) setChatId(newChatId);
            if (!chatId || streamFailed) loadChatHistory();
        } catch (error) {
            // Unexpected client-side failure — try the non-stream path once
            if (!sawToken) {
                try {
                    await sendNonStream(body);
                    return;
                } catch {
                    /* fall through to toast */
                }
            }
            setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "model") copy[copy.length - 1] = { ...last, truncated: true };
                return copy;
            });
            toast.error("Stream interrupted — partial answer saved");
        } finally {
            setLoading(false);
            setStreaming(false);
            streamAbortRef.current = null;
        }
    };

    const handleStop = () => streamAbortRef.current?.abort();

    const handleKeyPress = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const generateMindmap = async () => {
        if (!chatId) return toast.error("Start a conversation first");
        const toastId = toast.loading("Generating Mindmap...");
        try {
            const { data } = await axios.post("/api/v1/chat/mindmap", { chatId });
            toast.success("Mindmap Generated!", { id: toastId });
            setMessages(prev => [...prev, { role: "model", content: "```mermaid\n" + data.mindmap + "\n```" }])
        } catch (error) {
            toast.error("Mindmap generation failed", { id: toastId });
        }
    }

    return (
        <Box sx={{ height: "100%", display: "flex", gap: 3 }}>
            {/* Sidebar */}
            <Paper sx={{ width: 280, display: { xs: "none", md: "flex" }, flexDirection: "column", p: 2, borderRadius: "16px", bgcolor: theme.palette.background.alt }}>
                <Button variant="contained" fullWidth onClick={startNewChat} sx={{ mb: 2 }}>
                    + New Chat
                </Button>
                <Typography variant="overline" color="text.secondary" sx={{ mb: 1 }}>Recent Chats</Typography>
                {/* Tag filter */}
                {[...new Set(chatHistory.flatMap((c) => c.tags || []))].length > 0 && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
                        {[...new Set(chatHistory.flatMap((c) => c.tags || []))].map((t) => (
                            <Chip
                                key={t}
                                size="small"
                                label={t}
                                variant={tagFilter === t ? "filled" : "outlined"}
                                color={tagFilter === t ? "primary" : "default"}
                                onClick={() => setTagFilter(tagFilter === t ? null : t)}
                            />
                        ))}
                    </Box>
                )}
                <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                    {(() => {
                        const visible = chatHistory.filter((c) => !tagFilter || (c.tags || []).includes(tagFilter));
                        const pinned = visible.filter((c) => c.pinned);
                        const rest = visible.filter((c) => !c.pinned);
                        const renderChat = (chat) => (
                            <Box
                                key={chat._id}
                                onClick={() => loadChatSession(chat._id)}
                                sx={{
                                    p: 1.5,
                                    mb: 1,
                                    borderRadius: "8px",
                                    cursor: "pointer",
                                    bgcolor: chatId === chat._id ? theme.palette.action.selected : "transparent",
                                    "&:hover": { bgcolor: theme.palette.action.hover },
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center"
                                }}
                            >
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" noWrap sx={{ maxWidth: 160 }}>{chat.title}</Typography>
                                    {(chat.tags || []).length > 0 && (
                                        <Typography variant="caption" color="text.secondary" noWrap>
                                            {chat.tags.join(", ")}
                                        </Typography>
                                    )}
                                </Box>
                                <Box sx={{ display: "flex", flexShrink: 0 }}>
                                    <IconButton size="small" onClick={(e) => togglePin(chat, e)}>
                                        {chat.pinned ? <PushPinIcon fontSize="small" color="primary" /> : <PushPinOutlinedIcon fontSize="small" />}
                                    </IconButton>
                                    <IconButton size="small" onClick={(e) => deleteChat(chat._id, e)}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            </Box>
                        );
                        return (
                            <>
                                {pinned.length > 0 && (
                                    <>
                                        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>Pinned</Typography>
                                        {pinned.map(renderChat)}
                                        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>All chats</Typography>
                                    </>
                                )}
                                {rest.map(renderChat)}
                            </>
                        );
                    })()}
                </Box>
            </Paper>

            {/* Main Chat Area */}
            <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", height: "100%" }}>
                {/* Header */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
                    <Typography variant="h4" fontWeight="800" sx={{
                        background: "linear-gradient(90deg, #22d3ee, #d946ef)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        filter: "drop-shadow(0 0 10px rgba(34, 211, 238, 0.3))"
                    }}>
                        Quantum Chat
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {/* Editable chat title (active conversation) */}
                        {chatId && activeChat && (
                            editingTitle ? (
                                <TextField
                                    size="small"
                                    value={titleDraft}
                                    autoFocus
                                    onChange={(e) => setTitleDraft(e.target.value)}
                                    onBlur={saveTitle}
                                    onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                                    sx={{ width: 200 }}
                                />
                            ) : (
                                <Tooltip title="Click to rename">
                                    <Typography
                                        variant="subtitle1"
                                        onClick={() => { setTitleDraft(activeChat.title || ""); setEditingTitle(true); }}
                                        sx={{ cursor: "text", borderBottom: "1px dashed", borderColor: "divider" }}
                                        noWrap
                                    >
                                        {activeChat.title}
                                    </Typography>
                                </Tooltip>
                            )
                        )}
                        {chatId && (
                            <Tooltip title={activeChat?.pinned ? "Unpin" : "Pin chat"}>
                                <IconButton size="small" onClick={() => patchChat({ pinned: !activeChat?.pinned })}>
                                    {activeChat?.pinned ? <PushPinIcon color="primary" /> : <PushPinOutlinedIcon />}
                                </IconButton>
                            </Tooltip>
                        )}
                        <Button
                        variant="outlined"
                        startIcon={<AutoAwesomeIcon />}
                        onClick={generateMindmap}
                        disabled={!chatId || loading}
                        sx={{ borderRadius: "12px", textTransform: "none", borderColor: theme.palette.divider }}
                    >
                        Visualize
                    </Button>
                    </Box>
                </Box>

                {/* Messages Area */}
                <Paper elevation={0} sx={{ flexGrow: 1, mb: 2, p: 2, bgcolor: "transparent", overflowY: "auto", borderRadius: "12px", scrollBehavior: "smooth" }}>
                    <AnimatePresence>
                        {messages.length === 0 && !loading && (
                            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", opacity: 0.5 }}>
                                <Typography variant="h5">Start a new conversation...</Typography>
                            </Box>
                        )}
                        {messages.map((msg, index) => (
                            <MessageBubble key={index} role={msg.role} content={msg.content} sources={msg.sources} truncated={msg.truncated} trace={msg.trace} onSeekAudio={(fileId, sec) => setAudioSeek({ fileId, sec })} />
                        ))}
                        {loading && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <Avatar sx={{ bgcolor: theme.palette.secondary.main, width: 32, height: 32 }}>AI</Avatar>
                                <CircularProgress size={20} />
                                <Typography variant="body2" color="text.secondary">Thinking...</Typography>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div ref={bottomRef} />
                </Paper>

                {/* Input Area */}
                <Box sx={{ mb: 1, px: 2 }}>
                    {selectedFile && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <Chip label={selectedFile.temp ? `${selectedFile.name} (temp)` : selectedFile.name} onDelete={clearFile} color="primary" variant="outlined" sx={{ bgcolor: theme.palette.background.paper }} />
                        </Box>
                    )}
                </Box>
                <Paper component="form" sx={{ p: "2px 4px", display: "flex", alignItems: "center", borderRadius: "24px", bgcolor: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, boxShadow: "0px 4px 20px rgba(0,0,0,0.1)" }}>
                    {/* Mode switch: Chat | Agent (hidden when FEATURE_AGENT=off) */}
                    {features.agent && (
                        <FormControl size="small" sx={{ minWidth: 88, ml: 1 }}>
                            <Select
                                value={agentMode ? "agent" : "chat"}
                                onChange={(e) => setAgentMode(e.target.value === "agent")}
                                variant="standard"
                                disableUnderline
                                sx={{ fontSize: "0.8rem", fontWeight: 600 }}
                            >
                                <MenuItem value="chat">Chat</MenuItem>
                                <MenuItem value="agent">Agent</MenuItem>
                            </Select>
                        </FormControl>
                    )}
                    {/* Browse toggle — agent mode only */}
                    {features.agent && agentMode && (
                        <Tooltip title="Let the agent search the web (capped daily)">
                            <Box sx={{ display: "flex", alignItems: "center", px: 0.5 }}>
                                <input
                                    type="checkbox"
                                    id="browseToggle"
                                    checked={browseEnabled}
                                    onChange={(e) => setBrowseEnabled(e.target.checked)}
                                    style={{ cursor: "pointer" }}
                                />
                                <Typography component="label" htmlFor="browseToggle" variant="caption" sx={{ cursor: "pointer", color: "text.secondary" }}>
                                    Browse
                                </Typography>
                            </Box>
                        </Tooltip>
                    )}
                    {/* Persona picker */}
                    {(presets.length > 0 || customPersonas.length > 0) && (
                        <FormControl size="small" sx={{ minWidth: 110, ml: 1 }}>
                            <Select
                                value={activeChat?.personaKey || activeChat?.personaId || ""}
                                displayEmpty
                                onChange={(e) => chatId && patchChat({ persona: e.target.value || null })}
                                disabled={!chatId}
                                variant="standard"
                                disableUnderline
                                sx={{ fontSize: "0.8rem" }}
                            >
                                <MenuItem value=""><em>Default</em></MenuItem>
                                {presets.map((p) => (
                                    <MenuItem key={p.key} value={p.key}>{p.name}</MenuItem>
                                ))}
                                {customPersonas.map((p) => (
                                    <MenuItem key={p._id} value={p._id}>{p.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    <input type="file" hidden ref={fileInputRef} onChange={handleFileSelect} accept=".pdf,.txt,.docx,.md,.csv,.json" />
                    <IconButton sx={{ p: "10px" }} aria-label="attach" onClick={() => fileInputRef.current.click()} disabled={uploading}>
                        {uploading ? <CircularProgress size={24} /> : <AttachFileIcon />}
                    </IconButton>
                    <Tooltip title="Keep attached files in your knowledge base">
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1 }}>
                            <input
                                type="checkbox"
                                id="saveToKB"
                                checked={saveToKB}
                                onChange={(e) => setSaveToKB(e.target.checked)}
                                style={{ cursor: "pointer" }}
                            />
                            <Typography component="label" htmlFor="saveToKB" variant="caption" sx={{ cursor: "pointer", color: "text.secondary" }}>Save to KB</Typography>
                        </Box>
                    </Tooltip>
                    {documents.length > 0 && (
                        <>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1 }}>
                                <input
                                    type="checkbox"
                                    id="useDocs"
                                    checked={useDocuments}
                                    onChange={(e) => setUseDocuments(e.target.checked)}
                                    style={{ cursor: "pointer" }}
                                />
                                <Typography component="label" htmlFor="useDocs" variant="caption" sx={{ cursor: "pointer", color: "text.secondary" }}>Use my documents</Typography>
                            </Box>
                            <Tooltip title={selectedDocIds.length ? `Searching ${selectedDocIds.length} selected doc(s)` : "Searching all documents — click to choose"}>
                                <IconButton size="small" onClick={(e) => setDocMenuAnchor(e.currentTarget)} disabled={!useDocuments} sx={{ color: selectedDocIds.length ? "primary.main" : "text.secondary" }}>
                                    <DescriptionIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Menu anchorEl={docMenuAnchor} open={Boolean(docMenuAnchor)} onClose={() => setDocMenuAnchor(null)}>
                                <MenuItem onClick={() => setSelectedDocIds([])}>
                                    <Checkbox checked={selectedDocIds.length === 0} size="small" />
                                    <ListItemText primary="All documents" />
                                </MenuItem>
                                {documents.map((d) => (
                                    <MenuItem key={d._id} onClick={() => toggleDoc(d._id)}>
                                        <Checkbox checked={selectedDocIds.includes(d._id)} size="small" />
                                        <ListItemText primary={d.originalName} />
                                    </MenuItem>
                                ))}
                            </Menu>
                        </>
                    )}
                    <TextField
                        sx={{ ml: 1, flex: 1 }}
                        placeholder={uploading ? "Uploading..." : "Ask Quantum AI..."}
                        variant="standard"
                        InputProps={{ disableUnderline: true }}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyPress}
                        disabled={loading}
                        multiline
                        maxRows={4}
                    />
                    {streaming ? (
                        <Tooltip title="Stop generating">
                            <IconButton sx={{ p: "10px", color: theme.palette.error.main }} onClick={handleStop}>
                                <StopIcon />
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <IconButton sx={{ p: "10px", color: theme.palette.primary.main }} onClick={handleSend} disabled={(!input.trim() && !selectedFile) || loading || uploading}>
                            <SendIcon />
                        </IconButton>
                    )}
                </Paper>
            </Box>

            <AudioPlayerModal
                open={!!audioSeek}
                onClose={() => setAudioSeek(null)}
                fileId={audioSeek?.fileId}
                fileName={audioSeek ? "Audio source" : ""}
                seekSec={audioSeek?.sec}
            />
        </Box>
    );
};

export default Chat;
