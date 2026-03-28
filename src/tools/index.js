const { indexDocument } = require("../services/treeBuilder");
const { queryDocument, getPage, getTree } = require("../services/treeNavigator");
const { DocumentMeta, Page, TreeNode } = require("../models");
const { v4: uuidv4 } = require("uuid");

async function toolIndexDocument({ filename, text, doc_id }) {
  if (!filename || !text) throw new Error("Both 'filename' and 'text' are required");
  const docId = doc_id || uuidv4();
  const result = await indexDocument(docId, filename, text);
  return {
    success: true,
    doc_id: result.docId,
    root_node_id: result.rootNodeId,
    total_pages: result.totalPages,
    message: `Document "${filename}" indexed with ${result.totalPages} pages.`,
  };
}

async function toolQueryDocument({ doc_id, question }) {
  if (!doc_id || !question) throw new Error("Both 'doc_id' and 'question' are required");
  const result = await queryDocument(doc_id, question);
  return {
    success: true,
    answer: result.answer,
    pages_used: result.pagesUsed,
    nodes_consulted: result.nodesConsulted,
    reasoning_path: result.reasoning,
  };
}

async function toolGetPage({ doc_id, page_number }) {
  if (!doc_id || page_number === undefined) throw new Error("Both 'doc_id' and 'page_number' are required");
  const page = await getPage(doc_id, parseInt(page_number));
  return {
    success: true,
    doc_id,
    page_number: page.pageNumber,
    content: page.content,
    summary: page.summary,
  };
}

async function toolGetTree({ doc_id }) {
  if (!doc_id) throw new Error("'doc_id' is required");
  const result = await getTree(doc_id);
  return {
    success: true,
    doc_id,
    filename: result.meta.filename,
    status: result.meta.status,
    total_pages: result.meta.totalPages,
    root_node_id: result.meta.rootNodeId,
    tree_text: result.tree,
  };
}

async function toolListDocuments() {
  const docs = await DocumentMeta.find().sort({ createdAt: -1 }).lean();
  return {
    success: true,
    count: docs.length,
    documents: docs.map((d) => ({
      doc_id: d.docId,
      filename: d.filename,
      status: d.status,
      total_pages: d.totalPages,
      created_at: d.createdAt,
    })),
  };
}

async function toolDeleteDocument({ doc_id }) {
  if (!doc_id) throw new Error("'doc_id' is required");
  await Promise.all([
    DocumentMeta.deleteOne({ docId: doc_id }),
    Page.deleteMany({ docId: doc_id }),
    TreeNode.deleteMany({ docId: doc_id }),
  ]);
  return { success: true, message: `Document ${doc_id} deleted.` };
}

const TOOL_DEFINITIONS = [
  {
    name: "index_document",
    description: "Ingest a text document and build a hierarchical ToC tree using GPT-4o. No vectors needed.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Document filename" },
        text: { type: "string", description: "Full plain text content" },
        doc_id: { type: "string", description: "Optional custom document ID" },
      },
      required: ["filename", "text"],
    },
  },
  {
    name: "query_document",
    description: "Ask a question. GPT-4o reasons over the ToC tree to find relevant sections and answers.",
    inputSchema: {
      type: "object",
      properties: {
        doc_id: { type: "string", description: "Document ID" },
        question: { type: "string", description: "Question to answer" },
      },
      required: ["doc_id", "question"],
    },
  },
  {
    name: "get_page",
    description: "Retrieve raw content of a specific page number.",
    inputSchema: {
      type: "object",
      properties: {
        doc_id: { type: "string" },
        page_number: { type: "number" },
      },
      required: ["doc_id", "page_number"],
    },
  },
  {
    name: "get_tree",
    description: "Get the full hierarchical ToC tree for a document.",
    inputSchema: {
      type: "object",
      properties: { doc_id: { type: "string" } },
      required: ["doc_id"],
    },
  },
  {
    name: "list_documents",
    description: "List all indexed documents.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "delete_document",
    description: "Delete a document and all its data.",
    inputSchema: {
      type: "object",
      properties: { doc_id: { type: "string" } },
      required: ["doc_id"],
    },
  },
];

const TOOL_HANDLERS = {
  index_document: toolIndexDocument,
  query_document: toolQueryDocument,
  get_page: toolGetPage,
  get_tree: toolGetTree,
  list_documents: toolListDocuments,
  delete_document: toolDeleteDocument,
};

module.exports = { TOOL_DEFINITIONS, TOOL_HANDLERS };
