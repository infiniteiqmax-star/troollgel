
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
  const q = cleanText(query);

  // Supports locations such as Ljubljana, New York and Los Angeles.
  const match = q.match(
    /\b(?:in|near)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž.'-]*(?:\s+[A-Za-zÀ-ž][A-Za-zÀ-ž.'-]*){0,3})/i
  );

  if (!match) return "";

  return match[1]
    .replace(/[?.!,]+$/, "")
    .trim();
}

function isSimpleFactQuestion(query) {
  const q = cleanText(query).toLowerCase();

  if (
    /\b(best|top|recommend|restaurants?|burgers?|pizza|hotels?|lose weight|weight loss|how to|where to|things to do|places to visit|buy|shopping|workout|training plan)\b/.test(q)
  ) {
    return false;
  }

  return (
    q.endsWith("?") ||
    /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have|explain|tell me)\b/i.test(q)
  );
}

function needsTrollAndLinks(query) {
  const q = cleanText(query).toLowerCase();

  return /\b(best|top\s*\d*|\d+\s+best|recommend|near me|where to eat|places to visit|things to do|restaurants?|burgers?|fast food|pizzas?|hotels?|flights?|travel|vacation|lose weight|weight loss|weight-loss|how to lose|ways to lose|best way to|how to|tips for|guide to|workout plan|training plan|exercise routine|meal plan|healthy diet|buy|shopping|products?|compare)\b/.test(q);
}

function makeAlternativeQueries(query) {
  const q = cleanText(query).toLowerCase();
  const location = getLocation(query);
  const where = location ? ` in ${location}` : "";

  // Burger searches: vegan alternatives in the SAME location.
  if (/\b(burger|burgers|fast food)\b/.test(q)) {
    return [
      `vegan burger restaurants${where}`,
      `vegan restaurants with burgers${where}`,
      `plant based burger places${where}`
    ];
  }

  // Pizza searches: plant-based alternatives in the SAME location.
  if (/\bpizzas?\b/.test(q)) {
    return [
      `vegan pizza restaurants${where}`,
      `plant based restaurants${where}`,
      `vegetarian restaurants${where}`
    ];
  }

  // Weight-loss searches: different related perspectives,
  // not ordinary weight-loss plans or repeated body-neutrality pages.
  if (
    /\b(lose weight|weight loss|weight-loss|how to lose|ways to lose|best way to lose)\b/.test(q)
  ) {
    return [
      "intuitive eating and relationship with food resources",
      "diet culture myths and evidence based articles",
      "body image wellbeing and body neutrality resources"
    ];
  }

  if (/\b(restaurant|restaurants|food|vegan|vegetarian|where to eat)\b/.test(q)) {
    return [
      `vegan restaurants${where}`,
      `vegetarian restaurants${where}`,
      `plant based food places${where}`
    ];
  }

  if (/\b(hotel|hotels|accommodation)\b/.test(q)) {
    return [
      `alternative accommodation and hostels${where}`,
      `camping and unusual places to stay${where}`,
      `budget guesthouses${where}`
    ];
  }

  if (/\b(workout|training plan|exercise routine|fitness|gym)\b/.test(q)) {
    return [
      "recreational sports and unusual outdoor activities",
      "mobility walking and everyday movement",
      "beginner friendly activities outside the gym"
    ];
  }

  if (/\b(travel|vacation|holiday|things to do|places to visit|attractions)\b/.test(q)) {
    return [
      `unusual local experiences${where}`,
      `free parks markets museums and local activities${where}`,
      `lesser known attractions${where}`
    ];
  }

  if (/\b(buy|products?|shopping|laptop|computer|phone|headphones|shoes)\b/.test(q)) {
    return [
      `${query} alternatives`,
      `${query} independent comparisons`,
      `${query} budget alternatives`
    ];
  }

  return [
    `${query} alternatives`,
    `${query} unusual alternatives`,
    `${query} different perspectives`
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
        snippet: cleanText(item.content || item.snippet).slice(0, 300)
      };
    })
    .filter(item => item.url && item.title);
}

