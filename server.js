```js
const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const TAVILY_URL = "https://api.tavily.com/search";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near|around)\s+(.+?)\s*$/i
  );

  if (!match) return "";

  return match[1]
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+(with|for|and|that|where|which)\s+.*$/i, "")
    .trim();
}

function classifyQuery(query) {
  const q = cleanText(query).toLowerCase();
  const location = extractLocation(query);

  if (/\b(burgers?|hamburgers?)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "vegan restaurants vegan burgers",
      location
    };
  }

  if (/\bpizzas?\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "vegan restaurants vegan pizza",
      location
    };
  }

  if (/\b(meat|steak|steakhouse)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "vegan vegetarian restaurants",
      location
    };
  }

  if (/\bvegan\b|\bveganske?\b|\bveganski\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "traditional meat restaurants steakhouse",
      location
    };
  }

  if (/\b(hotels?|hoteli|hotelov|accommodation)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "campsites camping grounds",
      location
    };
  }

  if (/\b(luxury cars|supercars|sports cars)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "bicycle shops bicycles",
      location
    };
  }

  if (/\b(top\s+\d+|best|recommend|near me|things to do|places to visit|restaurants?|cafes?|bars|shops|flights?)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "alternative places and activities",
      location
    };
  }

  return { type: "answer" };
}

function safeResults(results) {
  const seen = new Set();

  return (Array.isArray(results) ? results : [])
    .map(item => ({
      title: cleanText(item?.title),
      url: cleanText(item?.url),
      snippet: cleanText(item?.content || item?.snippet)
    }))
    .filter(item => {
      if (!item.title || !item.url) return false;

      try {
        const url = new URL(item.url);

        if (!["http:", "https:"].includes(url.protocol)) {
          return false;
        }

        if (seen.has(url.href)) return false;

        seen.add(url.href);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 10);
}

async function tavilySearch(query, location = "") {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is missing.");
  }

  const fullQuery = location
    ? `${query} in ${location}`
    : query;

  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: fullQuery,
      search_depth: "advanced",
      topic: "general",
      max_results: 10,
      include_answer: false,
      include_raw_content: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("TAVILY ERROR:", data);
    throw new Error("Tavily search failed.");
  }

  return safeResults(data.results);
}

async function trollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: `
You are TROOLLgel, a parody search engine.
Reply with one short, clever, absurd joke about the user's question.
Never give the normal factual answer.
Do not provide links, lists, explanations or real instructions.
Return only the joke. Keep it harmless.
`,
      input: `USER QUESTION: ${query}`,
      max_output_tokens: 120
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OPENAI ERROR:", data?.error || data);
    throw new Error("OpenAI request failed.");
  }

  let answer = cleanText(data?.output_text);

  if (!answer && Array.isArray(data?.output)) {
    for (const item of data.output) {
      for (const content of item.content || []) {
        if (content.type === "output_text") {
          answer += ` ${content.text || ""}`;
        }
      }
    }
  }

  answer = cleanText(answer);

  if (!answer) {
    throw new Error("OpenAI returned an empty answer.");
  }

  return answer;
}

/*
 * HEALTH CHECK
 */
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    app: "TROOLLgel"
  });
});

/*
 * SEARCH
 */
app.post("/api/search", async (req, res) => {
  const query = cleanText(req.body?.query);

  if (!query) {
    return res.status(400).json({
      error: "Missing query"
    });
  }

  if (query.length > 500) {
    return res.status(400).json({
      error: "Query too long"
    });
  }

  const intent = classifyQuery(query);

  /*
   * LINK SEARCH:
   * Links only. No troll answer.
   */
  if (intent.type === "links") {
    try {
      const results = await tavilySearch(
        intent.searchQuery,
        intent.location
      );

      return res.status(200).json({
        mode: "results",
        count: String(results.length),
        answer: "",
        results,
        contraResults: results
      });
    } catch (error) {
      console.error("LINK SEARCH ERROR:", error.message);

      return res.status(502).json({
        error: "Search is temporarily unavailable. Please try again."
      });
    }
  }

  /*
   * QUESTION:
   * Troll answer only. No links.
   */
  try {
    const answer = await trollAnswer(query);

    return res.status(200).json({
      mode: "answer",
      count: "0",
      answer,
      results: [],
      contraResults: []
    });
  } catch (error) {
    console.error("TROLL ANSWER ERROR:", error.message);

    return res.status(200).json({
      mode: "answer",
      count: "0",
      answer: "The answer has gone on holiday. It left no forwarding address.",
      results: [],
      contraResults: []
    });
  }
});

/*
 * EXPORT EXPRESS APP FOR VERCEL
 */
module.exports = app;
```
