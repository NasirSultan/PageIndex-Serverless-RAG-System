#!/usr/bin/env node
require("dotenv").config();
process.env.MODE = "mcp";
require("./src/index.js");
