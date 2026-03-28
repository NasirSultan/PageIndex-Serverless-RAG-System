# PageIndex MCP — Serverless RAG with Hierarchical ToC Tree Reasoning

> **No vectors. No embeddings. Pure GPT-4o reasoning.**
> PageIndex replaces semantic similarity search with intelligent tree navigation — the same way a human expert reads a document.

---

## What is PageIndex?

Traditional RAG systems split documents into chunks and use vector embeddings to find "similar" text. This breaks down for complex documents with cross-references, financial tables, and appendices.

**PageIndex works differently:**

1. It reads your document and builds a **hierarchical Table of Contents tree** — just like a book's index
2. Each tree node gets a **summary** of what that section covers
3. When you ask a question, GPT-4o **reasons over the tree** to decide which section likely contains the answer
4. Only the relevant pages are retrieved and used to generate the answer

**Result:** Higher accuracy, full explainability, and no vector database required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM & Reasoning | GPT-4o via LangChain (`@langchain/openai`) |
| Database | MongoDB Atlas (`reasoningrag` database) |
| MCP Server | `@modelcontextprotocol/sdk` (stdio) |
| HTTP API | Express.js |
| File Parsing | `pdf-parse` (PDF support) |
| Runtime | Node.js ≥ 18 |

---

## Project Structure

```
pageindex-mcp2/
│
├── src/
│   ├── index.js                  ← Entry point (HTTP or MCP mode)
│   ├── httpServer.js             ← Express REST API (9 endpoints)
│   ├── mcpServer.js              ← MCP stdio server for Claude Desktop / Cursor
│   │
│   ├── models/
│   │   └── index.js              ← Mongoose schemas: Page, TreeNode, DocumentMeta
│   │
│   ├── services/
│   │   ├── treeBuilder.js        ← Ingestion pipeline: split → summarize → build tree
│   │   └── treeNavigator.js      ← Query pipeline: reason over tree → retrieve → answer
│   │
│   ├── tools/
│   │   └── index.js              ← MCP tool definitions and handlers
│   │
│   └── utils/
│       ├── db.js                 ← MongoDB connection
│       └── llm.js                ← ChatOpenAI singleton (GPT-4o)
│
├── mcp-stdio.js                  ← MCP stdio entry point
├── .env                          ← Environment variables
├── package.json
└── README.md
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Open `.env` and set your OpenAI API key:

```env
OPENAI_API_KEY=sk-your-key-here
MONGO_URI=mongodb+srv://nasireaglines_db_user:...@rag.d74ni5g.mongodb.net/reasoningrag
PORT=3000
MODE=http
```

### 3. Start the server

```bash
npm start
```

You should see:

```
[MongoDB] Connected to reasoningrag
[PageIndex] HTTP server running on http://localhost:3000
```

---

## How It Works — Step by Step

```
┌─────────────────────────────────────────────────────────┐
│                     INGESTION PIPELINE                  │
│                                                         │
│  Document Text                                          │
│       │                                                 │
│       ▼                                                 │
│  Split into Pages (~1500 chars, sentence boundaries)    │
│       │                                                 │
│       ▼                                                 │
│  GPT-4o summarizes each page (1-2 sentences)           │
│       │                                                 │
│       ▼                                                 │
│  GPT-4o builds hierarchical ToC tree from summaries    │
│       │                                                 │
│       ▼                                                 │
│  Pages + Tree stored in MongoDB (reasoningrag)          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                     QUERY PIPELINE                      │
│                                                         │
│  User Question                                          │
│       │                                                 │
│       ▼                                                 │
│  Load ToC tree from MongoDB                             │
│       │                                                 │
│       ▼                                                 │
│  GPT-4o reasons: "Which section has the answer?"       │
│       │                                                 │
│       ▼                                                 │
│  Retrieve only those pages from MongoDB                 │
│       │                                                 │
│       ▼                                                 │
│  GPT-4o generates final answer from page content       │
└─────────────────────────────────────────────────────────┘
```

---

## REST API Reference

### `GET /health`
Check if the server is running.

**Response:**
```json
{ "status": "ok", "service": "pageindex-mcp", "timestamp": "2024-..." }
```

---

### `GET /documents`
List all indexed documents.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "documents": [
    { "doc_id": "report-001", "filename": "annual_report.pdf", "status": "ready", "total_pages": 12 }
  ]
}
```

---

### `POST /documents/index`
Index a document from plain text. GPT-4o builds the full ToC tree.

**Body (JSON):**
```json
{
  "filename": "annual_report.txt",
  "text": "Full document text here...",
  "doc_id": "report-001"
}
```

> `doc_id` is optional — auto-generated if not provided. Always save it for future queries.

**Response:**
```json
{
  "success": true,
  "doc_id": "report-001",
  "root_node_id": "uuid",
  "total_pages": 8,
  "message": "Document indexed with 8 pages."
}
```

