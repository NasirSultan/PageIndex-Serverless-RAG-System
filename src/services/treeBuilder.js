const { llm } = require("../utils/llm");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { v4: uuidv4 } = require("uuid");
const { Page, TreeNode, DocumentMeta } = require("../models");

const PAGE_SIZE = 1500;

function splitIntoPages(text) {
  const pages = [];
  let cursor = 0;
  let pageNum = 1;
  while (cursor < text.length) {
    let end = Math.min(cursor + PAGE_SIZE, text.length);
    if (end < text.length) {
      const slice = text.slice(cursor, end + 200);
      const sentenceEnd = slice.search(/(?<=[.!?])\s/);
      if (sentenceEnd > 0 && sentenceEnd < PAGE_SIZE + 150) {
        end = cursor + sentenceEnd + 1;
      }
    }
    pages.push({
      pageNumber: pageNum++,
      content: text.slice(cursor, end).trim(),
      charStart: cursor,
      charEnd: end,
    });
    cursor = end;
  }
  return pages;
}

async function summarizePage(content) {
  const response = await llm.invoke([
    new SystemMessage(
      "You are a document analyst. Write a concise 1-2 sentence summary of what topics this text covers. Reply with only the summary, no preamble."
    ),
    new HumanMessage(`Text:\n\n${content.slice(0, 2000)}`),
  ]);
  return response.content.trim();
}

async function generateTocStructure(pages) {
  const pageList = pages.map((p) => `[Page ${p.pageNumber}]: ${p.summary}`).join("\n");
  const response = await llm.invoke([
    new SystemMessage(
      `You are a document indexing expert. Given page summaries, create a hierarchical Table of Contents tree.
Return ONLY a valid JSON array. Each node must have:
- "title": string
- "summary": string (1-2 sentences)
- "pages": array of page numbers
- "children": array of child nodes (can be empty)
Rules: group related pages into logical sections, max 3 levels deep, every page in exactly one leaf node.`
    ),
    new HumanMessage(`Total pages: ${pages.length}\n\nPage summaries:\n${pageList}\n\nReturn only the JSON array.`),
  ]);

  let raw = response.content.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(raw);
  } catch (e) {
    const chunkSize = Math.ceil(pages.length / 5);
    const fallback = [];
    for (let i = 0; i < pages.length; i += chunkSize) {
      const chunk = pages.slice(i, i + chunkSize);
      fallback.push({
        title: `Section ${Math.floor(i / chunkSize) + 1}`,
        summary: `Pages ${chunk[0].pageNumber} to ${chunk[chunk.length - 1].pageNumber}`,
        pages: chunk.map((p) => p.pageNumber),
        children: [],
      });
    }
    return fallback;
  }
}

async function storeTreeNode(node, docId, parentId, level, path) {
  const nodeId = uuidv4();
  const childIds = [];
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childId = await storeTreeNode(child, docId, nodeId, level + 1, `${path}/${node.title}`);
      childIds.push(childId);
    }
  }
  await TreeNode.create({
    docId,
    nodeId,
    parentId,
    level,
    title: node.title,
    summary: node.summary,
    pageRefs: node.pages || [],
    children: childIds,
    path: path || "/",
  });
  return nodeId;
}

async function indexDocument(docId, filename, text) {
  await DocumentMeta.findOneAndUpdate({ docId }, { status: "processing" }, { upsert: true });

  try {
    console.log(`[Index] Splitting into pages...`);
    const rawPages = splitIntoPages(text);
    console.log(`[Index] ${rawPages.length} pages`);

    console.log(`[Index] Summarizing pages...`);
    const pagesWithSummaries = [];
    for (let i = 0; i < rawPages.length; i++) {
      process.stdout.write(`  Page ${i + 1}/${rawPages.length}\r`);
      const summary = await summarizePage(rawPages[i].content);
      pagesWithSummaries.push({ ...rawPages[i], summary });
    }
    console.log(`\n[Index] Pages summarized`);

    await Page.deleteMany({ docId });
    await Page.insertMany(
      pagesWithSummaries.map((p) => ({
        docId,
        pageNumber: p.pageNumber,
        content: p.content,
        summary: p.summary,
        charStart: p.charStart,
        charEnd: p.charEnd,
      }))
    );

    console.log(`[Index] Building ToC tree...`);
    const tocTree = await generateTocStructure(pagesWithSummaries);

    await TreeNode.deleteMany({ docId });
    const rootId = uuidv4();
    const rootChildIds = [];
    for (const node of tocTree) {
      const childId = await storeTreeNode(node, docId, rootId, 1, "/");
      rootChildIds.push(childId);
    }

    const rootSummaryRes = await llm.invoke([
      new SystemMessage("Summarize the entire document in 2-3 sentences. Reply with only the summary."),
      new HumanMessage(tocTree.map((n) => n.summary).join("\n")),
    ]);

    await TreeNode.create({
      docId,
      nodeId: rootId,
      parentId: null,
      level: 0,
      title: filename,
      summary: rootSummaryRes.content.trim(),
      pageRefs: [],
      children: rootChildIds,
      path: "/",
    });

    await DocumentMeta.findOneAndUpdate(
      { docId },
      { filename, totalPages: rawPages.length, totalChars: text.length, rootNodeId: rootId, status: "ready", errorMessage: null },
      { upsert: true }
    );

    console.log(`[Index] Done. Root: ${rootId}`);
    return { docId, rootNodeId: rootId, totalPages: rawPages.length };
  } catch (err) {
    await DocumentMeta.findOneAndUpdate({ docId }, { status: "error", errorMessage: err.message }, { upsert: true });
    throw err;
  }
}

module.exports = { indexDocument };
