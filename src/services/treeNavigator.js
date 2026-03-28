const { llm } = require("../utils/llm");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { Page, TreeNode, DocumentMeta } = require("../models");

async function loadTree(docId) {
  const nodes = await TreeNode.find({ docId }).lean();
  const map = {};
  nodes.forEach((n) => (map[n.nodeId] = n));
  return map;
}

function treeToText(nodeMap, nodeId, depth) {
  depth = depth || 0;
  const node = nodeMap[nodeId];
  if (!node) return "";
  const indent = "  ".repeat(depth);
  const pages = node.pageRefs && node.pageRefs.length > 0 ? ` [pages: ${node.pageRefs.join(", ")}]` : "";
  let text = `${indent}[${node.nodeId}] "${node.title}"${pages}\n`;
  text += `${indent}  Summary: ${node.summary}\n`;
  if (node.children && node.children.length > 0) {
    for (const childId of node.children) {
      text += treeToText(nodeMap, childId, depth + 1);
    }
  }
  return text;
}

async function reasonOverTree(question, treeText) {
  const response = await llm.invoke([
    new SystemMessage(
      `You are a document navigation expert with a hierarchical Table of Contents tree.
Each node has an ID, title, summary, and page references.
Given a question, identify which leaf node(s) most likely contain the answer.
Return ONLY a JSON array:
[{"nodeId": "full-uuid-here", "reason": "why this node"}]
Choose 1-3 most relevant nodes. Use the FULL nodeId from the tree.`
    ),
    new HumanMessage(`Question: ${question}\n\nDocument Tree:\n${treeText}\n\nReturn only the JSON array.`),
  ]);

  let raw = response.content.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function getPagesForNode(docId, node) {
  if (!node.pageRefs || node.pageRefs.length === 0) return [];
  return Page.find({ docId, pageNumber: { $in: node.pageRefs } }).sort({ pageNumber: 1 }).lean();
}

async function generateAnswer(question, pages, nodeInfo) {
  const context = pages.map((p) => `[Page ${p.pageNumber}]\n${p.content}`).join("\n\n---\n\n");
  const response = await llm.invoke([
    new SystemMessage(
      "Answer the user's question using ONLY the provided context. Be precise and cite page numbers when relevant."
    ),
    new HumanMessage(`Question: ${question}\n\nContext (from: ${nodeInfo}):\n\n${context}`),
  ]);
  return response.content.trim();
}

/**
 * Detect if the question is asking for a general summary of the whole document.
 */
function isDocumentSummaryQuestion(question) {
  const q = question.toLowerCase().trim();
  const summaryPatterns = [
    /^tell me (a |the )?(brief |short |quick |overall )?summary/,
    /^(give me |provide |write |what is |what's )(a |the )?(brief |short |quick |overall )?summary/,
    /^summarize (this|the document|it|everything)/,
    /^what is this (document |pdf |file )?about/,
    /^what('s| is) (this|the document|this document|this pdf|this file) about/,
    /^overview of (this|the document)/,
    /^(briefly |quickly )?describe (this|the document)/,
    /^(what does this (document|pdf|file) (cover|contain|discuss|talk about))/,
  ];
  return summaryPatterns.some((p) => p.test(q));
}

/**
 * Collect all pages from all leaf nodes (nodes that have pageRefs).
 */
async function getAllLeafPages(docId, nodeMap) {
  const leafNodes = Object.values(nodeMap).filter(
    (n) => n.pageRefs && n.pageRefs.length > 0
  );
  const allPageNums = leafNodes.flatMap((n) => n.pageRefs);
  const uniqueNums = [...new Set(allPageNums)].sort((a, b) => a - b);
  return Page.find({ docId, pageNumber: { $in: uniqueNums } })
    .sort({ pageNumber: 1 })
    .lean();
}

async function queryDocument(docId, question) {
  const meta = await DocumentMeta.findOne({ docId }).lean();
  if (!meta) throw new Error(`Document ${docId} not found`);
  if (meta.status === "processing") throw new Error(`Document ${docId} is still being indexed`);
  if (meta.status === "error") throw new Error(`Document ${docId} failed: ${meta.errorMessage}`);

  const nodeMap = await loadTree(docId);

  // --- FAST PATH: summary / overview questions ---
  if (isDocumentSummaryQuestion(question)) {
    console.log(`[Query] Summary question detected — using root node summary`);
    const rootNode = nodeMap[meta.rootNodeId];
    const rootSummary = rootNode ? rootNode.summary : "No summary available.";

    // Also collect all pages so we can generate a richer answer
    const allPages = await getAllLeafPages(docId, nodeMap);

    const answer = await llm.invoke([
      new SystemMessage(
        "You are a document assistant. The user wants a summary of the whole document. Use the provided document summary and page content to give a clear, well-structured overview. Include key topics, main findings, and important details."
      ),
      new HumanMessage(
        `Document title: ${meta.filename}\n\nDocument summary: ${rootSummary}\n\nFull content:\n${allPages.map((p) => `[Page ${p.pageNumber}]\n${p.content}`).join("\n\n---\n\n")}`
      ),
    ]);

    return {
      answer: answer.content.trim(),
      pagesUsed: allPages.map((p) => p.pageNumber),
      nodesConsulted: [{ nodeId: meta.rootNodeId, reason: "Root node — document-level summary question" }],
      reasoning: ["Summary question detected — retrieved all pages for full document overview"],
    };
  }

  // --- NORMAL PATH: specific question ---
  const treeText = treeToText(nodeMap, meta.rootNodeId);
  console.log(`[Query] Reasoning over tree...`);
  const selectedNodes = await reasonOverTree(question, treeText);

  if (!selectedNodes || selectedNodes.length === 0) {
    return { answer: "Could not identify relevant sections for this question.", pagesUsed: [], nodesConsulted: [], reasoning: [] };
  }

  const allPages = [];
  const nodeInfo = [];

  for (const sel of selectedNodes) {
    let node = nodeMap[sel.nodeId];
    if (!node) {
      node = Object.values(nodeMap).find((n) => n.nodeId.startsWith(sel.nodeId));
    }
    if (!node) continue;

    // If GPT-4o selected root node (no pages), fall back to ALL pages
    if (!node.pageRefs || node.pageRefs.length === 0) {
      console.log(`[Query] Node "${node.title}" has no pages — falling back to all leaf pages`);
      const leafPages = await getAllLeafPages(docId, nodeMap);
      allPages.push(...leafPages);
      nodeInfo.push(`"${node.title}" (all pages)`);
    } else {
      const pages = await getPagesForNode(docId, node);
      allPages.push(...pages);
      nodeInfo.push(`"${node.title}"`);
    }
  }

  const seen = new Set();
  const uniquePages = allPages
    .filter((p) => { if (seen.has(p.pageNumber)) return false; seen.add(p.pageNumber); return true; })
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const answer = await generateAnswer(question, uniquePages, nodeInfo.join(", "));

  return {
    answer,
    pagesUsed: uniquePages.map((p) => p.pageNumber),
    nodesConsulted: selectedNodes.map((n) => ({ nodeId: n.nodeId, reason: n.reason })),
    reasoning: selectedNodes.map((n) => n.reason),
  };
}

async function getPage(docId, pageNumber) {
  const page = await Page.findOne({ docId, pageNumber }).lean();
  if (!page) throw new Error(`Page ${pageNumber} not found in document ${docId}`);
  return page;
}

async function getTree(docId) {
  const meta = await DocumentMeta.findOne({ docId }).lean();
  if (!meta) throw new Error(`Document ${docId} not found`);
  const nodeMap = await loadTree(docId);
  return { meta, tree: treeToText(nodeMap, meta.rootNodeId), nodeMap };
}

module.exports = { queryDocument, getPage, getTree };