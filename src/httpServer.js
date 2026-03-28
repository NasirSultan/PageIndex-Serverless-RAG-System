const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { v4: uuidv4 } = require("uuid");
const { TOOL_HANDLERS } = require("./tools/index");
const { DocumentMeta } = require("./models/index");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function createHTTPServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "pageindex-mcp", timestamp: new Date().toISOString() });
  });

  app.get("/documents", async (req, res) => {
    try {
      const result = await TOOL_HANDLERS.list_documents({});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/documents/index", async (req, res) => {
    try {
      const { filename, text, doc_id } = req.body;
      if (!filename || !text) return res.status(400).json({ success: false, error: "filename and text are required" });
      const result = await TOOL_HANDLERS.index_document({ filename, text, doc_id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/documents/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });
      let text = "";
      const filename = req.file.originalname;
      if (req.file.mimetype === "application/pdf" || filename.endsWith(".pdf")) {
        const parsed = await pdfParse(req.file.buffer);
        text = parsed.text;
      } else {
        text = req.file.buffer.toString("utf-8");
      }
      if (!text || text.trim().length < 50) return res.status(400).json({ success: false, error: "Could not extract text" });
      const doc_id = req.body.doc_id || uuidv4();
      const result = await TOOL_HANDLERS.index_document({ filename, text, doc_id });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/documents/:docId/query", async (req, res) => {
    try {
      const { question } = req.body;
      if (!question) return res.status(400).json({ success: false, error: "question is required" });
      const result = await TOOL_HANDLERS.query_document({ doc_id: req.params.docId, question });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/documents/:docId/tree", async (req, res) => {
    try {
      const result = await TOOL_HANDLERS.get_tree({ doc_id: req.params.docId });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/documents/:docId/pages/:pageNumber", async (req, res) => {
    try {
      const result = await TOOL_HANDLERS.get_page({ doc_id: req.params.docId, page_number: parseInt(req.params.pageNumber) });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/documents/:docId", async (req, res) => {
    try {
      const result = await TOOL_HANDLERS.delete_document({ doc_id: req.params.docId });
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/mcp/call", async (req, res) => {
    try {
      const { tool, arguments: args } = req.body;
      const handler = TOOL_HANDLERS[tool];
      if (!handler) return res.status(404).json({ success: false, error: `Unknown tool: ${tool}` });
      const result = await handler(args || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return app;
}

module.exports = { createHTTPServer };
