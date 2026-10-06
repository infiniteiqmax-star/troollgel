const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_URL = "https://api.openai.com/v1/responses";
const TAVILY_URL = "https://api.tavily.com/search";

/*
 * TROOLLgel server.js
 *
 * POST /api/search { "query": "..." }
 *
 * Environment variables:
 * OPENAI_API_KEY
 * OPENAI_MODEL
 * TAVILY_API_KEY
 */

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getLocation(query) {
  const q = cleanText(query);
  const patterns = [
    /\b(?:in|near|around|at)\s+([A-ZÀ-Ž][\p{L}.'’-]*(?:\s+[A-ZÀ-Ž][\p{L}.'’-]*){0,3})/u,
    /\b(?:v|blizu|okoli)\s+([A-ZČŠŽ][\p{L}.'’-]*(?:\s+[A-ZČŠŽ][\p{L}.'’-]*){0,3})/u
  ];

  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[?.!,;:]+$/, "").trim();
    }
  }

  return "";
}

/* -----------------------------
   SEARCH INTENT
----------------------------- */

function isRecommendationSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(best|top\s*\d*|\d+\s+best|recommend(?:ation|ations)?|near me|where to eat|restaurants?|burgers?|fast food|pizzas?|hotels?|accommodation|things to do|places to visit|attractions|buy|shopping|products?|compare|comparison|najboljši|najboljše|priporoči|restavracije|burgerji|picerije|hoteli|kaj početi|znamenitosti)\b/i.test(q);
}

function isAdviceSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(how to lose|how do i|how can i|ways to lose|tips for|guide to|workout plan|training plan|exercise routine|meal plan|healthy diet|lose weight|weight loss|weight-loss|improve my|learn to|how to start|how to get better|kako shujšati|kako izgubiti težo|nasveti za|vadbeni načrt|trening za|kako izboljšati)\b/i.test(q);
}

function isSimpleFactQuestion(query) {
  const q = cleanText(query).toLowerCase();

  if (isRecommendationSearch(q) || isAdviceSearch(q)) {
    return false;
  }

  return (
    /^(what is|what are|why is|why are|why do|how does|how do|when did|when is|who is|who was|can dogs|can humans|explain|kaj je|kaj so|zakaj|kako deluje|kdo je|kdaj je)\b/i.test(q) ||
    q.endsWith("?")
  );
}

/* -----------------------------
   ALTERNATIVE QUERIES
----------------------------- */

function makeAlternativeQueries(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  if (/\b(burger|burgers|fast food|burgerji|hitra prehrana)\b/i.test(q)) {
    return [
      `vegan burger restaurants${where}`,
      `vegan restaurants${where}`,
      `plant based restaurants${where}`
    ];
  }

  if (/\b(pizza|pizzas|picerija|picerije)\b/i.test(q)) {
    return [
      `vegan pizza restaurants${where}`,
      `vegetarian restaurants${where}`,
      `plant based restaurants${where}`
    ];
  }

  if (/\b(restaurant|restaurants|where to eat|food|restavracija|restavracije|kje jesti|hrana)\b/i.test(q)) {
    return [
      `vegan restaurants${where}`,
      `vegetarian restaurants${where}`,
      `plant based food${where}`
    ];
  }

  if (/\b(hotel|hotels|accommodation|nastanitev|nastanitve)\b/i.test(q)) {
    return [
      `guesthouses and apartments${where}`,
      `hostels and budget accommodation${where}`,
      `camping and alternative accommodation${where}`
    ];
  }

  if (/\b(lose weight|weight loss|weight-loss|diet|calorie|shujšati|hujšanje|dieta|kalorije)\b/i.test(q)) {
    return [
      "reliable resources on intuitive eating and relationship with food",
      "evidence based resources on sustainable health habits",
      "body image wellbeing and body neutrality resources"
    ];
  }

  if (/\b(workout|training plan|exercise routine|fitness|gym|vadba|trening|fitnes|telovadnica)\b/i.test(q)) {
    return [
      "outdoor activities and recreational sports",
      "mobility and everyday movement resources",
      "beginner friendly exercise alternatives"
    ];
  }

  if (/\b(travel|vacation|holiday|things to do|places to visit|attractions|potovanje|počitnice|kaj početi|znamenitosti)\b/i.test(q)) {
    return [
      `unusual local experiences${where}`,
      `parks museums and local activities${where}`,
      `lesser known attractions${where}`
    ];
  }

  return [
    `${query} alternative perspectives`,
    `${query} myths and misconceptions`,
    `${query} research and resources`
  ];
}

/* -----------------------------
   WEB SEARCH
----------------------------- */

