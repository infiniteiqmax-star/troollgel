
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

function isQuestion(query) {
  const q = cleanText(query).toLowerCase();

  // An explicit question mark normally signals a question,
  // unless it is clearly asking for recommendations.
  if (isRecommendationSearch(q)) return false;

  return (
    q.endsWith("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|explain|tell me)\b/i.test(q)
  );
}

function isRecommendationSearch(query) {
  const q = cleanText(query).toLowerCase();

  const patterns = [
    /\btop\s*\d*\b/,
    /\bbest\b/,
    /\b\d+\s+(best|top)\b/,
    /\brecommend(?:ation|ations|ed)?\b/,
    /\bnear me\b/,
    /\bwhere to eat\b/,
    /\bplaces to visit\b/,
    /\bthings to do\b/,
    /\brestaurants?\b/,
    /\bburgers?\b/,
    /\bfast food\b/,
    /\bpizzas?\b/,
    /\bhotels?\b/,
    /\bvegan\b/,
    /\bvegetarian\b/,
    /\bshops?\b/,
    /\bproducts?\b/,
    /\bbuy\b/,
    /\bshopping\b/,
    /\blose weight\b/,
    /\bweight loss\b/,
    /\bweight-loss\b/,
    /\bhow to lose\b/,
    /\bways to lose\b/,
    /\bworkout plan\b/,
    /\btraining plan\b/,
    /\bexercise routine\b/,
    /\bmeal plan\b/,
    /\bhealthy diet\b/,
    /\bget fit\b/,
    /\blearn poker\b/,
    /\bbest way to\b/,
    /\bhow to\b/,
    /\bguide to\b/,
    /\btips for\b/,
    /\bideas for\b/,
    /\balternatives to\b/,
    /\bcompare\b/,
    /\bvs\.?\b/
  ];

  return patterns.some(pattern => pattern.test(q));
}

function getLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž-]*(?:\s+[A-Za-zÀ-ž][A-Za-zÀ-ž-]*){0,3})/i
  );

  return match ? cleanText(match[1]) : "";
}

function makeSearchQueries(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  // Burger searches redirect to vegan alternatives.
  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return [
      `vegan restaurants${where} menus`,
      `vegan burgers${where}`,
      `plant based restaurants${where}`
    ];
  }

  // Pizza searches redirect to vegan alternatives.
  if (/\bpizzas?\b/.test(q)) {
    return [
      `vegan restaurants${where} menus`,
      `plant based restaurants${where}`
    ];
  }

  // Vegan and vegetarian searches.
  if (/\b(vegan|vegetarian)\b/.test(q)) {
    return [
      `${query} restaurants menus`,
      `vegan restaurants${where} official websites`
    ];
  }

  // Keep the original topic for health, fitness and advice.
  // These are informational searches, not troll questions.
  if (
    /\b(lose weight|weight loss|weight-loss|how to lose|ways to lose|workout|training plan|exercise routine|meal plan|healthy diet|get fit|sleep better|stress management)\b/.test(q)
  ) {
    return [query, `${query} evidence based advice`];
  }

  // General recommendation searches should retain their topic.
  if (/\b(restaurant|restaurants|where to eat|food)\b/.test(q)) {
    return [
      query,
      `alternative restaurants${where} menus`
    ];
  }

  // For other recommendations, search the original query.
  return [query];
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
      max_results: 10,
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
        snippet: cleanText(item.content || item.snippet).slice(0, 240)
      };
    })
    .filter(item => item.url);
}

async function searchMultiple(queries) {
  const batches = await Promise.all(
    queries.map(async query => {
      try {
        console.log("WEB SEARCH:", query);
        return await tavilySearch(query);
      } catch (error) {
        console.error("SEARCH FAILED:", query, error.message);
        return [];
      }
    })
  );

  const seen = new Set();
  const combined = [];

  for (const results of batches) {
    for (const item of results) {
      const key = item.url
        .replace(/\/+$/, "")
        .split("?")[0]
        .toLowerCase();

      if (!key || seen.has(key)) continue;

      seen.add(key);
      combined.push(item);
    }
  }

  return combined;
}

