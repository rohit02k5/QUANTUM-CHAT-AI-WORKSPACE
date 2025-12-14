const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Chat = require("./models/Chat");
const User = require("./models/userModel");
const File = require("./models/File");

dotenv.config();

const checkDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB: " + mongoose.connection.name);

        const userCount = await User.countDocuments();
        const chatCount = await Chat.countDocuments();
        const fileCount = await File.countDocuments();

        console.log(`\n--- DB STATS ---`);
        console.log(`Users: ${userCount}`);
        console.log(`Chats: ${chatCount}`);
        console.log(`Files: ${fileCount}`);

        if (chatCount > 0) {
            const chats = await Chat.find().limit(3).populate("user", "username email");
            console.log("\nSample Chats:");
            chats.forEach(c => console.log(`- [${c.user?.username}] ${c.title} (${c.messages.length} msgs)`));
        }

        process.exit();
    } catch (err) {
        console.error("DB Check Failed:", err);
        process.exit(1);
    }
};

checkDB();
