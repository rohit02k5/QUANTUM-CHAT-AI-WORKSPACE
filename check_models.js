const dotenv = require("dotenv");
dotenv.config();

async function checkModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();
        if (data.models) {
            const names = data.models.map(m => m.name);
            console.log(JSON.stringify(names, null, 2));
        } else {
            console.log("No models or error:", JSON.stringify(data));
        }
    } catch (e) {
        console.error(e);
    }
}

checkModels();
