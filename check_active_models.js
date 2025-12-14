const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const modelsToTest = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-2.5-flash",
    "gemini-pro",
    "gemini-1.5-pro",
];

async function testModels() {
    console.log("--- Testing Models for Connectivity ---");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    for (const modelName of modelsToTest) {
        try {
            process.stdout.write(`Testing ${modelName}... `);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello?");
            const response = await result.response;
            const text = response.text();

            if (text) {
                console.log("✅ SUCCESS");
                console.log(`>>> WINNER: ${modelName} is working.`);
                return; // Stop at the first working model
            }
        } catch (error) {
            console.log(`❌ FAILED (${error.status || 'Error'}: ${error.message.split('[')[0].substring(0, 50)}...)`);
        }
    }
    console.log("--- End of Test ---");
}

testModels();
