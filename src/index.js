require("dotenv").config();
const { connectDB } = require("./utils/db");
const { createHTTPServer } = require("./httpServer");
const { startMCPServer } = require("./mcpServer");

const MODE = process.env.MODE || "http";
const PORT = parseInt(process.env.PORT) || 3000;

async function main() {
  await connectDB();

  if (MODE === "mcp") {
    await startMCPServer();
  } else {
    const app = createHTTPServer();
    app.listen(PORT, () => {
      console.log(`[PageIndex] HTTP server running on http://localhost:${PORT}`);
      console.log(`  GET    /health`);
      console.log(`  GET    /documents`);
      console.log(`  POST   /documents/index`);
      console.log(`  POST   /documents/upload`);
      console.log(`  POST   /documents/:docId/query`);
      console.log(`  GET    /documents/:docId/tree`);
      console.log(`  GET    /documents/:docId/pages/:pageNumber`);
      console.log(`  DELETE /documents/:docId`);
      console.log(`  POST   /mcp/call`);
    });
  }
}

main().catch((err) => {
  console.error("[Fatal]", err.message);
  process.exit(1);
});
