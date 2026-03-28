require("dotenv").config();
const { ChatOpenAI } = require("@langchain/openai");

const llm = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7,
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = { llm };
