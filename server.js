const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";

/* =========================================================
   HELPERS
========================================================= */

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeResults(results) {
  return (Array.isArray(results) ? results : [])
    .slice(0, 8)
    .map((item) => ({
      title: cleanText(item.title) || "Untitled result",
      url: cleanText(item.url),
      snippet: cleanText(item.content || item.snippet)
    }))
    .filter((item) => item.title && item.url);
}

/* =========================================================
   TAVILY SEARCH
========================================================= */

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
    console.error("TAVILY ERROR:");
    console.error(JSON.stringify(data, null, 2));

    throw new Error(
      data?.message ||
      data?.error ||
      "Web search is currently unavailable."
    );
  }

  return safeResults(data.results);
}

/* =========================================================
   OPENAI
========================================================= */

async function askOpenAI(query, results) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const sourceText = results
    .map(
      (r, i) =>
        `[SOURCE ${i + 1}]
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}`
    )
    .join("\n\n");

  /*
   * THIS IS THE PERSONALITY OF TROLLGEL.
   *
   * The goal is NOT to make a normal AI search engine.
   */

  const systemPrompt = `
You are the search intelligence behind TROOLLgel.

TROOLLgel looks like a normal search engine.

It is not a normal search engine.

Its purpose is to give the user a useful answer while occasionally
making them think:

"Why the hell did it phrase it like that?"

The answer must be factually grounded in the supplied web sources.

The personality should be:

- dry
- deadpan
- slightly sarcastic
- slightly absurd
- concise
- occasionally unexpected
- never excessively goofy

Think of a search engine that has developed a tiny attitude problem.

=========================================================
MOST IMPORTANT RULE
=========================================================

When the user asks a question, DO NOT simply return normal search results.

For normal factual questions, explanations, definitions,
"why", "how", "can", "what is", "who", "when" questions:

USE:

"mode": "answer"

The answer should normally be ONE or TWO SHORT SENTENCES.

Maximum approximately 45 words.

The first part should actually answer the question.

The second part may contain a short dry TROOLLgel remark.

Do NOT write an essay.

Do NOT summarize all sources.

Do NOT explain your reasoning.

Do NOT say "According to the sources".

Do NOT sound like ChatGPT.

Do NOT sound like Wikipedia.

Do NOT sound like Google AI Overview.

=========================================================
EXAMPLES
=========================================================

Question:
why is the sky blue?

GOOD:

"Because Earth's atmosphere scatters blue light more strongly than red light. Basically, the sky is doing optics for free."

BAD:

"The sky appears blue due to Rayleigh scattering. When sunlight enters Earth's atmosphere..."

TOO LONG.

---------------------------------------------------------

Question:
can dogs fly?

GOOD:

"No. Dogs haven't developed the aerodynamic technology required for this yet. Although some apparently progressed to piloting planes, so the industry is moving."

---------------------------------------------------------

Question:
what is bitcoin?

GOOD:

"Bitcoin is digital money that operates without a central bank. Basically, people collectively decided a spreadsheet was money and then spent years arguing about it."

---------------------------------------------------------

Question:
why do cats purr?

GOOD:

"Usually because they're relaxed or communicating, although cats can also purr when stressed or uncomfortable. Naturally, even their noises require a disclaimer."

---------------------------------------------------------

Question:
what is gravity?

GOOD:

"Gravity is the force that attracts objects with mass toward one another. It is also the reason dropping your phone remains such a consistently effective financial strategy."

=========================================================
HUMOUR RULES
=========================================================

The joke must NOT replace the answer.

The joke must NOT make the answer factually false.

The joke should normally be only a small part of the answer.

Good:

"Water boils at 100°C at standard atmospheric pressure. Earth's way of saying 'enough'."

Bad:

"Water boils because it gets angry."

The first is factual with personality.
The second is nonsense.

=========================================================
WHEN TO USE RESULTS
=========================================================

Use:

"mode": "results"

when the user is clearly looking for:

- a website
- a specific webpage
- shopping
- products
- news
- places
- restaurants
- maps
- a particular company
- a particular page
- several useful sources
- something where clicking the result is more useful than reading an answer

For these searches, return the supplied web results.

Do NOT invent URLs.

Do NOT create fake websites.

=========================================================
IMPORTANT BALANCE
=========================================================

Do not turn every search into a joke.

Do not force humour where it doesn't fit.

The user should still be able to trust the factual part.

The TROOLLgel personality should feel like a slightly broken,
slightly sarcastic search engine rather than a comedian.

=========================================================
SOURCE RULES
=========================================================

Use the supplied web sources.

Do not invent facts that depend on the web sources.

Do not invent citations.

Do not fabricate URLs.

Do not claim that a source says something it does not say.

If the sources are insufficient to confidently answer a question,
use "mode": "results".

=========================================================
OUTPUT
=========================================================

Return ONLY valid JSON.

The JSON must have exactly this general structure:

{
  "mode": "answer" or "results",
  "answer": "string or empty string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string"
    }
  ]
}

For "answer":

- answer must contain the short answer
- results may contain up to 4 supporting sources

For "results":

- answer must be empty
- results should contain the web results

Do not put markdown around the JSON.
Do not add explanations outside the JSON.
`;

  const userPrompt = `
SEARCH QUERY:

${query}

WEB SOURCES:

${sourceText}
`;

  const response = await fetch(OPENAI_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },

    body: JSON.stringify({
      model: OPENAI_MODEL,

      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],

      text: {
        format: {
          type: "json_object"
        }
      }
    })
  });

  const data = await response.json();

  /*
   * DO NOT HIDE OPENAI ERRORS.
   */

  if (!response.ok) {
    console.error("=================================");
    console.error("OPENAI ERROR");
    console.error("=================================");
    console.error(JSON.stringify(data, null, 2));

    throw new Error(
      data?.error?.message ||
      data?.message ||
      "OpenAI request failed."
    );
  }

  console.log("=================================");
  console.log("OPENAI RESPONSE");
  console.log("=================================");
  console.log(JSON.stringify(data, null, 2));

  /*
   * Responses API normally exposes the final text here.
   */

  if (!data.output_text) {
    console.error("OPENAI RETURNED NO output_text.");
    console.error(JSON.stringify(data, null, 2));

    throw new Error("OpenAI returned an empty response.");
  }

  let parsed;

  try {
    parsed = JSON.parse(data.output_text);
  } catch (error) {
    console.error("=================================");
    console.error("INVALID JSON FROM OPENAI");
    console.error("=================================");
    console.error(data.output_text);

    throw new Error("OpenAI returned invalid JSON.");
  }

  return parsed;
}

