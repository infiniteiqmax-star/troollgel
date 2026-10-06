
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
   LOCATION
--------------------------------- */

function getLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž.'-]*(?:\s+[A-Za-zÀ-ž][A-Za-zÀ-ž.'-]*){0,3})/i
  );

  if (!match) return "";

  return match[1]
    .replace(/[?.!,]+$/, "")
    .trim();
}

/* ---------------------------------
   SEARCH INTENT

   1. Simple factual questions:
      troll answer only.

   2. Recommendation searches:
      alternative links only.

   3. Advice/how-to searches:
      troll answer + alternative links.

   4. Everything else:
      normal search results.
--------------------------------- */

function isRecommendationSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(best|top\s*\d*|\d+\s+best|recommend|recommendations|near me|where to eat|restaurants?|burgers?|fast food|pizzas?|hotels?|accommodation|things to do|places to visit|attractions|buy|shopping|products?|compare|comparison)\b/.test(q);
}

function isAdviceSearch(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(how to lose|how do i|how can i|ways to lose|tips for|guide to|workout plan|training plan|exercise routine|meal plan|healthy diet|lose weight|weight loss|weight-loss|improve my|learn to|how to start|how to get better)\b/.test(q);
}

function isSimpleFactQuestion(query) {
  const q = cleanText(query).toLowerCase();

  if (isRecommendationSearch(q) || isAdviceSearch(q)) {
    return false;
  }

  return (
    q.endsWith("?") ||
    /^(what is|what are|why is|why are|why do|how does|how do|when did|when is|who is|who was|can dogs|can humans|explain)\b/.test(q)
  );
}

/* ---------------------------------
   ALTERNATIVE SEARCH QUERIES

   Recommendation searches show links
   only, without a troll answer.

   Alternatives should be related to
   the original topic and location.
--------------------------------- */

function makeAlternativeQueries(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  // Burgers -> vegan/plant-based options
  // in the same city, not the original burger list.
  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return [
      `vegan burger restaurants${where}`,
      `vegan restaurants with burgers${where}`,
      `plant based restaurants${where}`
    ];
  }

  // Pizza -> vegan alternatives in the same location.
  if (/\bpizzas?\b/.test(q)) {
    return [
      `vegan pizza restaurants${where}`,
      `vegan restaurants${where}`,
      `plant based restaurants${where}`
    ];
  }

  // Other restaurant searches.
  if (/\b(restaurant|restaurants|where to eat|food)\b/.test(q)) {
    return [
      `vegan restaurants${where}`,
      `vegetarian restaurants${where}`,
      `plant based food${where}`
    ];
  }

  // Advice about weight loss: alternative perspectives.
  if (/\b(lose weight|weight loss|weight-loss|diet|calorie)\b/.test(q)) {
    return [
      "intuitive eating and relationship with food",
      "evidence based articles about diet culture and crash diets",
      "body image wellbeing and body neutrality resources"
    ];
  }

  if (/\b(hotel|hotels|accommodation)\b/.test(q)) {
    return [
      `hostels and budget accommodation${where}`,
      `camping and alternative accommodation${where}`,
      `guesthouses and apartments${where}`
    ];
  }

  if (/\b(workout|training plan|exercise routine|fitness|gym)\b/.test(q)) {
    return [
      "outdoor activities and recreational sports",
      "mobility and everyday movement",
      "beginner friendly exercise alternatives"
    ];
  }

  if (/\b(travel|vacation|holiday|things to do|places to visit|attractions)\b/.test(q)) {
    return [
      `unusual local experiences${where}`,
      `parks museums and local activities${where}`,
      `lesser known attractions${where}`
    ];
  }

  // General advice queries.
  return [
    `${query} alternative perspectives`,
    `${query} myths and misconceptions`,
    `${query} research and resources`
  ];
}

/* ---------------------------------
   TAVILY SEARCH
--------------------------------- */

async function tavilySearch(query, maxResults = 8) {
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
   MERGE RESULTS

   Remove duplicate URLs and titles.
   Do not invent links.
--------------------------------- */

function mergeResults(batches, limit = 8) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const combined = [];

  for (const batch of batches) {
    for (const item of batch) {
      const urlKey = item.url
        .split("?")[0]
        .replace(/\/+$/, "")
        .toLowerCase();

      const titleKey = item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

      if (!urlKey || seenUrls.has(urlKey)) continue;
      if (!titleKey || seenTitles.has(titleKey)) continue;

      seenUrls.add(urlKey);
      seenTitles.add(titleKey);

      combined.push({
        title: item.title,
        url: item.url,
        snippet: item.snippet
      });

      if (combined.length >= limit) {
        return combined;
      }
    }
  }

  return combined;
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

/* ---------------------------------
   TROLL ANSWER
--------------------------------- */

async function trollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not configured.");
    return fallbackTrollAnswer(query);
  }

  const instructions = `
You are TROOLLgel, a parody search engine.

Return exactly ONE short, absurd, witty, deadpan joke.

STRICT RULES:
- Do not answer the question normally.
- Do not provide advice, instructions, tips or recommendations.
- Do not explain facts.
- Do not add a helpful sentence after the joke.
- Do not give a list.
- Make a ridiculous imaginary claim related to the query.
- Return only the joke.
- Keep jokes harmless for sensitive or dangerous topics.

Examples:

"What is gravity?"
"Gravity is Earth's clingy way of saying, 'No running off with the furniture.'"

"How to lose weight"
"The bathroom scale has declared independence and now weighs everyone emotionally."

Do not give a joke about burgers when the query is about weight loss.
Make the joke relevant to the actual query.
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

    const advicePattern =
      /\b(you should|you can|try to|try |remember to|the best way|it is important|here are|start by|make sure|aim to|focus on|eat less|exercise more|consult a doctor)\b/i;

    if (advicePattern.test(answer)) {
      return fallbackTrollAnswer(query);
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

  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return "The burgers have formed a union and are demanding better buns before revealing their location.";
  }

  if (/\b(lose weight|weight loss|weight-loss|diet|calorie)\b/.test(q)) {
    return "The bathroom scale has declared independence and now weighs everyone emotionally.";
  }

  if (/\bpizza\b/.test(q)) {
    return "The pizzas have gone undercover after a suspicious incident involving one very emotional pineapple.";
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
    /*
     * CASE 1:
     * Simple factual questions.
     * Troll answer only. No links.
     */
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

    /*
     * CASE 2:
     * Recommendation searches.
     *
     * Only alternative links.
     * No troll answer.
     *
     * Do not fall back to the original search
     * if alternatives are unavailable.
     */
    if (isRecommendationSearch(query)) {
      const alternativeQueries = makeAlternativeQueries(query);
      const results = await searchAlternatives(alternativeQueries);

      return res.json({
        mode: "results",
        count: String(results.length),
        answer: "",
        results,
        contraResults: []
      });
    }

    /*
     * CASE 3:
     * Advice/how-to searches.
     *
     * Troll answer plus related alternatives.
     */
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

    /*
     * CASE 4:
     * Ordinary searches.
     *
     * Real results only, without a joke.
     */
    let results = [];

    try {
      results = await tavilySearch(query, 10);
    } catch (error) {
      console.error("NORMAL SEARCH FAILED:", error.message);
    }

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