async function tavilySearch(query, maxResults = 6) {
  if (!process.env.TAVILY_API_KEY) {
    console.warn("TAVILY_API_KEY is not configured; web search is unavailable.");
    return [];
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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error("TAVILY ERROR:", response.status, JSON.stringify(data));
    return [];
  }

  return (Array.isArray(data.results) ? data.results : [])
    .map(item => {
      let url = "";

      try {
        const parsed = new URL(item.url);

        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          url = parsed.href;
        }
      } catch {}

      return {
        title: cleanText(item.title) || "Search result",
        url,
        snippet: cleanText(item.content || item.snippet).slice(0, 320)
      };
    })
    .filter(item => item.url && item.title);
}

function mergeResults(batches, limit = 8) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const results = [];

  for (const batch of batches) {
    for (const item of batch) {
      const urlKey = item.url
        .split("?")[0]
        .replace(/\/+$/, "")
        .toLowerCase();

      const titleKey = item.title
        .toLowerCase()
        .replace(/[^a-z0-9čšžà-ž]+/gi, " ")
        .trim();

      if (
        !urlKey ||
        seenUrls.has(urlKey) ||
        !titleKey ||
        seenTitles.has(titleKey)
      ) {
        continue;
      }

      seenUrls.add(urlKey);
      seenTitles.add(titleKey);

      results.push({
        title: item.title,
        url: item.url,
        snippet: item.snippet
      });

      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}

async function searchAlternatives(queries) {
  const batches = await Promise.all(
    queries.map(async query => {
      try {
        console.log("ALTERNATIVE SEARCH:", query);
        return await tavilySearch(query, 5);
      } catch (error) {
        console.error("ALTERNATIVE SEARCH FAILED:", query, error.message);
        return [];
      }
    })
  );

  return mergeResults(batches, 8);
}

/* -----------------------------
   TROLL ANSWER
----------------------------- */

function fallbackTrollAnswer(query) {
  const q = cleanText(query).toLowerCase();

  if (/\b(gravity|gravitation|gravitacija)\b/.test(q)) {
    return "Gravity is Earth's clingy way of saying, 'No running off with the furniture.'";
  }

  if (/\b(burger|burgers|burgerji)\b/.test(q)) {
    return "The burgers have formed a union and are demanding better buns before revealing their location.";
  }

  if (/\b(lose weight|weight loss|weight-loss|diet|calorie|shujšati|hujšanje)\b/.test(q)) {
    return "The bathroom scale has declared independence and now weighs everyone emotionally.";
  }

  if (/\b(pizza|picerija|picerije)\b/.test(q)) {
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
Return exactly ONE short, absurd, witty, deadpan joke relevant to the user's search.
Do not answer the question normally. Do not give advice, instructions, facts, lists, or recommendations.
Do not add explanations after the joke. Keep it harmless and do not mock protected or vulnerable groups.
For health-related topics, do not give medical advice or encourage harmful behavior.
Return only the joke.
`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input: `USER SEARCH: ${query}`,
        max_output_tokens: 100
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("OPENAI ERROR:", response.status, JSON.stringify(data));
      return fallbackTrollAnswer(query);
    }

    let answer = cleanText(data.output_text);

    if (!answer && Array.isArray(data.output)) {
      for (const item of data.output) {
        for (const content of item.content || []) {
          if (content.type === "output_text") {
            answer += ` ${content.text}`;
          }
        }
      }
    }

    answer = cleanText(answer);

    if (!answer) {
      return fallbackTrollAnswer(query);
    }

    const advicePattern = /\b(you should|you can|try to|try |remember to|the best way|it is important|here are|start by|make sure|aim to|focus on|eat less|exercise more|consult a doctor)\b/i;

    if (advicePattern.test(answer)) {
      return fallbackTrollAnswer(query);
    }

    return answer;
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);
    return fallbackTrollAnswer(query);
  }
}

/* -----------------------------
   API ENDPOINT
----------------------------- */

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
    // Simple factual question: joke only, no links.
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

    // Recommendation search: troll joke + alternative links.
    if (isRecommendationSearch(query)) {
      const [answer, results] = await Promise.all([
        trollAnswer(query),
        searchAlternatives(makeAlternativeQueries(query))
      ]);

      return res.json({
        mode: "answer",
        count: String(results.length),
        answer,
        results,
        contraResults: results
      });
    }

    // Advice search: joke + alternative links.
    if (isAdviceSearch(query)) {
      const [answer, results] = await Promise.all([
        trollAnswer(query),
        searchAlternatives(makeAlternativeQueries(query))
      ]);

      return res.json({
        mode: "answer",
        count: String(results.length),
        answer,
        results,
        contraResults: results
      });
    }

    // Ordinary search: real results only.
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

// Health endpoint for checking whether the server is alive.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "TROOLLgel"
  });
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
