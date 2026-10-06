
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

function isAdviceSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(how to lose|how do i|how can i|ways to lose|tips for|guide to|workout plan|training plan|exercise routine|meal plan|healthy diet|lose weight|weight loss|weight-loss|best way to lose weight|improve my|learn to|how to start|how to get better)\b/.test(q);
}

function isRecommendationSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(best|top\s*\d*|\d+\s+best|recommend|recommendations|near me|where to eat|restaurants?|burgers?|fast food|pizzas?|hotels?|accommodation|things to do|places to visit|attractions|buy|shopping|products?|compare|comparison)\b/.test(q);
}

function isSimpleFactQuestion(query) {
  const q = cleanText(query).toLowerCase();

  if (isAdviceSearch(q) || isRecommendationSearch(q)) {
    return false;
  }

  return (
    q.endsWith("?") ||
    /^(what is|what are|why is|why are|why do|how does|how do|when did|when is|who is|who was|can dogs|can humans|explain)\b/.test(q)
  );
}

async function tavilySearch(query, maxResults = 10) {
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

function fallbackTrollAnswer(query) {
  const q = cleanText(query).toLowerCase();

  if (/\b(gravity|gravitation)\b/.test(q)) {
    return "Gravity is Earth's clingy way of saying, 'No running off with the furniture.'";
  }

  if (/\b(lose weight|weight loss|weight-loss|diet|calorie)\b/.test(q)) {
    return "The bathroom scale has declared independence and now weighs everyone emotionally.";
  }

  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return "The burgers have formed a union and are demanding better buns before revealing their location.";
  }

  if (/\bpizza\b/.test(q)) {
    return "The pizzas have gone undercover after a suspicious incident involving one very emotional pineapple.";
  }

  return "TROOLLgel has reached a conclusion. The conclusion has declined to comment and is wearing a tiny disguise.";
}

async function trollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackTrollAnswer(query);
  }

  const instructions = `
You are TROOLLgel, a parody search engine.

Return exactly ONE short, absurd, witty, deadpan joke related to the user's actual query.

Rules:
- Do not answer the question normally.
- Do not give real advice, instructions, tips or recommendations.
- Do not explain facts.
- Do not add a helpful sentence after the joke.
- Do not give a list.
- Return only the joke.
- Keep jokes harmless for sensitive or dangerous topics.
- Make the joke relevant to the exact topic.
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
        input: `USER SEARCH: ${query}`,
        max_output_tokens: 100
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "OpenAI request failed.");
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
      return fallbackTrollAnswer(query);
    }

    return answer;
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);
    return fallbackTrollAnswer(query);
  }
}

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
    // 1. Simple factual questions: joke only, no links.
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

    // 2. Advice searches: joke plus real results for the EXACT query.
    if (isAdviceSearch(query)) {
      const [answer, results] = await Promise.all([
        trollAnswer(query),
        tavilySearch(query, 10).catch(error => {
          console.error("SEARCH FAILED:", error.message);
          return [];
        })
      ]);

      return res.json({
        mode: "answer",
        count: String(results.length),
        answer,
        results,
        contraResults: results
      });
    }

    // 3. Recommendation searches: real results only.
    // Search the user's original words. Do not redirect to vegan,
    // vegetarian, body-neutrality or other unrelated topics.
    if (isRecommendationSearch(query)) {
      const results = await tavilySearch(query, 10);

      return res.json({
        mode: "results",
        count: String(results.length),
        answer: "",
        results,
        contraResults: []
      });
    }

    // 4. Everything else: ordinary web results only.
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
      error: "TROOLLgel tripped over its own wires."
    });
  }
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
