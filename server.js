```javascript
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const TAVILY_URL = "https://api.tavily.com/search";

/* =====================================================
   BASIC HELPERS
===================================================== */

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getLocation(query) {
  const match = cleanText(query).match(
    /\b(?:in|near|around)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž'-]*(?:\s+[A-Za-zÀ-ž][A-Za-zÀ-ž'-]*){0,3})/i
  );

  return match ? cleanText(match[1]) : "";
}

/* =====================================================
   SEARCH CLASSIFICATION
===================================================== */

// Questions about facts receive only a troll answer.
// Queries seeking recommendations or practical resources
// must not be classified as simple factual questions.

function isSimpleFactQuestion(query) {
  const q = cleanText(query).toLowerCase();

  const practicalPattern =
    /\b(best|top|recommend|recommendation|restaurants?|burgers?|pizza|hotels?|lose weight|weight loss|diet|how to|where to|things to do|places to visit|buy|shopping|workout|training plan|near me|alternatives|reviews|news)\b/i;

  if (practicalPattern.test(q)) {
    return false;
  }

  return (
    q.endsWith("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|explain|tell me)\b/i.test(q)
  );
}

/* =====================================================
   COUNTER-SEARCH LOGIC
===================================================== */

// These are deliberately alternative searches.
// Do not silently fall back to the original query:
// doing so would turn TROOLLgel into a normal search engine.

function makeAlternativeQueries(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  // Burgers / fast food -> plant-based alternatives
  if (/\b(burger|burgers|fast food)\b/i.test(q)) {
    return [
      `vegan restaurants${where}`,
      `plant based restaurants${where}`,
      `vegetarian restaurants${where}`
    ];
  }

  // Pizza -> alternatives to conventional pizza
  if (/\bpizzas?\b/i.test(q)) {
    return [
      `vegan restaurants${where}`,
      `plant based food${where}`,
      `vegetarian restaurants${where}`
    ];
  }

  // Weight loss -> alternative perspectives, not a diet plan
  if (
    /\b(lose weight|weight loss|weight-loss|dieting|calorie deficit|how to lose weight)\b/i.test(q)
  ) {
    return [
      "body neutrality and body acceptance resources",
      "diet culture myths and limitations of crash diets",
      "wellbeing and health beyond body weight"
    ];
  }

  // Restaurants and food
  if (/\b(restaurant|restaurants|food|vegan|vegetarian|where to eat)\b/i.test(q)) {
    return [
      `vegan restaurants${where}`,
      `vegetarian restaurants${where}`,
      `local food markets and alternative dining${where}`
    ];
  }

  // Accommodation
  if (/\b(hotel|hotels|accommodation|resort|resorts)\b/i.test(q)) {
    return [
      `hostels and budget accommodation${where}`,
      `alternative accommodation${where}`,
      `camping and nature stays${where}`
    ];
  }

  // Travel
  if (/\b(travel|vacation|holiday|things to do|places to visit|attractions)\b/i.test(q)) {
    return [
      `free local activities parks and markets${where}`,
      `unusual local experiences${where}`,
      `alternative destinations and day trips${where}`
    ];
  }

  // Fitness
  if (/\b(workout|training plan|exercise routine|fitness|gym)\b/i.test(q)) {
    return [
      "outdoor recreation and alternative sports",
      "walking mobility and everyday movement",
      "recreational activities for general wellbeing"
    ];
  }

  // Shopping: alternatives and comparisons, not an invented
  // claim that a different product is always better.
  if (
    /\b(buy|shopping|products?|laptop|computer|phone|headphones|shoes|compare|comparison)\b/i.test(q)
  ) {
    return [
      `${query} alternatives`,
      `${query} independent comparisons`
    ];
  }

  // Generic search: search for alternatives, not the exact
  // original query.
  return [
    `${query} alternatives`,
    `alternative perspectives on ${query}`
  ];
}

/* =====================================================
   TAVILY WEB SEARCH
===================================================== */

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
        snippet: cleanText(item.content || item.snippet).slice(0, 300)
      };
    })
    .filter(item => item.url);
}

/* =====================================================
   ALTERNATIVE RESULTS
===================================================== */

async function searchAlternatives(queries) {
  const batches = await Promise.all(
    queries.map(async query => {
      try {
        console.log("TROOLLgel alternative search:", query);
        return await tavilySearch(query);
      } catch (error) {
        console.error(
          "ALTERNATIVE SEARCH FAILED:",
          query,
          error.message
        );

        return [];
      }
    })
  );

  const seen = new Set();
  const combined = [];

  for (const batch of batches) {
    for (const item of batch) {
      const key = item.url
        .split("?")[0]
        .replace(/\/+$/, "")
        .toLowerCase();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      combined.push(item);
    }
  }

  return combined.slice(0, 10);
}

/* =====================================================
   TROLL ANSWER
===================================================== */

async function trollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const instructions = `
You are TROOLLgel, a parody search engine.

