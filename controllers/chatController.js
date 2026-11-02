const Chat = require("../models/Chat");
const Chunk = require("../models/Chunk");
const { retrieveChunks, buildContext } = require("../utils/retriever");
const { removeFileArtifacts } = require("./fileController");
const geminiHelper = require("../utils/geminiHelper");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const RAG_TOP_K = parseInt(process.env.RAG_TOP_K || "3", 10);
const MAX_ATTACH_CHARS = parseInt(process.env.MAX_ATTACH_CHARS || "12000", 10);

// Get User Chats
exports.getUserChats = async (req, res) => {
    try {
        const chats = await Chat.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.status(200).json({ chats });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Create/Update Chat (Message)
exports.sendMessage = async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is missing in environment variables");
        }

        const { message, chatId, fileId, useDocuments, documentIds } = req.body;
        const userId = req.user._id;

        let chat;
        if (chatId) {
            chat = await Chat.findOne({ _id: chatId, user: userId });
        }

        if (!chat) {
            chat = new Chat({
                user: userId,
                title: message.substring(0, 30) + "...",
                messages: [],
            });
        }

        // Add user message to DB
        chat.messages.push({ role: "user", content: message });

        let prompt = message;

        // RAG: retrieve relevant chunks from the user's uploaded documents.
        // Auto-enabled whenever the user has indexed docs; the frontend toggle
        // (useDocuments === false) can disable it per message.
        let sources = [];
        const hasDocs = useDocuments !== false && (await Chunk.exists({ user: userId }));
        if (hasDocs) {
            try {
                const scopedIds = Array.isArray(documentIds) ? documentIds : [];
                const chunks = await retrieveChunks(userId, message, RAG_TOP_K, scopedIds);
                if (chunks.length > 0) {
                    const context = buildContext(chunks);
                    prompt =
                        "Answer the user's question using ONLY the provided sources when relevant. " +
                        "If the answer is not in the sources, say so and answer from general knowledge.\n\n" +
                        `=== SOURCES ===\n${context}\n=== END SOURCES ===\n\nQuestion: ${message}`;
                    sources = chunks.map((c) => ({
                        fileId: c.fileId,
                        originalName: c.originalName,
                        metadata: c.metadata,
                        score: c.score,
                        snippet: c.text.substring(0, 200),
                    }));
                    console.log(`[Chat][RAG] Retrieved ${chunks.length} chunks for user ${userId}`);
                } else {
                    console.log(`[Chat][RAG] No relevant chunks found - falling back to normal chat`);
                }
            } catch (ragErr) {
                // Never break normal chat because RAG failed
                console.error("[Chat][RAG] Retrieval error:", ragErr.message);
            }
        }

        let tempFileDoc = null;
        if (fileId) {
            try {
                const ChatFile = require("../models/File");
                const fileDoc = await ChatFile.findOne({ _id: fileId, user: userId });
                if (fileDoc && fileDoc.content) {
                    const excerpt = fileDoc.content.length > MAX_ATTACH_CHARS
                        ? fileDoc.content.substring(0, MAX_ATTACH_CHARS) + "\n[...truncated]"
                        : fileDoc.content;
                    prompt += `\n\n[Attached File Content: ${fileDoc.originalName}]\n${excerpt}\n[End of File]`;
                    if (fileDoc.isTemp) tempFileDoc = fileDoc;
                }
            } catch (fileErr) {
                console.error("File attachment error:", fileErr);
            }
        }

        // Generate response using Gemini (with history context) using helper with retries
        // Ensure history rules: 
        // 1. Roles must be 'user' or 'model'.
        // 2. No empty parts.
        const history = chat.messages
            .slice(0, -1) // Exclude the *current* message we just added
            .map((msg) => ({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.content || " " }], // Fallback for empty content
            }));

        // Debug Log
        console.log(`[Chat] Sending to Gemini: Prompt length ${prompt.length}, History length ${history.length}`);

        const result = await geminiHelper.generateChatWithRetry(history, prompt);
        const responseText = geminiHelper.getText(result);

        // Add model response (attach sources metadata so history reload can show them)
        chat.messages.push({
            role: "model",
            content: responseText,
            sources: sources.length ? sources : undefined,
        });

        await chat.save();
        res.status(200).json({ response: responseText, chatId: chat._id, chat, sources: sources.length ? sources : undefined });

        // Temp attachments are single-use: drop the record + disk file afterwards
        if (tempFileDoc) removeFileArtifacts(tempFileDoc);

    } catch (err) {
        console.error("CHAT_ERROR_DETAILS:", err); // Logs to server console
        res.status(500).json({
            message: "Chat Error",
            error: err.message,
            details: err.toString()
        });
    }
};

// Get specific chat messages
exports.getChatMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const chat = await Chat.findOne({ _id: chatId, user: req.user._id });
        if (!chat) return res.status(404).json({ message: "Chat not found" });
        res.status(200).json({ chat });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Delete Chat
exports.deleteChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        await Chat.findOneAndDelete({ _id: chatId, user: req.user._id });
        res.status(200).json({ message: "Chat deleted" });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Generate Mindmap from Chat
exports.generateMindmap = async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is missing");
        }

        // Lazy load - use current working model
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

        const { chatId } = req.body;
        const chat = await Chat.findById(chatId);
        if (!chat) return res.status(404).json({ message: "Chat not found" });

        // Combine messages for context
        const fullText = chat.messages.map(m => `${m.role}: ${m.content}`).join("\n");

        const prompt = `Based on the conversation, generate a visual Mermaid.js mindmap.
        Rules:
        1. Start with 'mindmap'
        2. Use Strict Indentation (2 spaces).
        3. Enclose ALL text in double quotes/parentheses like ("Text Here") to allow special characters.
        4. Keep it hierarchical and concise.
        
        Example:
        mindmap
          root((Central Topic))
            ("Sub Topic 1")
              ("Detail A")
            ("Sub Topic 2")
        
        Conversation:
        ${fullText}
        
        Return ONLY the mermaid code block.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        // Clean code block formatting if present
        const cleanCode = text.replace(/```mermaid/g, "").replace(/```/g, "").trim();

        res.status(200).json({ mindmap: cleanCode });
    } catch (err) {
        console.error("MINDMAP_ERROR:", err);
        res.status(500).json({
            message: "Mindmap Generation Error",
            error: err.message,
            details: err.toString()
        });
    }
};
