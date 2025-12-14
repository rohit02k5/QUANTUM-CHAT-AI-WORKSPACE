const Chat = require("../models/Chat");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

        const { message, chatId, fileId } = req.body;
        const userId = req.user._id;

        // Lazy load model to ensure Env is ready
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
        if (fileId) {
            try {
                const ChatFile = require("../models/File");
                const fileDoc = await ChatFile.findById(fileId);
                if (fileDoc && fileDoc.content) {
                    prompt += `\n\n[Attached File Content: ${fileDoc.originalName}]\n${fileDoc.content}\n[End of File]`;
                }
            } catch (fileErr) {
                console.error("File attachment error:", fileErr);
            }
        }

        // Generate response using Gemini (with history context)
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

        const chatSession = model.startChat({
            history: history,
        });

        const result = await chatSession.sendMessage(prompt);
        const responseText = result.response.text();

        // Add model response
        chat.messages.push({ role: "model", content: responseText });

        await chat.save();
        res.status(200).json({ response: responseText, chatId: chat._id, chat });

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

        // Lazy load & use 2.5-flash (Verified Working)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
