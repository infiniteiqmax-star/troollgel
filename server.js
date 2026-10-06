```js
const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getLocation(query) {
  const match = query.match(/\b(?:in|near|around)\s+(.+)$/i);
  return match ? match[1].replace(/[?!.,]+$/, "").trim() : "";
}

function classifyQuery(query) {
  const q = query.toLowerCase();
  const location = getLocation(query);

  if (/\b(burgers?|hamburgers?)\b/.test(q)) {
    return { type: "links", search: "vegan burger restaurants", location };
  }

  if (/\bpizzas?\b/.test(q)) {
    return { type: "links", search: "vegan pizza restaurants", location };
  }

  if (/\b(hotels?|hoteli|accommodation)\b/.test(q)) {
    return { type: "links", search: "campsites and camping grounds", location };
  }

  if (/\b(steakhouse|steak|meat restaurants?)\b/.test(q)) {
    return { type: "links", search: "vegan vegetarian restaurants", location };
  }

  if (/\bvegan\b/.test(q)) {
    return { type: "links", search: "traditional meat restaurants", location };
  }

  if (/\b(top\s+\d+|best|recommend|restaurants?|cafes?|bars|things to do|places to visit|near me)\b/.test(q)) {
    return { type: "links", search: "unusual alternative places and activities", location };
  }

  return { type: "answer" };
}

async function getTrollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        "You are TROOLLgel, a funny, absurd parody search engine.",
        "Respond to the user's question with a short, clever troll answer.",
        "Do not provide the real factual answer.",
        "Do not provide links or lists.",
        "Keep the response harmless and concise."
      ].join(" "),
      input: query,
      max_output_tokens: 120
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI API error:", data);
    throw new Error("OpenAI request failed");
  }

  const answer = clean(data.output_text);

  if (!answer) {
    throw new Error("OpenAI returned no answer");
  }

  return answer;
}

async function getOppositeLinks(query, searchQuery, location) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("Missing TAVILY_API_KEY environment variable");
  }

  const fullQuery = [searchQuery, location].filter(Boolean).join(" ");

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: fullQuery,
      search_depth: "advanced",
      topic: "general",
      max_results: 10,
      include_answer: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Tavily API error:", data);
    throw new Error("Tavily search failed");
  }

  const seen = new Set();

  return (Array.isArray(data.results) ? data.results : [])
    .map(item => ({
      title: clean(item.title),
      url: clean(item.url),
      snippet: clean(item.content || item.snippet)
    }))
    .filter(item => {
      if (!item.title || !item.url) return false;

      try {
        const url = new URL(item.url);

        if (!["http:", "https:"].includes(url.protocol)) return false;
        if (seen.has(url.href)) return false;

        seen.add(url.href);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 10);
}

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    app: "TROOLLgel"
  });
});

app.post("/api/search", async (req, res) => {
  const query = clean(req.body && req.body.query);

  if (!query) {
    return res.status(400).json({ error: "Please enter a search query." });
  }

  if (query.length > 500) {
    return res.status(400).json({ error: "Search query is too long." });
  }

  const intent = classifyQuery(query);

  if (intent.type === "links") {
    try {
      const results = await getOppositeLinks(
        query,
        intent.search,
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
      console.error("Link search failed:", error.message);

      return res.status(502).json({
        error: "TROOLLgel could not find links right now. Check the search API configuration."
      });
    }
  }

  try {
    const answer = await getTrollAnswer(query);

    return res.status(200).json({
      mode: "answer",
      count: "0",
      answer,
      results: [],
      contraResults: []
    });
  } catch (error) {
    console.error("Troll answer failed:", error.message);

    return res.status(200).json({
      mode: "answer",
      count: "0",
      answer: "Our answer engine has gone for a coffee. It refuses to explain where.",
      results: [],
      contraResults: []
    });
  }
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error." });
});

module.exports = app;

// Local development only; Vercel imports the app above.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`TROOLLgel running on port ${PORT}`);
  });
}
```
