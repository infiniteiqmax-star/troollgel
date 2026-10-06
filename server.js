

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

// Only simple factual questions get a troll answer.
// Recommendations and how-to searches get real results.
function isSimpleFactQuestion(query) {
  const q = cleanText(query).toLowerCase();

  // Never troll practical searches or recommendations.
  if (
    /\b(best|top\s*\d*|\d+\s+best|recommend|recommendations|near me|where to eat|restaurant|restaurants|burger|burgers|pizza|hotel|hotels|accommodation|things to do|places to visit|buy|shopping|how to|how do i|how can i|ways to|tips for|guide to|lose weight|weight loss|weight-loss|diet|workout plan|training plan|exercise routine|meal plan|healthy diet)\b/.test(q)
  ) {
    return false;
  }

  return (
    /^(what is|what are|why is|why are|why do|how does|how do|when did|when is|who is|who was|can dogs|can humans|explain)\b/.test(q) ||
    q.endsWith("?")
  );
}

/* ---------------------------------
   TAVILY SEARCH
--------------------------------- */

async function tavilySearch(query, maxResults = 10) {
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
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("TAVILY ERROR:", JSON.stringify(data));
    throw new Error("Web search failed.");
  }

  return (Array.isArray(data.results) ? data.results : [])
    .map(item => {
      let url = "";

      try {
        const parsed = new URL(item.url);

        if (["http:", "https:"].includes(parsed.protocol)) {
          url = parsed.href;
        }
      } catch {
        url = "";
      }

      return {
        title: cleanText(item.title) || "Search result",
        url,
        snippet: cleanText(item.content || item.snippet).slice(0, 320)
      };
    })
    .filter(item => item.url && item.title);
}

/* ---------------------------------
   TROLL ANSWER
--------------------------------- */

async function trollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackTrollAnswer(query);
  }

  const instructions = `
You are TROOLLgel, a parody search engine.

Return exactly ONE short, absurd, witty, deadpan joke.

Rules:
- Do not answer the question normally.
- Do not give advice, instructions, tips or recommendations.
- Do not explain facts.
- Do not add a helpful sentence after the joke.
- Do not give a list.
- Make the joke relevant to the exact question.
- Keep the joke harmless.
- Return only the joke.

Example:
Question: What is gravity?
Answer: Gravity is Earth's clingy way of saying, "No running off with the furniture."
`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions,
        input: `USER QUESTION: ${query}`,
        max_output_tokens: 100
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message || "OpenAI request failed."
      );
    }

    let answer = cleanText(data.output_text);

    if (!answer && Array.isArray(data.output)) {
      for (const item of data.output) {
        for (const content of item.content || []) {
          if (content.type === "output_text") {
            answer += " " + content.text;
          }
        }
      }
    }

    answer = cleanText(answer);

    if (!answer) {
      throw new Error("Empty troll response.");
    }

    return answer;
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);
    return fallbackTrollAnswer(query);
  }
}

function fallbackTrollAnswer(query) {
  const q = cleanText(query).toLowerCase();

  if (/\b(gravity|gravitation)\b/.test(q)) {
    return "Gravity is Earth's clingy way of saying, 'No running off with the furniture.'";
  }

  if (/\b(dog|dogs)\b/.test(q)) {
    return "Dogs can fly, but only when nobody is looking and the snacks are sufficiently motivating.";
  }

  if (/\b(sky|blue)\b/.test(q)) {
    return "The sky is blue because the ocean keeps sending it unsolicited color suggestions.";
  }

  return "TROOLLgel has reached a conclusion. The conclusion has declined to comment and is wearing a tiny disguise.";
}

/* ---------------------------------
   API ENDPOINT
--------------------------------- */

app.post("/api/search", async (req, res) => {
  const query = cleanText(req.body?.query);

  if (!query) {
    return res.status(400).json({
      error: "Please enter a search query."
    });
  }

  if (query.length > 500) {
    return res.status(400).json({
      error: "Search query is too long."
    });
  }

  try {
    // CASE 1:
    // Simple factual questions -> troll answer only.
    if (isSimpleFactQuestion(query)) {
      const answer = await trollAnswer(query);

      return res.json({
        mode: "answer",
        count: "0",
        answer,
        results: [],
        contraResults: []
      });
    }

    // CASE 2:
    // All other searches -> real results for the exact query.
    // This includes burgers, restaurants, recommendations,
    // weight loss, health information and how-to searches.
    const results = await tavilySearch(query, 10);

    return res.json({
      mode: "results",
      count: String(results.length),
      answer: "",
      results,
      contraResults: []
    });
  } catch (error) {
    console.error("SEARCH ERROR:", error);

    return res.status(500).json({
      error: "TROOLLgel could not complete the search. Please try again."
    });
  }
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