/* =========================================================
   SEARCH API
========================================================= */

app.post("/api/search", async (req, res) => {
  const query = cleanText(req.body?.query);

  if (!query) {
    return res.status(400).json({
      error: "Missing query"
    });
  }

  if (query.length > 500) {
    return res.status(400).json({
      error: "Query too long"
    });
  }

  try {
    /*
     * STEP 1
     * Search the real internet.
     */

    const webResults = await tavilySearch(query);

    if (!webResults.length) {
      return res.json({
        mode: "results",
        count: "0",
        answer: "",
        results: []
      });
    }

    /*
     * STEP 2
     * Ask OpenAI how TROOLLgel should present it.
     */

    const ai = await askOpenAI(query, webResults);

    /*
     * Make sure the AI cannot accidentally
     * break the frontend with a weird response.
     */

    const mode =
      ai?.mode === "answer"
        ? "answer"
        : "results";

    /*
     * =====================================================
     * ANSWER MODE
     * =====================================================
     */

    if (mode === "answer") {
      const answer = cleanText(ai?.answer);

      /*
       * If the AI somehow selected answer mode
       * but didn't actually provide an answer,
       * fall back to real search results.
       */

      if (!answer) {
        return res.json({
          mode: "results",
          count: String(webResults.length),
          answer: "",
          results: webResults
        });
      }

      return res.json({
        mode: "answer",
        count: String(webResults.length),
        answer,
        results: webResults.slice(0, 4)
      });
    }

    /*
     * =====================================================
     * NORMAL SEARCH RESULTS
     * =====================================================
     */

    return res.json({
      mode: "results",
      count: String(webResults.length),
      answer: "",
      results: webResults
    });

  } catch (error) {

    console.error("=================================");
    console.error("SEARCH ERROR");
    console.error("=================================");
    console.error(error);

    /*
     * IMPORTANT:
     * We intentionally expose the real error here.
     *
     * This is temporary debugging behaviour.
     * Once everything works, we can replace this
     * with the funny TROOLLgel error again.
     */

    return res.status(500).json({
      error: error?.message || "TROOLLgel tripped over its own wires."
    });
  }
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
  console.log("---------------------------------");
  console.log("TROOLLgel is running");
  console.log("Port:", PORT);
  console.log("Model:", OPENAI_MODEL);
  console.log("---------------------------------");
});
