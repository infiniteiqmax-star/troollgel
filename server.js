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
You are the search intelligence behind TROOLLgel.

TROOLLgel looks like a normal search engine, but its results should be
cleaner, smarter and slightly unpredictable.

Your job is to take the raw web search results and turn them into a useful
search result page.

CRITICAL RULE:
Relevance matters more than simply returning every source.

A source is relevant only if it actually helps answer or understand the
user's query.

Do NOT return a source merely because one word from the query appears in it.

For every search, choose between:

1. "answer"
Use this when the user is asking a factual question, explanation, definition,
comparison, or something that naturally deserves a direct answer.

2. "results"
Use this when the user is searching for a website, page, product, news,
place, person, service, resource, or when links are more useful than an answer.

ANSWER MODE:

When using "answer":

- Give a concise answer, normally 1-3 sentences.
- Answer the actual question directly.
- Use the supplied sources whenever they contain relevant information.
- If the supplied sources do NOT directly answer the question, do not pretend
  that they do.
- Do not invent facts from the sources.
- Do not invent citations or URLs.
- Only include sources that are genuinely relevant to the answer.
- Prefer 2-4 strong sources rather than filling space.

RESULT MODE:

When using "results":

- Return only the most relevant sources.
- Normally return 4-6 results.
- Never return irrelevant sources just to reach a number.
- Keep the original URL exactly as supplied.
- Keep the original title when possible.
- Rewrite the snippet into a short, clean search-engine-style description.
- A snippet should normally be 1-2 sentences and roughly 20-45 words.
- Remove author biographies, navigation menus, page indexes, repeated text,
  "###", tracking text, reading times, editorial information and other junk.
- Do not copy huge sections of the source.
- Do not fabricate information.

VERY IMPORTANT:

You may ONLY use URLs that appear in the supplied WEB SOURCES.

Never create a URL yourself.

The user's query is:

${query}

The supplied web sources are:

${sourceText}

Return ONLY valid JSON.

Use exactly this structure:

{
  "mode": "answer" or "results",
  "answer": "string or empty string",
  "results": [
    {
      "title": "string",
      "url": "exact URL from supplied sources",
      "snippet": "short clean description"
    }
  ]
}

Do not include markdown.
Do not include explanations outside the JSON.
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
          content: `Search query: ${query}`
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

function validateAIResults(aiResults, originalResults) {
  if (!Array.isArray(aiResults)) {
    return [];
  }

  const originalByUrl = new Map(
    originalResults.map((r) => [r.url, r])
  );

  return aiResults
    .map((item) => {
      if (!item || !item.url) {
        return null;
      }

      const original = originalByUrl.get(cleanText(item.url));

      if (!original) {
        return null;
      }

      return {
        title: cleanText(item.title) || original.title,
        url: original.url,
        snippet: cleanText(item.snippet)
          .slice(0, 500)
      };
    })
    .filter((item) => item && item.title && item.url && item.snippet);
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
    // STEP 1 — Search the real web
    const webResults = await tavilySearch(query);

    if (!webResults.length) {
      return res.json({
        mode: "results",
        count: "0",
        answer: "",
        results: []
      });
    }

    // STEP 2 — Let the AI clean, rank and present the results
    let ai;

    try {
      ai = await askOpenAI(query, webResults);
    } catch (aiError) {
      console.error("AI presentation error:", aiError);

      // If AI fails, the real web search still works.
      return res.json({
        mode: "results",
        count: String(webResults.length),
        answer: "",
        results: webResults.map((r) => ({
          ...r,
          snippet: r.snippet.slice(0, 350)
        }))
      });
    }

    const mode = ai.mode === "answer"
      ? "answer"
      : "results";

    const cleanAIResults = validateAIResults(
      ai.results,
      webResults
    );

    if (mode === "answer" && cleanText(ai.answer)) {
      return res.json({
        mode: "answer",
        count: String(webResults.length),
        answer: cleanText(ai.answer),
        results: cleanAIResults.slice(0, 4)
      });
    }

    return res.json({
      mode: "results",
      count: String(webResults.length),
      answer: "",
      results: cleanAIResults.length
        ? cleanAIResults.slice(0, 6)
        : webResults.slice(0, 6).map((r) => ({
            ...r,
            snippet: r.snippet.slice(0, 350)
          }))
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
