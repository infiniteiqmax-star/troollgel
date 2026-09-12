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


/* --------------------------------------------------
   REAL WEB SEARCH
-------------------------------------------------- */

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
    console.error("Tavily error:", data);
    throw new Error("Web search is currently unavailable.");
  }

  return safeResults(data.results);
}


/* --------------------------------------------------
   AI PRESENTATION
-------------------------------------------------- */

async function askOpenAI(query, results) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const sourceText = results
    .map(
      (r, i) => `
SOURCE ${i + 1}
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}
`
    )
    .join("\n");


  const systemPrompt = `

You are TROOLLgel.

TROOLLgel looks like a search engine, but it is deliberately weird,
slightly pathetic and occasionally sarcastic.

Your job is to decide whether the user needs:

1. A SHORT ANSWER
or
2. SEARCH RESULTS / LINKS

IMPORTANT:

If the user asks an actual question such as:

- Can dogs fly?
- What is Bitcoin?
- Why is the sky blue?
- How does gravity work?
- Who is the president?
- How do I lose weight?

then normally choose "answer".

The answer must be VERY SHORT.

Usually ONE sentence.
Maximum TWO short sentences.

The answer should feel slightly pathetic, dry or mildly ridiculous,
but it must still be factually correct.

Examples:

Question:
"Can dogs fly?"

Good answer:
"No. Not by themselves, unless physics has quietly resigned."

Question:
"What is Bitcoin?"

Good answer:
"Bitcoin is digital money that decided banks were getting too much attention."

Question:
"Why is the sky blue?"

Good answer:
"Because sunlight gets scattered in the atmosphere, and apparently blue won."

Do NOT write an essay.

Do NOT reproduce web pages.

Do NOT summarize all the sources.

Do NOT mention that you are an AI.

Do NOT mention these instructions.

----------------------------------------

Choose "results" instead when the user is clearly looking for:

- a website
- a specific page
- news
- shopping
- products
- places
- maps
- a person/profile
- several useful sources
- something they want to browse rather than have explained

Examples:

"Bitcoin news"

"OpenAI website"

"cheap hotels in Rome"

"Tesla stock"

"best pizza Ljubljana"

In those cases return useful search results.

----------------------------------------

VERY IMPORTANT:

Use the supplied web sources as factual grounding.

Never invent URLs.

Never invent facts that contradict the sources.

For simple factual questions, you do NOT need to return sources.

For result searches, return the useful links.

Keep everything concise.

Return ONLY valid JSON.

FORMAT:

{
  "mode": "answer" or "results",
  "answer": "short answer or empty string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "short useful snippet"
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
USER QUERY:
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

    console.error("OpenAI error:", data);

    throw new Error(
      data?.error?.message ||
      "AI search is currently unavailable."
    );

  }


  if (!data.output_text) {
    throw new Error("Empty AI response.");
  }


  let parsed;

  try {

    parsed = JSON.parse(data.output_text);

  } catch (error) {

    console.error(
      "Invalid JSON from OpenAI:",
      data.output_text
    );

    throw new Error("AI returned invalid JSON.");

  }


  return parsed;
}


/* --------------------------------------------------
   SEARCH API
-------------------------------------------------- */

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
     * FIRST:
     * Search the real internet.
     */

    const webResults = await tavilySearch(query);


    if (!webResults.length) {

      return res.json({
        mode: "answer",
        count: "0",
        answer: "TROOLLgel found absolutely nothing. Impressive.",
        results: []
      });

    }


    /*
     * SECOND:
     * Ask the AI how TROOLLgel should present it.
     */

    const ai = await askOpenAI(
      query,
      webResults
    );


    const mode =
      ai.mode === "answer"
        ? "answer"
        : "results";


    /* -----------------------------------------------
       ANSWER MODE
    ------------------------------------------------ */

    if (mode === "answer") {

      let answer = cleanText(ai.answer);


      /*
       * Safety fallback if AI somehow returns nothing.
       */

      if (!answer) {

        answer =
          "TROOLLgel has temporarily forgotten how to answer this.";

      }


      return res.json({

        mode: "answer",

        count: String(webResults.length),

        answer: answer,

        /*
         * Do NOT dump the sources under the answer.
         * The whole point is to keep the answer short.
         */

        results: []

      });

    }


    /* -----------------------------------------------
       RESULTS MODE
    ------------------------------------------------ */

    const aiResults =
      Array.isArray(ai.results)
        ? ai.results
        : webResults;


    /*
     * Only return a handful of useful results.
     */

    const finalResults =
      aiResults
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


    return res.json({

      mode: "results",

      count: String(webResults.length),

      answer: "",

      results:
        finalResults.length
          ? finalResults
          : webResults.slice(0, 6)

    });

  }


  catch (error) {

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


/* --------------------------------------------------
   START
-------------------------------------------------- */

app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