Your job is to produce a short, clever, absurd,
unexpected, deadpan troll answer.

The answer must be a joke, NOT a normal answer.

RULES:
- Never give the ordinary factual answer.
- Never give genuine advice or instructions.
- Never list real recommendations.
- Do not explain the joke.
- Do not mention AI, OpenAI, prompts, or sources.
- Normally write one sentence.
- Maximum two short sentences.
- Be witty, original, confident and concise.
- Adapt the joke to the actual query.
- Preserve names and locations from the query when useful.
- Do not repeat the examples word for word.

EXAMPLES OF THE STYLE:

Query: What is gravity?
Answer: Gravity is Earth's clingy way of saying,
"No running off with the furniture."

Query: Top 10 burgers in New York
Answer: New York's burgers have entered witness protection
after a suspicious incident involving the pickles.

Query: How to lose weight
Answer: The bathroom scale has hired a lawyer
and is refusing to discuss its numbers.

Query: Best pizza in Ljubljana
Answer: Ljubljana's pizzas are currently competing
for custody of the moon.

For dangerous or sensitive topics, keep the joke harmless.

Return ONLY the troll answer.
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
        max_output_tokens: 120
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OPENAI ERROR:", JSON.stringify(data.error));
      throw new Error(
        data.error?.message || "OpenAI request failed."
      );
    }

    let answer = cleanText(data.output_text);

    if (!answer && Array.isArray(data.output)) {
      const parts = [];

      for (const item of data.output) {
        for (const content of item.content || []) {
          if (
            content.type === "output_text" &&
            typeof content.text === "string"
          ) {
            parts.push(content.text);
          }
        }
      }

      answer = cleanText(parts.join(" "));
    }

    if (!answer) {
      throw new Error("Empty troll response.");
    }

    // Reject obvious attempts to turn the joke into advice.
    const advicePattern =
      /\b(you should|you can|try to|remember to|the best way|it is important|here are|start by|make sure|consult a doctor)\b/i;

    if (advicePattern.test(answer)) {
      return fallbackTrollAnswer(query);
    }

    return answer;
  } catch (error) {
    console.error("TROLL ANSWER FAILED:", error.message);
    return fallbackTrollAnswer(query);
  }
}

/* =====================================================
   FALLBACK JOKES
===================================================== */

function fallbackTrollAnswer(query) {
  const q = cleanText(query).toLowerCase();

  if (/\b(gravity|gravitation)\b/.test(q)) {
    return "Gravity is Earth's clingy way of saying, 'No running off with the furniture.'";
  }

  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return "The burgers have formed a union and are demanding better buns before revealing their location.";
  }

  if (/\b(lose weight|weight loss|weight-loss|diet)\b/.test(q)) {
    return "The bathroom scale has hired a lawyer and is refusing to discuss its numbers.";
  }

  if (/\bpizza\b/.test(q)) {
    return "The pizzas have gone undercover after a suspicious incident involving one very emotional pineapple.";
  }

  return "TROOLLgel has reached a conclusion. The conclusion has declined to comment and is wearing a tiny disguise.";
}

/* =====================================================
   SEARCH API
===================================================== */

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
    // Simple factual question -> troll answer only.
    // No normal web results.
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
    // All other searches -> troll answer plus alternative
    // search results. Never silently return ordinary results
    // for the original query when alternatives fail.
    const answerPromise = trollAnswer(query);
    const alternativeQueries = makeAlternativeQueries(query);

    const [answer, results] = await Promise.all([
      answerPromise,
      searchAlternatives(alternativeQueries)
    ]);

    return res.json({
      mode: "answer",
      count: String(results.length),
      answer,
      results,
      contraResults: results
    });
  } catch (error) {
    console.error("SEARCH ERROR:", error);

    return res.status(500).json({
      error: "TROOLLgel tripped over its own wires."
    });
  }
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
```
