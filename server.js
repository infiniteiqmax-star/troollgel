
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

function safeResults(results) {
  return (Array.isArray(results) ? results : [])
    .slice(0, 10)
    .map(item => ({
      title: cleanText(item?.title) || "Search result",
      url: cleanText(item?.url),
      snippet: cleanText(item?.content || item?.snippet)
    }))
    .filter(item => {
      try {
        const url = new URL(item.url);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    });
}

async function tavilySearch(query) {
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

  return safeResults(data.results);
}

async function askOpenAI(instructions, input, maxTokens = 200) {
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
    console.error("OPENAI ERROR:", JSON.stringify(data?.error));
    throw new Error(data?.error?.message || "OpenAI request failed.");
  }

  let output = cleanText(data?.output_text);

  if (!output && Array.isArray(data?.output)) {
    for (const item of data.output) {
      for (const content of item?.content || []) {
        if (content?.type === "output_text") {
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

function shouldShowTrollAnswer(query) {
  const q = cleanText(query).toLowerCase();

  const patterns = [
    "what ", "why ", "how ", "when ", "where ", "who ",
    "which ", "can ", "could ", "would ", "should ",
    "is ", "are ", "do ", "does ", "did ", "will ",
    "has ", "have ", "explain ", "tell me ",
    "best ", "top ", "recommend", "near me",
    "things to do", "places to visit",
    "restaurant", "restaurants", "burger", "burgers",
    "fast food", "hotel", "hotels", "pizza",
    "buy ", "shopping", "travel", "vacation",
    "lose weight", "weight loss", "recipe", "recipes"
  ];

  return q.endsWith("?") || patterns.some(p => q.includes(p));
}

function shouldShowCounterLinks(query) {
  const q = cleanText(query).toLowerCase();

  const patterns = [
    "best ", "top ", "recommend", "near me",
    "in ljubljana", "in slovenia", "restaurant",
    "burger", "fast food", "pizza", "hotel",
    "flight", "travel", "vacation", "holiday",
    "recipe", "shopping", "buy ", "things to do",
    "places to visit", "where to eat", "lose weight",
    "weight loss", "how to ", "how do i", "how can i"
  ];

  return patterns.some(p => q.includes(p));
}

function fallbackCounterSearchQuery(query) {
  const q = cleanText(query).toLowerCase();

  const locationMatch = cleanText(query).match(
    /\b(?:in|near)\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,3})/i
  );

  const location = locationMatch ? locationMatch[1].trim() : "";
  const where = location ? ` ${location}` : "";

  if (/\b(burgers?|fast food)\b/.test(q)) {
    return `vegan restaurants${where} official websites menus`;
  }

  if (/\bpizzas?\b/.test(q)) {
    return `vegan restaurants${where} menus`;
  }

  if (/\b(vegan|vegetarian)\b/.test(q) &&
      /\b(restaurants?|food|eat)\b/.test(q)) {
    return `vegan restaurants${where} official website menu`;
  }

  if (/\b(hotels?|accommodation|places to stay)\b/.test(q)) {
    return `budget hostels and accommodation${where} official websites`;
  }

  if (/\b(restaurants?|where to eat|food)\b/.test(q)) {
    return `vegetarian restaurants${where} official websites menus`;
  }

  if (/\b(things to do|places to visit|travel|trip|vacation|holiday)\b/.test(q)) {
    return `free attractions and places to visit${where} official websites`;
  }

  if (/\b(lose weight|weight loss|how do i|how can i|how to)\b/.test(q)) {
    return "healthy practical tips and guides";
  }

  return `useful alternatives to ${cleanText(query)}`;
}

async function counterSearchQuery(query) {
  const instructions = `
You create alternative web search queries for a parody search engine.

Return exactly ONE short web search query that redirects the user
toward a different but related and useful subject.

Examples:
"10 best burgers in Ljubljana" ->
"vegan restaurants in Ljubljana official websites menus"

"best fast food in Ljubljana" ->
"vegetarian restaurants in Ljubljana official websites"

"best hotels in Paris" ->
"budget hostels in Paris official websites"

Rules:
- Preserve the location in the original query.
- Restaurant searches should find actual restaurants, their official
  websites, menus, or directories listing actual venues.
- For burger searches, prefer vegan restaurants over burger rankings,
  gluten-free listings, generic food articles, and travel blogs.
- Avoid broad blog articles.
- For simple factual questions, return exactly NONE.
- Return only the query, without quotes or explanation.
`;

  const result = await askOpenAI(
    instructions,
    `USER QUERY: ${query}`,
    100
  );

  if (result.toUpperCase() === "NONE") {
    return "";
  }

  const cleaned = result.replace(/^["']|["']$/g, "").trim();

  return cleaned.length <= 250 ? cleaned : "";
}

async function trollAnswer(query) {
  const instructions = `
You are TROOLLgel, a parody search engine.

Give ONE short, funny, absurd, confident answer.
Use dry, deadpan humor and an unexpected twist.
Usually one sentence; maximum two short sentences.
Do not give normal search results or real recommendations.
Do not use lists, markdown, explanations, or sources.

Example:
"What is gravity?" ->
"Gravity is the universe's clingy roommate."

"Can dogs fly?" ->
"Dogs skipped the wing upgrade and got zoomies instead."

Do not repeat the examples unless appropriate.
For medical, dangerous, criminal, self-harm or other high-risk
topics, do not give harmful advice. Safety comes first.
`;

  return askOpenAI(
    instructions,
    `USER QUERY: ${query}`,
    180
  );
}

function rankCounterResults(results, query) {
  const q = cleanText(query).toLowerCase();

  const isBurgerSearch =
    /\b(burger|burgers|fast food)\b/.test(q);

  const isVeganSearch =
    /\b(vegan|vegan restaurants)\b/.test(q);

  const isRestaurantSearch =
    /\b(restaurant|restaurants|vegan|vegetarian|burger|burgers|pizza|food|where to eat)\b/.test(q);

  const articleTerms = [
    "travel blog",
    "personal blog",
    "my favourite",
    "my favorite",
    "things to do",
    "travel guide",
    "food blog",
    "blog for travelling",
    "blog for traveling"
  ];

  const scored = results.map((item, index) => {
    const text =
      `${item.title} ${item.snippet} ${item.url}`.toLowerCase();

    let score = 0;

    if (/\b(ljubljana|slovenia)\b/.test(text)) {
      score += 3;
    }

    if (/\b(restaurant|restavracija|bistro|cafe|kavarna)\b/.test(text)) {
      score += 3;
    }

    if (/\b(official website|menu|menus|opening hours|address|location|reservation)\b/.test(text)) {
      score += 2;
    }

    if (isVeganSearch && /\b(vegan|plant-based|plant based)\b/.test(text)) {
      score += 5;
    }

    if (isBurgerSearch && /\b(gluten-free|gluten free|celiac|coeliac)\b/.test(text)) {
      score -= 5;
    }

    if (isBurgerSearch && /\b(vegan|plant-based|plant based)\b/.test(text)) {
      score += 6;
    }

    if (articleTerms.some(term => text.includes(term))) {
      score -= 5;
    }

    if (isRestaurantSearch &&
        /\b(list of restaurants|restaurants guide|where to eat)\b/.test(text)) {
      score += 1;
    }

    return { item, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map(({ item }) => ({
      title: item.title,
      url: item.url,
      snippet: cleanText(item.snippet).slice(0, 220)
    }));
}

app.post("/api/search", async (req, res) => {
  const query = cleanText(req.body?.query);

  if (!query) {
    return res.status(400).json({ error: "Missing query." });
  }

  if (query.length > 500) {
    return res.status(400).json({ error: "Query too long." });
  }

  let originalResults = [];

  try {
    originalResults = await tavilySearch(query);
  } catch (error) {
    console.error("ORIGINAL SEARCH FAILED:", error.message);
  }

  if (!shouldShowTrollAnswer(query)) {
    return res.json({
      mode: "results",
      count: String(originalResults.length),
      answer: "",
      results: originalResults
    });
  }

  let answer;

  try {
    answer = await trollAnswer(query);
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);

    answer =
      "The answer has gone missing. We suspect it was last seen arguing with a search engine.";
  }

  let contraResults = [];

  if (shouldShowCounterLinks(query)) {
    let counterQuery = "";

    try {
      counterQuery = await counterSearchQuery(query);
    } catch (error) {
      console.error("AI COUNTER QUERY FAILED:", error.message);
    }

    if (!counterQuery) {
      counterQuery = fallbackCounterSearchQuery(query);
    }

    console.log("COUNTER SEARCH QUERY:", counterQuery || "(none)");

    if (counterQuery) {
      try {
        contraResults = await tavilySearch(counterQuery);
        contraResults = rankCounterResults(contraResults, counterQuery);
      } catch (error) {
        console.error("COUNTER SEARCH FAILED:", error.message);
      }
    }
  }

  return res.json({
    mode: "answer",
    count: String(contraResults.length),
    answer,
    contraResults,
    results: contraResults
  });
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
