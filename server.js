```js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const TAVILY_URL = "https://api.tavily.com/search";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

        const normalized = url.href;

        if (seen.has(normalized)) return false;

        seen.add(normalized);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 10);
}

/*
 * REAL WEB SEARCH
 */
async function tavilySearch(query, location = "") {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not configured.");
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
    throw new Error("Web search failed.");
  }

  return safeResults(data.results);
}

/*
 * EXTRACT LOCATION FROM QUERIES SUCH AS:
 * "Top 10 burgers in New York"
 * "Best hotels in Paris"
 */
function extractLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near|around|at)\s+(.+?)\s*$/i
  );

  if (!match) return "";

  let location = match[1]
    .replace(/[?!.,]+$/g, "")
    .trim();

  location = location.replace(
    /^(the best|best|top\s+\d+|top)\s+/i,
    ""
  );

  const stopWords = [
    " with ",
    " for ",
    " and ",
    " that ",
    " where ",
    " which "
  ];

  for (const word of stopWords) {
    const index = location.toLowerCase().indexOf(word);

    if (index > 0) {
      location = location.slice(0, index).trim();
    }
  }

  return location;
}

/*
 * CLASSIFY SEARCH INTENT.
 *
 * LINK SEARCHES:
 * Return links only. NEVER generate a troll answer.
 *
 * QUESTIONS:
 * Return a troll answer only. NEVER return links.
 */
function classifyQuery(query) {
  const q = cleanText(query).toLowerCase();

  const location = extractLocation(query);

  // Burger searches -> vegan food
  if (/\b(burger|burgers|hamburger|hamburgers)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "vegan restaurants vegan burgers",
      location
    };
  }

  // Pizza searches -> vegan food
  if (/\bpizza(s)?\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "vegan restaurants vegan pizza",
      location
    };
  }

  // Meat searches -> vegetarian or vegan food
  if (/\b(meat|steak|steakhouse)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "vegan vegetarian restaurants",
      location
    };
  }

  // Vegan searches -> meat-focused restaurants
  if (/\bvegan\b|\bveganske?\b|\bveganski\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "traditional meat restaurants steakhouse",
      location
    };
  }

  // Hotel searches -> camping
  if (/\b(hotel|hotels|hoteli|hotelov)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "campsites camping grounds",
      location
    };
  }

  // Luxury cars -> bicycles
  if (/\b(luxury cars|supercars|sports cars)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "bicycles bicycle shops",
      location
    };
  }

  // Shopping for expensive items -> budget alternatives
  if (/\b(expensive|luxury|premium)\b/.test(q)) {
    return {
      type: "links",
      searchQuery: "cheap budget affordable alternatives",
      location
    };
  }

  // Recommendation and local searches not covered above
  const linkPatterns = [
    /\btop\s+\d+\b/,
    /\bbest\b/,
    /\brecommend(?:ation|ations)?\b/,
    /\bnear me\b/,
    /\bthings to do\b/,
    /\bplaces to visit\b/,
    /\brestaurants?\b/,
    /\bcafes?\b/,
    /\bbars\b/,
    /\bshops?\b/,
    /\bwhere can i buy\b/,
    /\bflights?\b/,
    /\bthings to see\b/
  ];

  if (linkPatterns.some(pattern => pattern.test(q))) {
    return {
      type: "links",
      searchQuery: "unexpected alternative places and activities",
      location
    };
  }

  // Everything else is treated as a question.
  return {
    type: "answer"
  };
}

/*
 * OPENAI REQUEST
 */
async function callOpenAI(instructions, input, maxTokens = 150) {
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
    console.error("OPENAI ERROR:", data?.error || data);
    throw new Error("OpenAI request failed.");
  }

  let text = cleanText(data?.output_text);

  if (!text && Array.isArray(data?.output)) {
    for (const item of data.output) {
      for (const content of item.content || []) {
        if (content.type === "output_text") {
          text += content.text || "";
        }
      }
    }
  }

  text = cleanText(text);

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text;
}

/*
 * TROLL ANSWER.
 * Used ONLY for question searches.
 */
async function trollAnswer(query) {
  const instructions = `
You are TROOLLgel, a parody search engine.

Give one short, clever, absurd, confidently wrong joke
about the user's question.

Do not provide the normal factual answer.
Do not provide links.
Do not provide a list.
Do not explain the joke.
Use one sentence, maximum two short sentences.
Do not repeat the question.
Keep the humor harmless.
Return only the joke.
`;

  return callOpenAI(
    instructions,
    `USER QUESTION: ${query}`,
    120
  );
}

/*
 * SEARCH ROUTE
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

  try {
    const intent = classifyQuery(query);

    /*
     * MODE 1: LINKS ONLY
     *
     * No OpenAI troll answer is generated here.
     * The response contains links and an empty answer.
     */
    if (intent.type === "links") {
      const results = await tavilySearch(
        intent.searchQuery,
        intent.location
      );

      return res.json({
        mode: "results",
        count: String(results.length),
        answer: "",
        results,
        contraResults: results
      });
    }

    /*
     * MODE 2: TROLL ANSWER ONLY
     *
     * No Tavily search is performed here.
     * The response contains a joke and no links.
     */
    let answer;

    try {
      answer = await trollAnswer(query);
    } catch (error) {
      console.error("TROLL ANSWER ERROR:", error.message);

      answer =
        "The answer has left the building. It claims the building was asking too many questions.";
    }

    return res.json({
      mode: "answer",
      count: "0",
      answer,
      results: [],
      contraResults: []
    });

  } catch (error) {
    console.error("SEARCH ERROR:", error);

    return res.status(500).json({
      error: "TROOLLgel tripped over its own wires."
    });
  }
});

/*
 * HEALTH CHECK
 */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "TROOLLgel"
  });
});

/*
 * START SERVER
 */
app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
```
