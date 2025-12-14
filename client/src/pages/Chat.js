import React, { useState, useEffect, useRef } from "react";
import { Box, Typography, TextField, IconButton, Paper, Avatar, Tooltip, CircularProgress, Button } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome"; // For Mindmap
import contentCopyIcon from "@mui/icons-material/ContentCopy";
import axios from "../axiosConfig";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import DeleteIcon from "@mui/icons-material/Delete";
import Chip from "@mui/material/Chip";
import Modal from "@mui/material/Modal";
import DownloadIcon from "@mui/icons-material/Download";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import CloseIcon from "@mui/icons-material/Close";

const Mermaid = ({ chart }) => {
    const ref = useRef(null);
    const [open, setOpen] = useState(false);
    const theme = useTheme();

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

const MessageBubble = ({ role, content }) => {
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
    const fileInputRef = useRef(null);
    const bottomRef = useRef(null);

    useEffect(() => {
        loadChatHistory();
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const loadChatHistory = async () => {
        try {
            const { data } = await axios.get("/api/v1/chat/history");
            setChatHistory(data.chats);
        } catch (error) {
            console.error("Failed to load history", error);
        }
    };

    const loadChatSession = async (id) => {
        setChatId(id);
        setLoading(true);
        try {
            const { data } = await axios.get(`/api/v1/chat/${id}`);
            setMessages(data.chat.messages);
        } catch (error) {
            toast.error("Failed to load chat");
        } finally {
            setLoading(false);
        }
    };

    const startNewChat = () => {
        setChatId(null);
        setMessages([]);
        setInput("");
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

        setUploading(true);
        const toastId = toast.loading("Uploading...");
        try {
            const token = localStorage.getItem("authToken");
            const { data } = await axios.post("/api/v1/files/upload", formData, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            setSelectedFile({ id: data.file._id, name: data.file.originalName });
            toast.success("File attached!", { id: toastId });
        } catch (error) {
            console.error(error);
            toast.error("Upload failed", { id: toastId });
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const clearFile = () => setSelectedFile(null);

    const handleSend = async () => {
        if (!input.trim() && !selectedFile) return;

        const userContent = selectedFile ? `${input}\n[Attached: ${selectedFile.name}]` : input;
        const userMessage = { role: "user", content: userContent };

        setMessages((prev) => [...prev, userMessage]);

        const msgToSend = input;
        const fileToSend = selectedFile?.id;
        setInput("");
        setSelectedFile(null);
        setLoading(true);

        try {
            const { data } = await axios.post("/api/v1/chat/message", {
                message: msgToSend,
                chatId,
                fileId: fileToSend,
            });

            setMessages((prev) => [...prev, { role: "model", content: data.response }]);

            // If it was a new chat, update ID and reload history to show it in sidebar
            if (!chatId) {
                setChatId(data.chatId);
                loadChatHistory();
            }
        } catch (error) {
            toast.error("Failed to send message");
        } finally {
            setLoading(false);
        }
    };

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
                <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                    {chatHistory.map((chat) => (
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
                            <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>{chat.title}</Typography>
                            <IconButton size="small" onClick={(e) => deleteChat(chat._id, e)}>
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    ))}
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

                {/* Messages Area */}
                <Paper elevation={0} sx={{ flexGrow: 1, mb: 2, p: 2, bgcolor: "transparent", overflowY: "auto", borderRadius: "12px", scrollBehavior: "smooth" }}>
                    <AnimatePresence>
                        {messages.length === 0 && !loading && (
                            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", opacity: 0.5 }}>
                                <Typography variant="h5">Start a new conversation...</Typography>
                            </Box>
                        )}
                        {messages.map((msg, index) => (
                            <MessageBubble key={index} role={msg.role} content={msg.content} />
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
                            <Chip label={selectedFile.name} onDelete={clearFile} color="primary" variant="outlined" sx={{ bgcolor: theme.palette.background.paper }} />
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                <input
                                    type="checkbox"
                                    id="saveToKB"
                                    checked={saveToKB}
                                    onChange={(e) => setSaveToKB(e.target.checked)}
                                    style={{ cursor: "pointer" }}
                                />
                                <Typography component="label" htmlFor="saveToKB" variant="caption" sx={{ cursor: "pointer", color: "text.secondary" }}>Save to KB</Typography>
                            </Box>
                        </Box>
                    )}
                </Box>
                <Paper component="form" sx={{ p: "2px 4px", display: "flex", alignItems: "center", borderRadius: "24px", bgcolor: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, boxShadow: "0px 4px 20px rgba(0,0,0,0.1)" }}>
                    <input type="file" hidden ref={fileInputRef} onChange={handleFileSelect} accept=".pdf,.txt,.docx" />
                    <IconButton sx={{ p: "10px" }} aria-label="attach" onClick={() => fileInputRef.current.click()} disabled={uploading}>
                        {uploading ? <CircularProgress size={24} /> : <AttachFileIcon />}
                    </IconButton>
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
                    <IconButton sx={{ p: "10px", color: theme.palette.primary.main }} onClick={handleSend} disabled={(!input.trim() && !selectedFile) || loading || uploading}>
                        <SendIcon />
                    </IconButton>
                </Paper>
            </Box>
        </Box>
    );
};

export default Chat;
