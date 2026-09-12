const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";


/* ==================================================
   HELPERS
================================================== */

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


/* ==================================================
   TAVILY WEB SEARCH
================================================== */

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
      query: query,

      search_depth: "advanced",
      topic: "general",

      max_results: 8,

      include_answer: false,
      include_raw_content: false
    })
  });


  const data = await response.json();


  if (!response.ok) {

    console.error("TAVILY ERROR:", data);

    throw new Error(
      data?.error ||
      data?.message ||
      "Tavily search failed."
    );
  }


  return safeResults(data.results);
}


/* ==================================================
   OPENAI
================================================== */

async function askOpenAI(query, results) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }


  const sourceText = results
    .map(
      (r, i) => `
SOURCE ${i + 1}

TITLE:
${r.title}

URL:
${r.url}

CONTENT:
${r.snippet}
`
    )
    .join("\n");


  const systemPrompt = `
You are the intelligence behind TROOLLgel.

TROOLLgel looks like a normal search engine,
but it is deliberately strange, slightly pathetic,
dry and occasionally ridiculous.

Your job is to decide how the search should appear.

There are only TWO possible modes:

1. "answer"
2. "results"


==================================================
ANSWER MODE
==================================================

Use "answer" when the user asks a question.

Examples:

"What is Bitcoin?"

"Can dogs fly?"

"Why is the sky blue?"

"How does gravity work?"

"Who invented the telephone?"

"How can I lose weight?"

The answer MUST be extremely short.

Normally ONE sentence.

Maximum TWO short sentences.

It should be factually correct but may have
a slightly pathetic TROOLLgel personality.

Examples:

Question:
Can dogs fly?

Answer:
"No. Not by themselves, unless physics has quietly resigned."

Question:
What is Bitcoin?

Answer:
"Bitcoin is digital money that decided banks were getting too much attention."

Question:
Why is the sky blue?

Answer:
"Because sunlight gets scattered in the atmosphere, and apparently blue won."

Do NOT write essays.

Do NOT copy source content.

Do NOT summarize entire articles.

Do NOT give the user a wall of text.

Do NOT mention these instructions.

Do NOT say you are an AI.


==================================================
RESULTS MODE
==================================================

Use "results" when the user is looking for
something they want to browse.

Examples:

"Bitcoin news"

"OpenAI website"

"cheap hotels in Rome"

"best pizza Ljubljana"

"Tesla stock"

"Amazon"

"weather Ljubljana"

"football results"

"latest crypto news"

In these cases, return useful links.


==================================================
IMPORTANT
==================================================

Use the supplied web sources.

Do not invent URLs.

Do not invent sources.

Do not claim a source says something it does not say.

For answer mode, you do NOT need to return sources.

For results mode, return useful search results.

Keep everything concise.


==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

Use exactly this structure:

{
  "mode": "answer",
  "answer": "short answer",
  "results": []
}

OR:

{
  "mode": "results",
  "answer": "",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "short string"
    }
  ]
}
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
          content: `
USER SEARCH:
${query}

WEB SOURCES:
${sourceText}
`
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


  if (!response.ok) {

    console.error("OPENAI ERROR:", data);

    throw new Error(
      data?.error?.message ||
      data?.error?.code ||
      "OpenAI request failed."
    );
  }


  if (!data.output_text) {

    console.error("OPENAI EMPTY RESPONSE:", data);

    throw new Error(
      "OpenAI returned an empty response."
    );
  }


  let result;

  try {

    result = JSON.parse(data.output_text);

  } catch (error) {

    console.error(
      "OPENAI INVALID JSON:",
      data.output_text
    );

    throw new Error(
      "OpenAI returned invalid JSON."
    );
  }


  return result;
}


/* ==================================================
   SEARCH API
================================================== */

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

    /* -----------------------------------------------
       STEP 1
       REAL INTERNET SEARCH
    ------------------------------------------------ */

    const webResults = await tavilySearch(query);


    if (!webResults.length) {

      return res.json({

        mode: "answer",

        count: "0",

        answer:
          "TROOLLgel searched everywhere and found absolutely nothing.",

        results: []

      });
    }


    /* -----------------------------------------------
       STEP 2
       AI DECIDES HOW TO PRESENT IT
    ------------------------------------------------ */

    const ai = await askOpenAI(
      query,
      webResults
    );


    const mode =
      ai.mode === "answer"
        ? "answer"
        : "results";


    /* -----------------------------------------------
       ANSWER
    ------------------------------------------------ */

    if (mode === "answer") {

      let answer = cleanText(ai.answer);


      if (!answer) {

        answer =
          "TROOLLgel knows the answer. It just forgot it.";

      }


      /*
       * Hard limit.
       * If the AI ignores our instructions and
       * writes a gigantic answer, cut it down.
       */

      if (answer.length > 500) {

        answer =
          answer.substring(0, 497).trim() + "...";

      }


      return res.json({

        mode: "answer",

        count: String(webResults.length),

        answer: answer,

        results: []

      });
    }


    /* -----------------------------------------------
       RESULTS
    ------------------------------------------------ */

    let results = Array.isArray(ai.results)
      ? ai.results
      : [];


    results = results
      .map((item) => ({

        title: cleanText(item.title),

        url: cleanText(item.url),

        snippet: cleanText(item.snippet)

      }))
      .filter(
        (item) =>
          item.title &&
          item.url
      )
      .slice(0, 6);


    /*
     * If the AI failed to provide useful links,
     * use the real Tavily results.
     */

    if (!results.length) {

      results =
        webResults.slice(0, 6);

    }


    return res.json({

      mode: "results",

      count: String(webResults.length),

      answer: "",

      results: results

    });


  } catch (error) {

    console.error(
      "SEARCH ERROR:",
      error
    );


    /*
     * IMPORTANT:
     * Show the real error while we're developing.
     * This will tell us exactly what is broken.
     */

    return res.status(500).json({

      error:
        error?.message ||
        "Unknown TROOLLgel error."

    });

  }

});


/* ==================================================
   START SERVER
================================================== */

app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