function rankResults(results, query) {
  const q = cleanText(query).toLowerCase();
  const isBurgerSearch = /\b(burger|burgers|fast food)\b/.test(q);
  const isVeganSearch = /\b(vegan|plant-based|plant based)\b/.test(q);
  const isRestaurantSearch =
    /\b(restaurant|restaurants|food|pizza|burger|burgers|vegan|vegetarian)\b/.test(q);

  const articleTerms = [
    "personal blog",
    "my favourite",
    "my favorite",
    "blog for travelling",
    "blog for traveling"
  ];

  return results
    .map((item, index) => {
      const text =
        `${item.title} ${item.snippet} ${item.url}`.toLowerCase();

      let score = 0;

      if (/\b(official website|official site|menu|menus|opening hours|address|location)\b/.test(text)) {
        score += 2;
      }

      if (/\b(ljubljana|slovenia|new york)\b/.test(text)) {
        score += 3;
      }

      if (/\b(restaurant|restavracija|bistro|cafe|kavarna)\b/.test(text)) {
        score += 3;
      }

      if (isVeganSearch && /\b(vegan|plant-based|plant based)\b/.test(text)) {
        score += 4;
      }

      if (isBurgerSearch && /\b(vegan|plant-based|plant based)\b/.test(text)) {
        score += 6;
      }

      if (isBurgerSearch && /\b(gluten-free|gluten free|celiac|coeliac)\b/.test(text)) {
        score -= 4;
      }

      if (articleTerms.some(term => text.includes(term))) {
        score -= 3;
      }

      if (isRestaurantSearch && /\b(restaurant guide|where to eat)\b/.test(text)) {
        score += 1;
      }

      return { item, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 10)
    .map(entry => entry.item);
}

async function askOpenAI(instructions, input, maxTokens = 150) {
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
    console.error("OPENAI ERROR:", JSON.stringify(data.error));
    throw new Error(data.error?.message || "OpenAI request failed.");
  }

  let output = cleanText(data.output_text);

  if (!output && Array.isArray(data.output)) {
    for (const item of data.output) {
      for (const content of item.content || []) {
        if (content.type === "output_text") {
          output += " " + content.text;
        }
      }
    }
  }

  output = cleanText(output);

  if (!output) {
    throw new Error("OpenAI returned no text.");
  }

  return output;
}

async function createTrollAnswer(query) {
  const instructions = `
You are TROOLLgel, a parody search engine.

Give one short, funny, absurd, deadpan sentence.
Do not provide a normal factual explanation.
Do not include links, lists, markdown, or sources.
Keep it concise and original.

Example:
"What is gravity?"
"Gravity is Earth's clingy way of saying, 'No running off with the furniture.'"

For medical, dangerous, criminal, self-harm or other high-risk topics,
do not give harmful advice. Safety comes first.
`;

  return askOpenAI(
    instructions,
    `USER QUESTION: ${query}`,
    120
  );
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

  /*
   * Recommendation searches always show links only.
   * Never add a troll comment to a list or recommendation search.
   */
  if (isRecommendationSearch(query)) {
    let results = [];

    const queries = makeSearchQueries(query);
    results = await searchMultiple(queries);
    results = rankResults(results, query);

    return res.json({
      mode: "results",
      count: String(results.length),
      answer: "",
      results
    });
  }

  /*
   * Simple factual questions show only a troll answer.
   */
  if (isQuestion(query)) {
    try {
      const answer = await createTrollAnswer(query);

      return res.json({
        mode: "answer",
        count: "0",
        answer,
        contraResults: [],
        results: []
      });
    } catch (error) {
      console.error("TROLL ANSWER FAILED:", error.message);

      return res.json({
        mode: "answer",
        count: "0",
        answer: "The answer has gone missing. It may be hiding behind a suspiciously confident search engine.",
        contraResults: [],
        results: []
      });
    }
  }

  /*
   * Anything else is treated as a normal web search.
   */
  try {
    const results = await tavilySearch(query);

    return res.json({
      mode: "results",
      count: String(results.length),
      answer: "",
      results
    });
  } catch (error) {
    console.error("SEARCH FAILED:", error.message);

    return res.status(500).json({
      error: "Search is temporarily unavailable. Please try again."
    });
  }
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
