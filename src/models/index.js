const mongoose = require("mongoose");

const PageSchema = new mongoose.Schema(
  {
    docId: { type: String, required: true, index: true },
    pageNumber: { type: Number, required: true },
    content: { type: String, required: true },
    summary: { type: String, default: "" },
    charStart: { type: Number, default: 0 },
    charEnd: { type: Number, default: 0 },
  },
  { timestamps: true }
);
PageSchema.index({ docId: 1, pageNumber: 1 }, { unique: true });

const TreeNodeSchema = new mongoose.Schema(
  {
    docId: { type: String, required: true, index: true },
    nodeId: { type: String, required: true },
    parentId: { type: String, default: null },
    level: { type: Number, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    pageRefs: [{ type: Number }],
    children: [{ type: String }],
    path: { type: String, default: "" },
  },
  { timestamps: true }
);
TreeNodeSchema.index({ docId: 1, nodeId: 1 }, { unique: true });

const DocumentMetaSchema = new mongoose.Schema(
  {
    docId: { type: String, required: true, unique: true },
    filename: { type: String, required: true },
    totalPages: { type: Number, default: 0 },
    totalChars: { type: Number, default: 0 },
    rootNodeId: { type: String, default: null },
    status: {
      type: String,
      enum: ["processing", "ready", "error"],
      default: "processing",
    },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

const Page = mongoose.model("Page", PageSchema);
const TreeNode = mongoose.model("TreeNode", TreeNodeSchema);
const DocumentMeta = mongoose.model("DocumentMeta", DocumentMetaSchema);

module.exports = { Page, TreeNode, DocumentMeta };