---

### `POST /documents/upload`
Upload a PDF or TXT file. Text is extracted automatically then indexed.

**Body (form-data):**

| Key | Type | Value |
|-----|------|-------|
| `file` | File | your `.pdf` or `.txt` file |
| `doc_id` | Text | optional custom ID |

---

### `POST /documents/:docId/query` ⭐
Ask a natural language question. GPT-4o reasons over the ToC tree and returns a precise answer with full reasoning trace.

**Body (JSON):**
```json
{
  "question": "What is the total value of deferred assets?"
}
```

**Response:**
```json
{
  "success": true,
  "answer": "The total deferred assets are $42.7 million, comprising deferred tax assets of $14.2 million and prepaid contracts of $28.5 million (Appendix C, Page 9).",
  "pages_used": [9],
  "nodes_consulted": [
    { "nodeId": "uuid", "reason": "Appendix C explicitly covers deferred revenue and assets" }
  ],
  "reasoning_path": [
    "Appendix C explicitly covers deferred revenue and assets"
  ]
}
```

---

### `GET /documents/:docId/tree`
View the full hierarchical ToC tree built by GPT-4o.

**Response:**
```json
{
  "success": true,
  "filename": "annual_report.txt",
  "total_pages": 8,
  "tree_text": "[uuid] \"annual_report.txt\"\n  Summary: ...\n  [uuid] \"Revenue Analysis\" [pages: 1, 2]\n    Summary: Covers Q1-Q4 revenue...\n  [uuid] \"Appendix C\" [pages: 9]\n    Summary: Deferred assets breakdown..."
}
```

---

### `GET /documents/:docId/pages/:pageNumber`
Retrieve raw content and summary of a specific page.

**Response:**
```json
{
  "success": true,
  "page_number": 3,
  "content": "Raw text of page 3...",
  "summary": "This page covers operating expenses including R&D and sales costs."
}
```

---

### `DELETE /documents/:docId`
Delete a document and all associated data from MongoDB (pages, tree nodes, metadata).

**Response:**
```json
{ "success": true, "message": "Document report-001 deleted." }
```

---

### `POST /mcp/call`
Call any MCP tool directly by name — useful for testing without a full MCP client.

**Body (JSON):**
```json
{
  "tool": "query_document",
  "arguments": {
    "doc_id": "report-001",
    "question": "What was net income in 2024?"
  }
}
```

Available tools: `index_document`, `query_document`, `get_page`, `get_tree`, `list_documents`, `delete_document`

---

## MCP Tools (for Claude Desktop / Cursor)

To use with Claude Desktop, set `MODE=mcp` and run:

```bash
node mcp-stdio.js
```

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pageindex": {
      "command": "node",
      "args": ["C:/full/path/to/pageindex-mcp2/mcp-stdio.js"],
      "env": {
        "OPENAI_API_KEY": "sk-your-key",
        "MONGO_URI": "your-mongo-uri",
        "MODE": "mcp"
      }
    }
  }
}
```

| Tool | Description |
|------|-------------|
| `index_document` | Ingest text and build ToC tree |
| `query_document` | Reason over tree and answer questions |
| `get_page` | Get raw content of a specific page |
| `get_tree` | View full ToC tree |
| `list_documents` | List all indexed documents |
| `delete_document` | Remove a document |

---

## MongoDB Collections

Three collections are created automatically in the `reasoningrag` database:

| Collection | Purpose |
|---|---|
| `pages` | Stores every page: content, summary, char positions |
| `treenodes` | Stores every tree node: title, summary, page refs, children |
| `documentmetas` | Stores document-level metadata: status, page count, root node |

---

## PageIndex vs Traditional RAG

| Feature | Vector RAG | PageIndex |
|---|---|---|
| Retrieval method | Cosine similarity on embeddings | GPT-4o reasoning over ToC tree |
| Vector database | Required | Not needed |
| Cross-references | Missed | Followed intelligently |
| Explainability | Low (similarity scores) | Full reasoning trace |
| Financial/legal docs | Often fails | High accuracy |
| Chunking | Arbitrary character splits | Natural section boundaries |

---

## Recommended Postman Workflow

```
Step 1 → POST /documents/upload        Upload your PDF
Step 2 → GET  /documents               Confirm doc_id and status = "ready"
Step 3 → GET  /documents/:id/tree      Inspect how GPT-4o structured it
Step 4 → POST /documents/:id/query     Ask your questions
Step 5 → GET  /documents/:id/pages/N   Inspect specific pages if needed
Step 6 → DELETE /documents/:id         Clean up when done
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `MONGO_URI` | Yes | MongoDB Atlas connection string |
| `PORT` | No | HTTP server port (default: 3000) |
| `MODE` | No | `http` (default) or `mcp` for stdio |

---
