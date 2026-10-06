
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

function isLocalRestaurantQuery(query) {
  return /\b(burger|burgers|fast food|pizza|restaurant|restaurants|where to eat|vegan|vegetarian)\b/i
    .test(query);
}

function isRecommendationSearch(query) {
  const q = cleanText(query).toLowerCase();

  const patterns = [
    /\btop\s*\d*\b/,
    /\bbest\b/,
    /\b10\s+best\b/,
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
    /\bbuy\b/,
    /\bproducts?\b/
  ];

  return patterns.some(pattern => pattern.test(q));
}

function isSimpleQuestion(query) {
  const q = cleanText(query).toLowerCase();

  if (isRecommendationSearch(q)) {
    return false;
  }

  return (
    q.endsWith("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|explain|tell me)\b/i
      .test(q)
  );
}

function getLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž-]*(?:\s+[A-Za-zÀ-ž][A-Za-zÀ-ž-]*){0,3})/i
  );

  return match ? cleanText(match[1]) : "";
}

function makeAlternativeQuery(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return [
      `vegan restaurants${where} official websites menus`,
      `vegan burgers${where} restaurant menu`,
      `plant based restaurants${where}`
    ];
  }

  if (/\bpizza\b/.test(q)) {
    return [
      `vegan restaurants${where} official websites menus`,
      `plant based restaurants${where}`
    ];
  }

  if (/\b(vegan|vegetarian)\b/.test(q)) {
    return [
      `vegan restaurants${where} official websites menus`,
      `vegetarian restaurants${where} menus`
    ];
  }

  if (/\b(restaurant|restaurants|where to eat|food)\b/.test(q)) {
    return [
      `vegetarian restaurants${where} official websites menus`,
      `vegan restaurants${where} menus`
    ];
  }

  return [];
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
        snippet: cleanText(item.content || item.snippet).slice(0, 220)
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
  const restaurantQuery = isLocalRestaurantQuery(q);
  const burgerQuery = /\b(burger|burgers|fast food)\b/.test(q);

  const articleTerms = [
    "travel blog",
    "food blog",
    "my favourite",
    "my favorite",
    "things to do",
    "travel guide",
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

      if (/\b(ljubljana|slovenia)\b/.test(text)) {
        score += 3;
      }

      if (/\b(restaurant|restavracija|bistro|cafe|kavarna)\b/.test(text)) {
        score += 3;
      }

      if (/\b(vegan|plant-based|plant based)\b/.test(text)) {
        score += 5;
      }

      if (burgerQuery && /\b(gluten-free|gluten free|celiac|coeliac)\b/.test(text)) {
        score -= 5;
      }

      if (articleTerms.some(term => text.includes(term))) {
        score -= 4;
      }

      if (restaurantQuery && /\b(list of restaurants|restaurant guide|where to eat)\b/.test(text)) {
        score += 1;
      }

      return { item, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map(entry => entry.item);
}

async function askOpenAI(instructions, input, maxTokens = 180) {
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

Answer with one short, absurd, funny, deadpan sentence.
Do not give a normal factual explanation.
Do not include links, lists, markdown or search results.
Keep it witty and concise.

Example:
"What is gravity?"
"Gravity is Earth's way of keeping everything from wandering off,
including your dignity."

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
   * Recommendation and list searches:
   * show links only, never a troll comment.
   */
  if (isRecommendationSearch(query)) {
    let results = [];

    const alternativeQueries = makeAlternativeQuery(query);

    if (alternativeQueries.length > 0) {
      results = await searchMultiple(alternativeQueries);
      results = rankResults(results, alternativeQueries.join(" "));
    }

    /*
     * If no alternative query applies or no alternatives were found,
     * search the original query.
     */
    if (results.length === 0) {
      try {
        results = await tavilySearch(query);
      } catch (error) {
        console.error("ORIGINAL SEARCH FAILED:", error.message);
      }
    }

    return res.json({
      mode: "results",
      count: String(results.length),
      answer: "",
      results
    });
  }

  /*
   * Simple factual questions:
   * return only the troll answer, with no links.
   */
  if (isSimpleQuestion(query)) {
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
   * Other searches:
   * return ordinary web results.
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
