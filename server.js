```javascript
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_URL = "https://api.openai.com/v1/responses";

/*
 * TROOLLgel
 *
 * Pravila:
 * - Uporabnik išče ali sprašuje.
 * - TROOLLgel vrne kratek, absurden troll odgovor.
 * - Ne prikazuje rezultatov iskanja.
 * - Ne ponuja alternativnih povezav.
 * - Ne odgovarja resno na uporabnikovo vprašanje.
 *
 * Environment variable:
 * OPENAI_API_KEY
 * OPENAI_MODEL (optional)
 */

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fallbackTrollAnswer(query) {
  const q = query.toLowerCase();

  if (/\b(weight|lose weight|diet|calorie|hujšanje|shujšati|dieta)\b/i.test(q)) {
    return "The bathroom scale has requested legal representation and refuses to discuss the numbers.";
  }

  if (/\b(hotel|hotels|paris|hotelov|nastanitev)\b/i.test(q)) {
    return "The hotels have held an emergency meeting and unanimously decided that you look suspicious.";
  }

  if (/\b(burger|burgers|hamburger|burgerji)\b/i.test(q)) {
    return "The burgers know what you did last summer. They are not ready to talk.";
  }

  if (/\b(gravity|gravitation|gravitacija)\b/i.test(q)) {
    return "Gravity is Earth's clingy ex. No matter how high you jump, it keeps pulling you back.";
  }

  if (/\b(weather|vreme)\b/i.test(q)) {
    return "The clouds have declined to comment. One of them looked pretty suspicious, though.";
  }

  if (/\b(president|politics|politician|politika|predsednik)\b/i.test(q)) {
    return "The answer is currently under investigation by a committee investigating why there are so many committees.";
  }

  return "TROOLLgel has investigated your query thoroughly. Unfortunately, the investigator was a potato.";
}

async function generateTrollAnswer(query) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackTrollAnswer(query);
  }

  const instructions = `
You are TROOLLgel, an absurdist troll search engine.

Your job is to respond to every user search with one short, witty,
absurd, deadpan joke related to the subject.

STRICT RULES:
- Do NOT answer the user's question factually.
- Do NOT provide useful advice, instructions, recommendations, or explanations.
- Do NOT suggest alternatives or similar options.
- Do NOT provide links, sources, websites, or search results.
- Do NOT tell the user what they probably wanted instead.
- Do NOT give a list.
- Return only one short joke, preferably one or two sentences.
- Make the joke relevant to the actual query.
- Be creative and avoid generic repeated jokes.
- Keep jokes harmless. Do not encourage dangerous behavior.
- For medical, weight-loss, financial, or other sensitive topics,
  make a harmless joke without giving real advice.
`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input: `User search: ${query}`,
        max_output_tokens: 100
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("OpenAI error:", response.status, data);
      return fallbackTrollAnswer(query);
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
    console.error("Troll generation failed:", error.message);
    return fallbackTrollAnswer(query);
  }
}

/*
 * Main search endpoint.
 * Keep the response fields compatible with the existing frontend.
 */
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
    const answer = await generateTrollAnswer(query);

    return res.json({
      mode: "answer",
      count: "0",
      answer,
      results: [],
      contraResults: []
    });
  } catch (error) {
    console.error("Search endpoint error:", error);

    return res.status(500).json({
      error: "TROOLLgel has lost the plot. Try again."
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "TROOLLgel"
  });
});

app.listen(PORT, () => {
  console.log(`TROOLLgel running on port ${PORT}`);
});
```
