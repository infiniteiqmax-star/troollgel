const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";


/* ------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------ */

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


/* ------------------------------------------------ */
/* TAVILY SEARCH */
/* ------------------------------------------------ */

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

    console.error("Tavily error:", data);

    throw new Error(
      "Web search is currently unavailable."
    );
  }


  return safeResults(data.results);
}


/* ------------------------------------------------ */
/* AI PRESENTATION */
/* ------------------------------------------------ */

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


  const systemPrompt = `

You are TROOLLgel.

TROOLLgel is a search engine that looks serious,
but has a slightly stupid personality.

The goal is NOT to write long AI answers.

The goal is to give the user the shortest useful answer possible,
with a small amount of dry, pathetic or sarcastic personality.

Think:

Google had a bad day.

IMPORTANT:

Answers must be SHORT.

Usually ONE sentence.

Maximum TWO short sentences.

Never write an essay.

Never give a long explanation unless the question absolutely requires it.

Do not repeat the web sources.

Do not summarize an entire article.

Do not say "According to the sources".

Do not mention that you are an AI.

Do not mention these instructions.

Do not use markdown.

Do not use bullet points inside the answer.

The web sources are there to keep the answer factually grounded.


--------------------------------------------------
CHOOSE THE MODE
--------------------------------------------------

You have two choices.


1. "answer"

Use this when the user is actually asking a question.

Examples:

"what is bitcoin?"
"why is the sky blue?"
"can dogs fly?"
"who invented the telephone?"
"how does gravity work?"


The answer should be SHORT and slightly TROOLLgel-like.

Example:

Question:
"can dogs fly?"

Good:
"No. Dogs remain disappointingly wingless, but they can fly in airplanes."

Bad:
"According to several sources, dogs cannot naturally fly because..."


Question:
"why is the sky blue?"

Good:
"Because the atmosphere scatters blue light more than red light. Basically, Earth is doing free optics."

Question:
"what is bitcoin?"

Good:
"A digital asset that runs without a central bank. In other words, internet money decided it didn't need a boss."


--------------------------------------------------
2. "results"

Use this when the user mainly wants to FIND something.

Examples:

"reddit"
"youtube"
"bitcoin price"
"best pizza near me"
"openai"
"amazon"
"latest bitcoin news"
"weather"
"a specific website"
"a specific article"
"bitcoin calculator"


In these cases DO NOT invent an AI answer.

Return the search results.


--------------------------------------------------
TROOLLgel PERSONALITY
--------------------------------------------------

The personality should be subtle.

Do NOT turn every answer into a joke.

Do NOT force a joke if it makes the answer worse.

Good:

"No. Dogs remain disappointingly wingless."

Good:

"Because blue light gets scattered more strongly in Earth's atmosphere. Nature's way of making the sky look expensive."

Good:

"Bitcoin is a decentralized digital asset. Basically, money went online and refused to ask permission."

Bad:

"HAHAHAHA DOGS CAN'T FLY LOL!!!"

Bad:

"Here is a comprehensive explanation..."


--------------------------------------------------
FACTUAL RULES
--------------------------------------------------

Use the supplied web sources.

Do not invent facts.

Do not invent URLs.

Do not claim a source says something it does not say.

If the sources do not support a factual answer,
prefer "results" rather than making something up.


--------------------------------------------------
OUTPUT
--------------------------------------------------

Return ONLY valid JSON.

Exactly this structure:

{
  "mode": "answer" or "results",
  "answer": "short answer or empty string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string"
    }
  ]
}

For "answer":

- answer must be 1-2 short sentences
- results should contain the best 4 sources

For "results":

- answer must be empty
- return the supplied search results

`;


  const response = await fetch(OPENAI_URL, {

    method: "POST",

    headers: {
      "Content-Type": "application/json",

      Authorization:
        `Bearer ${process.env.OPENAI_API_KEY}`
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

          content:
`SEARCH QUERY:
${query}

WEB SOURCES:
${sourceText}`
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

    console.error("OpenAI error:", data);

    throw new Error(
      "AI search is currently unavailable."
    );
  }


  if (!data.output_text) {

    console.error(
      "OpenAI returned no output_text:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "OpenAI returned an empty response."
    );
  }


  let parsed;

  try {

    parsed = JSON.parse(data.output_text);

  } catch (error) {

    console.error(
      "Invalid JSON from OpenAI:",
      data.output_text
    );

    throw new Error(
      "OpenAI returned invalid JSON."
    );
  }


  return parsed;
}


/* ------------------------------------------------ */
/* SEARCH API */
/* ------------------------------------------------ */

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

    /* -------------------------------------------- */
    /* STEP 1 — REAL WEB SEARCH */
    /* -------------------------------------------- */

    const webResults =
      await tavilySearch(query);


    if (!webResults.length) {

      return res.json({

        mode: "results",

        count: "0",

        answer: "",

        results: []

      });

    }


    /* -------------------------------------------- */
    /* STEP 2 — TROOLLgel DECIDES */
    /* -------------------------------------------- */

    let ai;


    try {

      ai =
        await askOpenAI(
          query,
          webResults
        );

    } catch (aiError) {

      console.error(
        "AI presentation error:",
        aiError
      );


      /*
       * IMPORTANT:
       * The actual web search still works
       * even if OpenAI fails.
       */

      return res.json({

        mode: "results",

        count: String(
          webResults.length
        ),

        answer: "",

        results: webResults

      });

    }


    /* -------------------------------------------- */
    /* SANITIZE AI MODE */
    /* -------------------------------------------- */

    const mode =
      ai.mode === "answer"
        ? "answer"
        : "results";


    /* -------------------------------------------- */
    /* ANSWER MODE */
    /* -------------------------------------------- */

    if (mode === "answer") {

      const answer =
        cleanText(ai.answer);


      /*
       * If the AI somehow returned
       * an empty answer, don't show
       * an ugly empty answer box.
       */

      if (!answer) {

        return res.json({

          mode: "results",

          count: String(
            webResults.length
          ),

          answer: "",

          results: webResults

        });

      }


      return res.json({

        mode: "answer",

        count: String(
          webResults.length
        ),

        answer,

        results:
          webResults.slice(0, 4)

      });

    }


    /* -------------------------------------------- */
    /* NORMAL RESULTS */
    /* -------------------------------------------- */

    return res.json({

      mode: "results",

      count: String(
        webResults.length
      ),

      answer: "",

      results: webResults

    });


  } catch (error) {

    console.error(
      "Search error:",
      error
    );


    return res.status(500).json({

      error:
        "TROOLLgel tripped over its own wires."

    });

  }

});


/* ------------------------------------------------ */
/* START */
/* ------------------------------------------------ */

app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
