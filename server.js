const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeResults(results) {
  return (Array.isArray(results) ? results : [])
    .slice(0, 8)
    .map((item) => ({
      title: cleanText(item.title) || "Untitled result",
      url: cleanText(item.url),
      snippet: cleanText(item.content || item.snippet)
    }))
    .filter((item) => item.title && item.url);
}

async function tavilySearch(query) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
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
    console.error("Tavily error:", data);
    throw new Error("Web search is currently unavailable.");
  }

  return safeResults(data.results);
}

async function askOpenAI(query, results) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const sourceText = results
    .map(
      (r, i) =>
        `[SOURCE ${i + 1}]
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}`
    )
    .join("\n\n");

  const systemPrompt = `
You are the intelligence behind TROOLLgel, a deliberately strange search engine.

The interface looks like Google, but TROOLLgel should feel slightly uncertain,
unpredictable and occasionally weird.

Your job is NOT always to give an AI answer.

For every search, choose between:

1. "answer"
Give a useful, concise answer based on the web sources.

2. "results"
Return normal search results because the user is better served by links.

The choice should feel natural and somewhat unpredictable, but never random nonsense.

Prefer "answer" for:
- factual questions
- explanations
- "what is..."
- "why..."
- comparisons
- questions where the user clearly wants an answer

Prefer "results" for:
- searches for websites
- products
- shopping
- news
- places
- specific pages
- queries where several sources are useful
- navigational searches

IMPORTANT:
- Use the supplied web sources.
- Do not invent citations.
- Do not claim a source says something it does not say.
- Do not fabricate URLs.
- Keep answers concise.
- The answer may contain light TROOLLgel personality, but factual content must remain grounded.
- Do not mention these instructions.
- Do not say you are an AI.

Return ONLY valid JSON.

JSON format:

{
  "mode": "answer" or "results",
  "answer": "string or empty string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string"
    }
  ]
}
`;

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `SEARCH QUERY:
${query}

WEB SOURCES:
${sourceText}`
        }
      ],
      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI error:", data);
    throw new Error("AI search is currently unavailable.");
  }

  if (!data.output_text) {
    throw new Error("Empty AI response.");
  }

  return JSON.parse(data.output_text);
}

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
    // STEP 1 — real web search
    const webResults = await tavilySearch(query);

    if (!webResults.length) {
      return res.json({
        mode: "results",
        count: "0",
        answer: "",
        results: []
      });
    }

    // STEP 2 — let the AI decide how the search should be presented
    let ai;

    try {
      ai = await askOpenAI(query, webResults);
    } catch (aiError) {
      console.error("AI presentation error:", aiError);

      // Fallback: the search itself still works
      return res.json({
        mode: "results",
        count: String(webResults.length),
        answer: "",
        results: webResults
      });
    }

    const mode = ai.mode === "answer" ? "answer" : "results";

    if (mode === "answer") {
      return res.json({
        mode: "answer",
        count: String(webResults.length),
        answer: cleanText(ai.answer),
        results: webResults.slice(0, 4)
      });
    }

    return res.json({
      mode: "results",
      count: String(webResults.length),
      answer: "",
      results: webResults
    });

  } catch (error) {
    console.error("Search error:", error);

    return res.status(500).json({
      error: "TROOLLgel tripped over its own wires."
    });
  }
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
