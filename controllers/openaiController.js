const dotenv = require("dotenv");
dotenv.config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); // Load GEMINI_API_KEY from .env file
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

if (!genAI) {
  console.error("Missing GEMINI API Key.");
  process.exit(1);
}

// Summary Controller
exports.summaryController = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ message: "Text input is required and must be a non-empty string." });
    }

    // Generate summary using the Gemini API
    const response = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Summarize the following text:\n\n${text}`,
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.1,
      },
    });

    // Extract summary response
    const summaryResponse = response.response?.text();
    if (!summaryResponse) {
      throw new Error("Invalid response format from Gemini model.");
    }

    res.status(200).json({ summary: summaryResponse });
  } catch (err) {
    console.error("Summary API Error:", err.message);
    res.status(500).json({ message: err.message || "Internal Server Error" });
  }
};

// Chatbot Controller
exports.chatbotController = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ message: "Text input is required and must be a non-empty string." });
    }

    // Chat request to the Gemini model
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "Hello" }],
        },
        {
          role: "model",
          parts: [{ text: "Great to meet you. How can I assist you today?" }],
        },
      ],
    });

    // Sending the user input to the chat model
    const response = await chat.sendMessage(text);

    // Extract chatbot's response
    const chatbotResponse = response.response?.text();
    if (!chatbotResponse) {
      console.error("Unexpected response format:", response);
      return res.status(502).json({ message: "Invalid response format from Gemini API." });
    }

    res.status(200).json({ response: chatbotResponse });
  } catch (err) {
    console.error("Chatbot Controller Error:", err.message);
    res.status(500).json({ message: err.message || "Internal Server Error" });
  }
};
