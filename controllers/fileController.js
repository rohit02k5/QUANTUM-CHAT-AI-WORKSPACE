const File = require("../models/File");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Upload File
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const { originalname, filename, path: filePath, mimetype, size } = req.file;
        const userId = req.user._id;

        // Extract text content
        let content = "";
        console.log(`[DEBUG] Processing file: ${originalname}, Mime: ${mimetype}, Path: ${filePath}`);

        try {
            if (mimetype === "application/pdf") {
                console.log("[DEBUG] Starting PDF extraction with Gemini...");
                const fileData = fs.readFileSync(filePath);
                const base64Data = fileData.toString("base64");

                const result = await model.generateContent([
                    {
                        inlineData: {
                            data: base64Data,
                            mimeType: "application/pdf",
                        },
                    },
                    { text: "Extract all text from this PDF document verbatim. Return only the extracted text." },
                ]);

                content = result.response.text();
                fs.appendFileSync("extraction_debug.txt", `[${new Date().toISOString()}] SUCCESS. File: ${originalname}. Length: ${content.length}\n`);
                console.log(`[DEBUG] Gemini PDF extracted length: ${content ? content.length : 0}`);

            } else if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") { // docx
                const result = await mammoth.extractRawText({ path: filePath });
                content = result.value;
            } else if (mimetype === "text/plain") {
                content = fs.readFileSync(filePath, "utf8");
            }
        } catch (extractionError) {
            console.error("Text extraction failed:", extractionError);
            fs.appendFileSync("extraction_debug.txt", `[${new Date().toISOString()}] ERROR. File: ${originalname}. Msg: ${extractionError.message}\n`);
            fs.appendFileSync("extraction_error.log", `${new Date().toISOString()} - ${extractionError.message}\n${extractionError.stack}\n`);
            content = `[Text extraction failed: ${extractionError.message}]`;
        }

        console.log(`[DEBUG] Final content to save (first 100 chars): ${content ? content.substring(0, 100) : "Empty"}...`);

        const newFile = new File({
            user: userId,
            filename,
            originalName: originalname,
            path: filePath,
            mimetype,
            size,
            content,
        });

        await newFile.save();
        res.status(201).json({ message: "File uploaded successfully", file: newFile });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get User Files
exports.getUserFiles = async (req, res) => {
    try {
        const files = await File.find({ user: req.user._id }).sort({ uploadDate: -1 });
        res.status(200).json({ files });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};

// Search Files (Basic Implementation)
exports.searchFiles = async (req, res) => {
    try {
        const { query } = req.query;
        const files = await File.find({
            user: req.user._id,
            originalName: { $regex: query, $options: "i" },
        });
        res.status(200).json({ results: files });
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
};