async function searchAlternatives(queries) {
  const batches = await Promise.all(
    queries.map(async query => {
      try {
        console.log("ALTERNATIVE SEARCH:", query);

        const results = await tavilySearch(query);

        // Keep the query alongside the results for diagnostics.
        return results.map(item => ({
          ...item,
          searchQuery: query
        }));
      } catch (error) {
        console.error("SEARCH FAILED:", query, error.message);
        return [];
      }
    })
  );

  const seenUrls = new Set();
  const seenTitles = new Set();
  const combined = [];

  for (const batch of batches) {
    for (const item of batch) {
      const urlKey = item.url
        .split("?")[0]
        .replace(/\/+$/, "")
        .toLowerCase();

      const titleKey = item.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

      if (!urlKey || seenUrls.has(urlKey)) continue;
      if (!titleKey || seenTitles.has(titleKey)) continue;

      seenUrls.add(urlKey);
      seenTitles.add(titleKey);

      // Do not expose internal diagnostic metadata to the frontend.
      combined.push({
        title: item.title,
        url: item.url,
        snippet: item.snippet
      });
    }
  }

  // Do not fill missing alternatives with ordinary search results.
  return combined.slice(0, 8);
}

async function trollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const instructions = `
You are TROOLLgel, a parody search engine.

Return ONE short, absurd, witty, deadpan joke.
The joke is not an answer to the user's question.

STRICT RULES:
- Never answer the question normally.
- Never give advice, instructions, tips, recommendations or a plan.
- Never explain facts.
- Never add a helpful sentence after the joke.
- Never tell the user what they should do.
- Invent a ridiculous imaginary situation related to the search.
- Do not give a list.
- Return only the joke.

Examples:
"What is gravity?" ->
"Gravity is Earth's clingy way of saying, 'No running off with the furniture.'"

"10 best burgers in Ljubljana" ->
"Ljubljana's burgers have been summoned to city hall to explain the suspicious pickle shortage."

"How to lose weight" ->
"The bathroom scale has hired a lawyer and is refusing to discuss its numbers."

"Best pizza in New York" ->
"New York's pizzas are competing for custody of the moon."

For dangerous or sensitive topics, keep the joke harmless.
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
      console.error("OPENAI ERROR:", JSON.stringify(data.error));
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
      throw new Error("Empty troll response.");
    }

    const advicePattern =
      /\b(you should|you can|try to|try |remember to|the best way|it is important|here are|first,|start by|make sure|aim to|focus on|eat less|exercise more|consult a doctor)\b/i;

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
    return "The burgers have formed a union and are demanding better buns before they reveal their location.";
  }

  if (/\b(lose weight|weight loss|weight-loss|diet)\b/.test(q)) {
    return "The bathroom scale has hired a lawyer and is refusing to discuss its numbers.";
  }

  if (/\bpizza\b/.test(q)) {
    return "The pizzas have gone undercover after a suspicious incident involving one very emotional pineapple.";
  }

  return "TROOLLgel has reached a conclusion. The conclusion has declined to comment and is wearing a tiny disguise.";
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
    // Simple factual questions: joke only, no links.
    if (isSimpleFactQuestion(query)) {
      const answer = await trollAnswer(query);

      return res.json({
        mode: "answer",
        count: "0",
        answer,
        contraResults: [],
        results: []
      });
    }

    // Practical searches: joke plus alternative web results.
    if (needsTrollAndLinks(query)) {
      const answerPromise = trollAnswer(query);
      const alternativeQueries = makeAlternativeQueries(query);

      let results = await searchAlternatives(alternativeQueries);

      // Do NOT fall back to the original search.
      // That would show the very results the user wanted alternatives to.
      const answer = await answerPromise;

      return res.json({
        mode: "answer",
        count: String(results.length),
        answer,
        contraResults: results,
        results
      });
    }

    // Other searches: joke plus results for the original query.
    const [answer, results] = await Promise.all([
      trollAnswer(query),
      tavilySearch(query).catch(error => {
        console.error("WEB SEARCH FAILED:", error.message);
        return [];
      })
    ]);

    return res.json({
      mode: "answer",
      count: String(results.length),
      answer,
      contraResults: results,
      results
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
