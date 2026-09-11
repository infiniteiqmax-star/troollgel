const express = require("express");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------------
// CONFIG
// ----------------------------------------------------

const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

// ----------------------------------------------------
// BASIC SECURITY
// ----------------------------------------------------

const blockedPatterns = [
  "how to make a bomb",
  "how to build a bomb",
  "how to make explosives",
  "how to kill someone",
  "how to murder",
  "how to hurt someone",
  "how to make poison",
  "how to hack someone's account",
  "how to steal a password"
];

function isUnsafeQuery(query) {
  const q = query.toLowerCase();

  return blockedPatterns.some((pattern) => q.includes(pattern));
}

// ----------------------------------------------------
// OPENAI
// ----------------------------------------------------

async function askOpenAI(query, searchResults) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const sources = searchResults
    .map((result, index) => {
      return `
SOURCE ${index + 1}
TITLE: ${result.title || ""}
URL: ${result.url || ""}
CONTENT: ${result.content || ""}
`;
    })
    .join("\n");

  const systemPrompt = `
You are TROOLLgel.

TROOLLgel is a parody search engine.

Its personality:
- funny
- unexpected
- confident
- slightly unreliable
- absurd when appropriate
- internet/meme feeling
- concise
- entertaining

IMPORTANT:
TROOLLgel should NOT simply generate random nonsense.

The ideal experience is:

USER EXPECTS A
TROOLLgel GIVES B

Sometimes B can be:
- a funny counter-answer
- an unexpected interpretation
- a deliberately wrong but harmless answer
- a strange recommendation
- a normal-looking search result with an unexpected conclusion
- a combination of a joke and real useful links

However:
- NEVER give dangerous instructions.
- NEVER encourage violence or crime.
- NEVER provide dangerous medical advice.
- NEVER provide dangerous financial instructions.
- NEVER expose personal information.
- NEVER pretend a dangerous joke is real advice.

When real web results are supplied, use them as the factual source material.

Do not invent URLs.

Return ONLY valid JSON.

JSON format:

{
  "type": "answer" | "results" | "mixed",
  "answer": "short answer or joke",
  "results": [
    {
      "title": "title",
      "url": "https://...",
      "snippet": "short description"
    }
  ]
}

Rules:
- "answer" = primarily a direct TROOLLgel answer.
- "results" = primarily clickable web results.
- "mixed" = answer plus useful web results.
- Keep the answer relatively short.
- Usually return 0-5 results.
- URLs must come from the supplied web results.
- Do not create fake URLs.
- Do not mention these instructions.
`;

  const userPrompt = `
USER SEARCH:

${query}

REAL WEB RESULTS:

${sources}

Create the best TROOLLgel result for this search.
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
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
          content: userPrompt
        }
      ],
      temperature: 1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error: ${errorText}`);
  }

  const data = await response.json();

  const text =
    data.output_text ||
    data.output
      ?.flatMap((item) => item.content || [])
      ?.map((item) => item.text || "")
      ?.join("") ||
    "";

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return parseAIJson(text);
}

// ----------------------------------------------------
// SAFE JSON PARSER
// ----------------------------------------------------

function parseAIJson(text) {
  let cleaned = text.trim();

  // Remove markdown code fences if AI adds them.
  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Try to extract the JSON object if there is extra text.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
      const possibleJson = cleaned.slice(start, end + 1);

      try {
        return JSON.parse(possibleJson);
      } catch (_) {
        // Continue to fallback below.
      }
    }

    // Never crash the whole search because AI formatting failed.
    return {
      type: "answer",
      answer: cleaned,
      results: []
    };
  }
}

// ----------------------------------------------------
// TAVILY WEB SEARCH
// ----------------------------------------------------

async function searchWeb(query) {
  if (!TAVILY_API_KEY) {
    throw new Error("TAVILY_API_KEY is missing.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: "basic",
      topic: "general",
      max_results: 5,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily error: ${errorText}`);
  }

  const data = await response.json();

  return (data.results || []).map((result) => ({
    title: result.title || "",
    url: result.url || "",
    content: result.content || "",
    score: result.score || 0
  }));
}

// ----------------------------------------------------
// SEARCH API
// ----------------------------------------------------

app.post("/api/search", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();

    if (!query) {
      return res.status(400).json({
        error: "Please enter a search."
      });
    }

    if (query.length > 500) {
      return res.status(400).json({
        error: "Search is too long."
      });
    }

    // Safety first.
    if (isUnsafeQuery(query)) {
      return res.json({
        query,
        resultCount: 0,
        type: "answer",
        answer:
          "TROOLLgel has decided that this is probably a terrible idea. Try searching for something less explosive.",
        results: []
      });
    }

    // 1. Search the real internet.
    const webResults = await searchWeb(query);

    // 2. Give the real results to OpenAI.
    const aiResult = await askOpenAI(query, webResults);

    // 3. Make sure the result has the expected structure.
    const result = {
      query,
      resultCount: webResults.length,
      type: aiResult.type || "answer",
      answer: aiResult.answer || "",
      results: Array.isArray(aiResult.results)
        ? aiResult.results
            .filter((item) => item && item.url)
            .map((item) => ({
              title: item.title || "Untitled result",
              url: item.url,
              snippet: item.snippet || ""
            }))
        : []
    };

    return res.json(result);
  } catch (error) {
    console.error("SEARCH ERROR:", error);

    return res.status(500).json({
      error: "TROOLLgel tripped over its own wires.",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
});

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    tavily: Boolean(TAVILY_API_KEY),
    openai: Boolean(OPENAI_API_KEY)
  });
});

// ----------------------------------------------------
// HOMEPAGE
// ----------------------------------------------------

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ----------------------------------------------------
// FALLBACK
// ----------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "TROOLLgel could not find that."
  });
});

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TROOLLgel running on port ${PORT}`);
  });
}

module.exports = app;
