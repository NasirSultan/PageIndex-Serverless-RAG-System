require("dotenv").config();
const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: "reasoningrag",
    serverSelectionTimeoutMS: 10000,
  });
  isConnected = true;
  console.log("[MongoDB] Connected to reasoningrag");
}

module.exports = { connectDB };
