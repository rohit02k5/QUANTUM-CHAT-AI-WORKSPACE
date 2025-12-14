const geminiHelper = require("../utils/geminiHelper");

// Helper to clean JSON
const cleanJSON = (text) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

// Insight Engine: Analysis Endpoint
exports.analyzeContent = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: "Text required" });

    const prompt = `
        Analyze the following text for a "Quantum Intelligence Dashboard". 
        Return a STRICT JSON object with these fields:
        {
            "entities": [ {"name": "Entity Name", "type": "Person|Org|Loc", "importance": 1-10} ],
            "relationships": [ {"source": "Entity Name 1", "target": "Entity Name 2", "relation": "Verbed"} ],
            "topics": [ {"label": "Topic Name", "score": 1-100} ], 
            "sentimentTimeline": [ {"segment": "Part 1", "score": -1 to 1, "label": "Positive/Negative"} ],
            "seo": {
                "keywordDensity": [ {"word": "keyword", "count": 10, "density": "2%"} ],
                "readability": { "score": 1-100, "level": "Grade X", "time": "X mins" },
                "tone": "Formal/Casual/etc"
            }
        }
        Text: ${text.substring(0, 5000)}
        `;

    const result = await geminiHelper.generateContentWithRetry(prompt);
    const rawText = geminiHelper.getText(result);

    let data;
    try {
      const jsonString = cleanJSON(rawText);
      data = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError, "Raw output:", rawText);
      throw new Error("Failed to parse AI response");
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ message: "Analysis failed", error: error.message });
  }
};

// Executive Assistant: Action Plan Endpoint
exports.generateActionPlan = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: "Text required" });

    const prompt = `
        Act as an Executive Assistant. Analyze this text and generate a Strategic Action Plan.
        Return STRICT JSON:
        {
            "executiveSummary": "High-level brief",
            "actionItems": ["Action 1", "Action 2"],
            "strategicGaps": ["Missing financial data", "No risk assessment"],
            "keyRisks": ["Risk 1", "Risk 2"]
        }
        Text: ${text.substring(0, 5000)}
        `;

    const result = await geminiHelper.generateContentWithRetry(prompt);
    const jsonString = cleanJSON(geminiHelper.getText(result));
    const data = JSON.parse(jsonString);

    res.status(200).json(data);
  } catch (error) {
    console.error("Action Plan Error:", error);
    res.status(500).json({ message: "Action Plan failed", error: error.message });
  }
};

// Legacy Chatbot (Updated to use Gemini Helper if desired, or keep simple)
exports.chatbotController = async (req, res) => {
  try {
    const { text } = req.body;
    const result = await geminiHelper.generateContentWithRetry(text);
    res.status(200).json({ response: geminiHelper.getText(result) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Legacy Summary (Redirect to generateActionPlan or simple summary)
exports.summaryController = async (req, res) => {
  // Re-use logic or keep simple. Let's upgrade it to use helper.
  try {
    const { text } = req.body;
    const prompt = `Summarize this text in 3 sentences, provide 3 key points, and overall sentiment. JSON format: { "summary": "", "keyPoints": [], "sentiment": "" } \nText: ${text}`;
    const result = await geminiHelper.generateContentWithRetry(prompt);
    res.status(200).json(JSON.parse(cleanJSON(geminiHelper.getText(result))));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
