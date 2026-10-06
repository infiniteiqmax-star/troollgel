
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

function getLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž-]*(?:\s+[A-Za-zÀ-ž][A-Za-zÀ-ž-]*){0,3})/i
  );

  return match ? cleanText(match[1]) : "";
}

function isRecommendationSearch(query) {
  const q = cleanText(query).toLowerCase();

  return [
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
    /\bbest way to\b/,
    /\bhow to\b/,
    /\bguide to\b/,
    /\btips for\b/,
    /\bideas for\b/,
    /\bworkout plan\b/,
    /\btraining plan\b/,
    /\bexercise routine\b/,
    /\bmeal plan\b/,
    /\bhealthy diet\b/,
    /\bget fit\b/,
    /\blearn\b/,
    /\bcompare\b/,
    /\bvs\.?\b/
  ].some(pattern => pattern.test(q));
}

function isSimpleQuestion(query) {
  const q = cleanText(query);

  if (isRecommendationSearch(q)) {
    return false;
  }

  return (
    q.endsWith("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|explain|tell me)\b/i.test(q)
  );
}

function makeAlternativeQueries(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  // Burgers -> unexpected but relevant vegan alternatives.
  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return [
      `vegan restaurants${where} menus`,
      `vegan burgers${where}`,
      `plant based restaurants${where}`
    ];
  }

  // Pizza -> vegan alternatives in the requested location.
  if (/\bpizzas?\b/.test(q)) {
    return [
      `vegan restaurants${where} menus`,
      `plant based restaurants${where}`
    ];
  }

  // Food recommendations -> plant-based alternatives.
  if (/\b(restaurant|restaurants|where to eat|food|vegan|vegetarian)\b/.test(q)) {
    return [
      `vegan restaurants${where} menus`,
      `vegetarian restaurants${where} menus`
    ];
  }

  // Weight loss -> unexpected but relevant alternative perspectives,
  // not a conventional list of weight-loss tips.
  if (/\b(lose weight|weight loss|weight-loss|how to lose|ways to lose|best way to lose)\b/.test(q)) {
    return [
      "body neutrality and sustainable health habits from reputable health organizations",
      "healthy lifestyle habits sleep movement wellbeing reputable medical sources",
      "why crash diets fail sustainable health guidance medical organization"
    ];
  }

  // Fitness and training.
  if (/\b(workout|training plan|exercise routine|get fit|gym|fitness)\b/.test(q)) {
    return [
      "enjoyable physical activity ideas sustainable fitness official health guidance",
      "beginner strength training safe exercise reputable health organization",
      "walking mobility and everyday movement health benefits"
    ];
  }

  // General health or nutrition searches.
  if (/\b(health|healthy|diet|nutrition|meal plan|sleep|stress)\b/.test(q)) {
    return [
      "evidence based healthy lifestyle guidance reputable health organization",
      "sustainable wellbeing habits medical health source",
      "common health myths evidence based explanations"
    ];
  }

  // Travel recommendations.
  if (/\b(travel|holiday|vacation|things to do|places to visit|attractions)\b/.test(q)) {
    return [
      `unusual local experiences and cultural attractions${where}`,
      `local parks markets museums and free activities${where}`
    ];
  }

  // Products and shopping: show alternatives in the same category.
  if (/\b(buy|products?|shopping|laptop|computer|phone|headphones|shoes)\b/.test(q)) {
    return [
      `${query} alternatives comparison`,
      `${query} independent reviews`
    ];
  }

  // For other recommendation searches, find alternative perspectives
  // while retaining the topic and any explicit location.
  return [
    `${query} alternatives`,
    `${query} independent guide`
  ];
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
  const location = getLocation(query).toLowerCase();
  const burgerSearch = /\b(burger|burgers|fast food)\b/.test(q);
  const foodSearch = /\b(restaurant|restaurants|food|pizza|burger|burgers|vegan|vegetarian)\b/.test(q);
  const weightSearch = /\b(lose weight|weight loss|weight-loss|how to lose|ways to lose)\b/.test(q);

  return results
    .map((item, index) => {
      const text = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
      let score = 0;

      if (location && text.includes(location)) score += 5;

      if (foodSearch && /\b(restaurant|restavracija|bistro|cafe|kavarna|menu)\b/.test(text)) {
        score += 3;
      }

      if (burgerSearch && /\b(vegan|plant-based|plant based)\b/.test(text)) {
        score += 5;
      }

      if (weightSearch && /\b(crash diet|body neutrality|wellbeing|well-being|sustainable|health organization|medical)\b/.test(text)) {
        score += 2;
      }

      if (/\b(official website|official site|menu|menus|opening hours|address|location)\b/.test(text)) {
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

async function createTrollAnswer(query, hasLinks) {
  const instructions = `
You are TROOLLgel, a parody search engine.
Your personality is absurd, witty, mischievous, and deadpan.

Always respond with a short, original troll comment.
Never give a normal, direct answer or ordinary helpful advice.
Do not reveal the normal answer to the user's question.
Do not use markdown or numbered lists.
Keep it to one or two sentences.

If the query is about a practical topic such as health, fitness, travel,
food, products, or recommendations, make a playful joke about the topic.
Do not shame the user or encourage dangerous behavior.

${hasLinks
  ? "The response will appear above alternative web links. Make a funny comment about the request, not a summary of the links."
  : "There will be no web links. The troll sentence must stand on its own."}

Example:
Question: What is gravity?
Answer: Gravity is Earth's clingy way of saying, "No running off with the furniture."

Question: 10 best burgers in Ljubljana
Answer: Ljubljana's burgers have entered witness protection after the pickles exposed the secret sauce.

For medical or high-risk topics, do not give harmful instructions.
Still use harmless humor where appropriate.
`;

  try {
    return await askOpenAI(instructions, `USER SEARCH: ${query}`, 120);
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);
    return "TROOLLgel has reached a conclusion. Probably. The search committee is currently arguing with a suspicious sandwich.";
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

  /*
   * Recommendation searches:
   * troll comment PLUS alternative links.
   */
  if (isRecommendationSearch(query)) {
    const trollPromise = createTrollAnswer(query, true);

    let results = [];

    try {
      const alternativeQueries = makeAlternativeQueries(query);
      results = await searchMultiple(alternativeQueries);

      // If alternative searches fail, fall back to the original query.
      if (results.length === 0) {
        results = await tavilySearch(query);
      }

      results = rankResults(results, query);
    } catch (error) {
      console.error("RECOMMENDATION SEARCH FAILED:", error.message);
    }

    const answer = await trollPromise;

    return res.json({
      mode: "answer",
      count: String(results.length),
      answer,
      contraResults: results,
      results
    });
  }

  /*
   * Simple questions:
   * troll answer only, without web links.
   */
  if (isSimpleQuestion(query)) {
    const answer = await createTrollAnswer(query, false);

    return res.json({
      mode: "answer",
      count: "0",
      answer,
      contraResults: [],
      results: []
    });
  }

  /*
   * Other searches:
   * troll comment plus relevant web results.
   */
  let results = [];

  try {
    results = await tavilySearch(query);
  } catch (error) {
    console.error("GENERAL SEARCH FAILED:", error.message);
  }

  const answer = await createTrollAnswer(query, results.length > 0);

  return res.json({
    mode: "answer",
    count: String(results.length),
    answer,
    contraResults: results,
    results
  });
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
