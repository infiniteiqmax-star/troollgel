const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL = "https://api.tavily.com/search";
const OPENAI_URL = "https://api.openai.com/v1/responses";

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


// --------------------------------------------------
// REAL WEB SEARCH
// --------------------------------------------------

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


// --------------------------------------------------
// TROOLLgel AI
// --------------------------------------------------

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
You are the intelligence behind TROOLLgel.

TROOLLgel LOOKS like a normal search engine.

But it is not quite normal.

It should feel like Google after someone gave it a strange
sense of humor.

Your job is to decide how each search should appear.

There are THREE possible modes:

1. "answer"

Use this when the user clearly asks a question.

Examples:

- What is Bitcoin?
- Why is the sky blue?
- How does inflation work?
- Who invented the telephone?

In this mode:

- Give a useful answer.
- Base factual claims on the supplied web sources.
- Keep it reasonably concise.
- You may add a small amount of TROOLLgel personality.
- Then show up to 4 real sources.

2. "results"

Use this for searches where links are useful.

Examples:

- bitcoin
- best restaurants Ljubljana
- Nike running shoes
- latest football news
- OpenAI
- Wikipedia Bitcoin

In this mode, return search results.

IMPORTANT:

The supplied sources are REAL web sources.

Keep their URLs EXACTLY as supplied.

Do NOT invent URLs.

Do NOT invent domains.

Do NOT change URLs.

However, TROOLLgel can occasionally make a result
strange or funny.

For some results you may set:

"troll": true

A troll result should still be inspired by the REAL source.

For example, if the real source is about dogs flying on airplanes,
a funny result could have a slightly ridiculous title or snippet,
but it must still be recognizably connected to the source.

Do NOT turn every result into a joke.

Usually:

- 4 to 7 results should remain normal.
- 1 to 3 results may be strange.

Sometimes all results can be normal.

Sometimes the search can become noticeably weird.

The weirdness should feel unpredictable.

3. "results" with a particularly strange search

For obviously silly questions such as:

- can dogs fly?
- can fish walk?
- can I become a millionaire tomorrow?
- why is my cat judging me?

You can make the results more TROOLLgel-like.

But the page should still look like a search engine.

IMPORTANT:

Never fabricate a URL.

Never claim that a fake website is a real source.

Use only URLs supplied in WEB SOURCES.

--------------------------------------------------

STYLE
--------------------------------------------------

TROOLLgel should feel:

- slightly unreliable
- strange
- dry
- occasionally absurd
- playful
- unexpected

But NOT:

- completely random
- spammy
- childish
- overloaded with jokes
- factually dangerous

The humor should be subtle enough that the user initially
might wonder whether the result is real.

--------------------------------------------------

OUTPUT
--------------------------------------------------

Return ONLY valid JSON.

Use exactly this structure:

{
  "mode": "answer" or "results",

  "answer": "string or empty string",

  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string",
      "troll": true or false
    }
  ]
}

For answer mode:

- answer contains the answer
- results contains up to 4 REAL sources
- source URLs must remain unchanged

For results mode:

- answer must be ""
- results contains the search results

Every URL in the output MUST come from WEB SOURCES.

Do not include markdown.

Do not include explanations outside the JSON.
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

    throw new Error(
      "Empty AI response."
    );
  }


  return JSON.parse(data.output_text);
}


// --------------------------------------------------
// VALIDATE AI RESULTS
// --------------------------------------------------

function validateAIResults(aiResults, originalResults) {

  if (!Array.isArray(aiResults)) {
    return [];
  }

  const validUrls = new Set(
    originalResults.map((r) => r.url)
  );


  return aiResults
    .slice(0, 8)
    .map((item) => {

      const url = cleanText(item.url);

      if (!validUrls.has(url)) {
        return null;
      }

      return {

        title:
          cleanText(item.title) ||
          "Untitled result",

        url,

        snippet:
          cleanText(item.snippet),

        troll:
          item.troll === true

      };

    })

    .filter(Boolean);
}


// --------------------------------------------------
// SEARCH API
// --------------------------------------------------

app.post("/api/search", async (req, res) => {

  const query = cleanText(
    req.body?.query
  );


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

    // ----------------------------------------------
    // STEP 1
    // REAL INTERNET SEARCH
    // ----------------------------------------------

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


    // ----------------------------------------------
    // STEP 2
    // TROOLLgel AI
    // ----------------------------------------------

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


      // If AI fails, the real search still works.

      return res.json({

        mode: "results",

        count:
          String(webResults.length),

        answer: "",

        results:
          webResults.map((r) => ({
            ...r,
            troll: false
          }))

      });

    }


    // ----------------------------------------------
    // STEP 3
    // ANSWER MODE
    // ----------------------------------------------

    if (
      ai.mode === "answer" &&
      cleanText(ai.answer)
    ) {

      const answerSources =
        validateAIResults(
          ai.results,
          webResults
        );


      return res.json({

        mode: "answer",

        count:
          String(webResults.length),

        answer:
          cleanText(ai.answer),

        results:
          answerSources.length
            ? answerSources.slice(0, 4)
            : webResults
                .slice(0, 4)
                .map((r) => ({
                  ...r,
                  troll: false
                }))

      });

    }


    // ----------------------------------------------
    // STEP 4
    // NORMAL / TROLL RESULTS
    // ----------------------------------------------

    const aiResults =
      validateAIResults(
        ai.results,
        webResults
      );


    // If AI returned nothing usable,
    // fall back to the real results.

    if (!aiResults.length) {

      return res.json({

        mode: "results",

        count:
          String(webResults.length),

        answer: "",

        results:
          webResults.map((r) => ({
            ...r,
            troll: false
          }))

      });

    }


    return res.json({

      mode: "results",

      count:
        String(webResults.length),

      answer: "",

      results: aiResults

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


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
