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

// Meeting minutes — structured output from a transcript (audio file or pasted text)
const MEETING_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    decisions: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { text: { type: "STRING" }, sourceSec: { type: "NUMBER" } }, required: ["text"] },
    },
    actionItems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          owner: { type: "STRING" },
          task: { type: "STRING" },
          due: { type: "STRING" },
          sourceSec: { type: "NUMBER" },
        },
        required: ["task"],
      },
    },
    openQuestions: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { text: { type: "STRING" }, sourceSec: { type: "NUMBER" } }, required: ["text"] },
    },
    risks: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { text: { type: "STRING" }, sourceSec: { type: "NUMBER" } }, required: ["text"] },
    },
  },
  required: ["summary"],
};

// Normalize loose model output into the meeting schema
function normalizeMeeting(raw) {
  const item = (v) =>
    typeof v === "string" ? { text: v } : { text: v?.text ?? v?.task ?? String(v ?? ""), ...(typeof v?.sourceSec === "number" ? { sourceSec: v.sourceSec } : {}) };
  const arr = (a) => (Array.isArray(a) ? a.filter(Boolean).map(item) : []);
  const action = (a) =>
    (Array.isArray(a) ? a : [])
      .filter(Boolean)
      .map((v) => ({
        owner: v?.owner || "",
        task: v?.task || v?.text || "",
        ...(v?.due ? { due: String(v.due) } : {}),
        ...(typeof v?.sourceSec === "number" ? { sourceSec: v.sourceSec } : {}),
      }))
      .filter((v) => v.task);
  return {
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    decisions: arr(raw?.decisions),
    actionItems: action(raw?.actionItems),
    openQuestions: arr(raw?.openQuestions),
    risks: arr(raw?.risks),
  };
}

exports.generateMeetingMinutes = async (req, res) => {
  try {
    const { text, fileId } = req.body;
    let transcript = text;
    let file = null;

    if (fileId) {
      const File = require("../models/File");
      file = await File.findOne({ _id: fileId, user: req.user._id });
      if (!file) return res.status(404).json({ message: "File not found" });
      if (file.status && file.status !== "ready") {
        return res.status(409).json({ message: `File is ${file.status === "failed" ? "failed" : "still being ingested"}` });
      }
      transcript = file.content;
    }
    if (!transcript || !transcript.trim()) return res.status(400).json({ message: "Transcript text required" });

    const prompt = `You are an Executive Assistant producing meeting minutes from a transcript. The transcript lines carry "(Ns)" timestamps.
Return STRICT JSON with:
{
  "summary": "2-4 sentence executive summary",
  "decisions": [{"text": "decision made", "sourceSec": <transcript timestamp in seconds when this was discussed>}],
  "actionItems": [{"owner": "person responsible or ''", "task": "the action", "due": "deadline if mentioned or omit", "sourceSec": <timestamp>}],
  "openQuestions": [{"text": "unresolved question", "sourceSec": <timestamp>}],
  "risks": [{"text": "risk or blocker", "sourceSec": <timestamp>}]
}
Include sourceSec whenever the item maps to a specific moment in the transcript.

TRANSCRIPT:
${transcript.substring(0, 30000)}`;

    const result = await geminiHelper.generateContentWithRetry(
      prompt,
      { responseMimeType: "application/json", responseSchema: MEETING_SCHEMA },
      2
    );
    let raw;
    try {
      raw = JSON.parse(cleanJSON(geminiHelper.getText(result)));
    } catch {
      return res.status(502).json({ message: "Meeting minutes produced invalid output" });
    }
    const data = normalizeMeeting(raw);
    if (file) {
      data.fileId = file._id;
      data.fileName = file.originalName;
      data.durationSec = file.durationSec;
      data.kind = file.kind;
    }
    res.status(200).json(data);
  } catch (error) {
    console.error("Meeting Minutes Error:", error);
    res.status(500).json({ message: "Meeting minutes failed", error: error.message });
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
