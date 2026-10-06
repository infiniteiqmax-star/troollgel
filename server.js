
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

function safeResults(results) {
  return (Array.isArray(results) ? results : [])
    .slice(0, 8)
    .map(item => ({
      title: cleanText(item?.title) || "Search result",
      url: cleanText(item?.url),
      snippet: cleanText(item?.content || item?.snippet)
    }))
    .filter(item => {
      try {
        const url = new URL(item.url);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    });
}

async function tavilySearch(query) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "advanced",
      topic: "general",
      max_results: 8,
      include_answer: false,
      include_raw_content: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("TAVILY ERROR:", JSON.stringify(data));
    throw new Error("Web search failed.");
  }

  return safeResults(data.results);
}

async function askOpenAI(instructions, input, maxTokens = 200) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions,
      input,
      max_output_tokens: maxTokens
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OPENAI ERROR:", JSON.stringify(data?.error));
    throw new Error(data?.error?.message || "OpenAI request failed.");
  }

  let text = cleanText(data?.output_text);

  if (!text && Array.isArray(data?.output)) {
    for (const item of data.output) {
      for (const content of item?.content || []) {
        if (content?.type === "output_text") {
          text += " " + content.text;
        }
      }
    }
  }

  text = cleanText(text);

  if (!text) {
    throw new Error("OpenAI returned no text.");
  }

  return text;
}

/*
 * Decide which searches should get a joke and alternative links.
 */
function shouldShowTrollAnswer(query) {
  const q = cleanText(query).toLowerCase();

  const patterns = [
    "what ", "why ", "how ", "when ", "where ", "who ",
    "which ", "can ", "could ", "would ", "should ",
    "is ", "are ", "do ", "does ", "did ", "will ",
    "has ", "have ", "explain ", "tell me ",
    "best ", "top ", "recommend", "near me",
    "things to do", "places to visit",
    "restaurant", "restaurants", "burger", "burgers",
    "fast food", "hotel", "hotels", "pizza",
    "buy ", "shopping", "travel", "vacation",
    "lose weight", "weight loss", "recipe", "recipes"
  ];

  return q.endsWith("?") || patterns.some(p => q.includes(p));
}

/*
 * Only practical searches receive alternative web results.
 * Simple factual questions get a joke without links.
 */
function shouldShowCounterLinks(query) {
  const q = cleanText(query).toLowerCase();

  const patterns = [
    "best ", "top ", "recommend", "near me",
    "in ljubljana", "in slovenia", "restaurant",
    "burger", "fast food", "pizza", "hotel",
    "flight", "travel", "vacation", "holiday",
    "recipe", "shopping", "buy ", "things to do",
    "places to visit", "where to eat", "lose weight",
    "weight loss", "how to ", "how do i", "how can i"
  ];

  return patterns.some(p => q.includes(p));
}

/*
 * Deterministic backup: alternative searches still work
 * when OpenAI cannot suggest a counter-query.
 */
function fallbackCounterSearchQuery(query) {
  const q = cleanText(query).toLowerCase();

  const locationMatch = cleanText(query).match(
    /\b(?:in|near)\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,3})/i
  );

  const location = locationMatch
    ? ` in ${locationMatch[1]}`
    : "";

  if (/\b(burgers?|fast food)\b/.test(q)) {
    return `vegan and vegetarian restaurants${location}`;
  }

  if (/\bpizzas?\b/.test(q)) {
    return `vegetarian restaurants and healthy food${location}`;
  }

  if (/\b(hotels?|accommodation|places to stay)\b/.test(q)) {
    return `hostels and budget accommodation${location}`;
  }

  if (/\b(restaurants?|where to eat|food)\b/.test(q)) {
    return `vegetarian restaurants${location}`;
  }

  if (/\b(things to do|places to visit|travel|trip|vacation|holiday)\b/.test(q)) {
    return `free attractions and unusual places to visit${location}`;
  }

  if (/\b(lose weight|weight loss|how do i|how can i|how to)\b/.test(q)) {
    return "healthy practical tips and guides";
  }

  if (/\b(buy|buying|shop|shopping|best|top)\b/.test(q)) {
    return `budget friendly alternatives to ${cleanText(query)}`;
  }

  return "";
}

async function counterSearchQuery(query) {
  const instructions = `
You create alternative search queries for TROOLLgel, a parody search engine.

Return one short, useful, REAL web search query that deliberately redirects
the user toward a different but related subject.

Examples:
"10 best burgers in Ljubljana" -> "vegan restaurants in Ljubljana"
"best fast food in Ljubljana" -> "vegetarian restaurants in Ljubljana"
"best hotels in Paris" -> "cheap hostels in Paris"

For simple factual questions, return exactly NONE.
Return only the query. No quotes or explanation.
`;

  const result = await askOpenAI(
    instructions,
    `USER QUERY: ${query}`,
    100
  );

  if (result.toUpperCase() === "NONE") return "";

  const cleaned = result.replace(/^["']|["']$/g, "").trim();

  return cleaned.length <= 250 ? cleaned : "";
}

async function trollAnswer(query) {
  const instructions = `
You are TROOLLgel, a parody search engine.

Give ONE short, funny, absurd, confident answer.
Do not answer the user's question normally.
Use dry, deadpan humor and an unexpected twist.
Usually one sentence; maximum two short sentences.
No lists, markdown, explanations, sources, or real recommendations.

Examples of style:
"What is gravity?" -> "Gravity is the universe's clingy roommate."
"Can dogs fly?" -> "Dogs skipped the wing upgrade and got zoomies instead."
"10 best burgers in Ljubljana" -> "The city's burgers are currently negotiating bun-based diplomatic immunity."

Do not repeat these examples unless appropriate.
For medical, dangerous, criminal, self-harm or other high-risk topics,
do not give harmful advice. Safety comes first.
`;

  return askOpenAI(
    instructions,
    `USER QUERY: ${query}`,
    180
  );
}

app.post("/api/search", async (req, res) => {
  const query = cleanText(req.body?.query);

  if (!query) {
    return res.status(400).json({ error: "Missing query." });
  }

  if (query.length > 500) {
    return res.status(400).json({ error: "Query too long." });
  }

  let originalResults = [];

  try {
    originalResults = await tavilySearch(query);
  } catch (error) {
    console.error("ORIGINAL SEARCH FAILED:", error.message);
  }

  if (!shouldShowTrollAnswer(query)) {
    return res.json({
      mode: "results",
      count: String(originalResults.length),
      answer: "",
      results: originalResults
    });
  }

  let answer;

  try {
    answer = await trollAnswer(query);
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);

    answer = "The answer has gone missing. We suspect it was last seen arguing with a search engine.";
  }

  let contraResults = [];

  if (shouldShowCounterLinks(query)) {
    let counterQuery = "";

    try {
      counterQuery = await counterSearchQuery(query);
    } catch (error) {
      console.error("AI COUNTER QUERY FAILED:", error.message);
    }

    if (!counterQuery) {
      counterQuery = fallbackCounterSearchQuery(query);
    }

    console.log("COUNTER SEARCH QUERY:", counterQuery || "(none)");

    if (counterQuery) {
      try {
        contraResults = await tavilySearch(counterQuery);
      } catch (error) {
        console.error("COUNTER SEARCH FAILED:", error.message);
      }
    }
  }

  /*
   * IMPORTANT:
   * The current public/index.html reads data.contraResults.
   * Return that exact field so the alternative links render.
   */
  return res.json({
    mode: "answer",
    count: String(contraResults.length),
    answer,
    contraResults,
    results: contraResults
  });
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
