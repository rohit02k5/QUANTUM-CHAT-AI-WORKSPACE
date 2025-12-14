const Chat = require("../models/Chat");
const File = require("../models/File");

// Global Search
exports.globalSearch = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ message: "Query is required" });

        const userId = req.user._id;
        const regex = new RegExp(query, "i");

        // Search Files
        const files = await File.find({
            user: userId,
            isTemp: false,
            $or: [
                { originalName: regex },
                { content: regex }
            ]
        }).select("originalName mimetype _id uploadDate");

        // Search Chats
        const chats = await Chat.find({
            user: userId,
            "messages.content": regex
        }).select("title _id createdAt");

        res.status(200).json({ files, chats });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Search Failed" });
    }
};
