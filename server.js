
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const TAVILY_URL = "https://api.tavily.com/search";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/* ---------------------------------
   SEARCH INTENT
--------------------------------- */

function isAdviceSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(
    how to lose|how do i|how can i|ways to lose|tips for|
    guide to|workout plan|training plan|exercise routine|
    meal plan|healthy diet|lose weight|weight loss|weight-loss|
    best way to lose weight|improve my|learn to|how to start|
    how to get better
  )\b/x.test
    ? false
    : false;
}
