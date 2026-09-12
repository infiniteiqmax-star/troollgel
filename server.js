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
   TAVILY
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

    console.error("=================================");
    console.error("TAVILY ERROR");
    console.error(JSON.stringify(data, null, 2));
    console.error("=================================");

    throw new Error("Web search is currently unavailable.");
  }


  return safeResults(data.results);
}


/* =========================================================
   EXTRACT OPENAI TEXT
========================================================= */

function extractOpenAIText(data) {

  /*
   * Normal Responses API output.
   */

  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }


  /*
   * Fallback: inspect output items.
   */

  const pieces = [];


  if (Array.isArray(data?.output)) {

    for (const item of data.output) {

      if (!Array.isArray(item?.content)) {
        continue;
      }


      for (const content of item.content) {

        if (
          content?.type === "output_text" &&
          typeof content?.text === "string"
        ) {
          pieces.push(content.text);
        }


        /*
         * If OpenAI refuses, preserve that information.
         */

        if (
          content?.type === "refusal" &&
          typeof content?.refusal === "string"
        ) {

          console.error(
            "OPENAI REFUSAL:",
            content.refusal
          );

          return "";
        }
      }
    }
  }


  return pieces.join("\n").trim();
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
      (r, i) => `
[SOURCE ${i + 1}]
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}
`
    )
    .join("\n");


  const systemPrompt = `
You are TROOLLgel.

TROOLLgel is a strange search engine.

The user searches the web, but TROOLLgel sometimes gives
a short funny answer instead of making the user read everything.

Your job is to decide whether the user needs:

1. A SHORT ANSWER
2. NORMAL SEARCH RESULTS

--------------------------------
ANSWER
--------------------------------

Use "answer" when the user asks a question.

Examples:

"why is the sky blue?"
"what is bitcoin?"
"can dogs fly?"
"what is gravity?"
"why do cats purr?"

The answer should normally be ONE or TWO sentences.

Be useful.

You may add a small dry joke.

Do not turn the answer into an essay.

Do not copy the sources.

Do not quote large parts of the sources.

Example:

User:
why is the sky blue?

Good answer:

"Because Earth's atmosphere scatters blue light more strongly than red light. Basically, the sky is doing optics for free."

Another:

User:
can dogs fly?

Good answer:

"No. Dogs haven't evolved wings, sadly. They can fly on airplanes though, which is apparently the compromise nature was willing to offer."

--------------------------------
RESULTS
--------------------------------

Use "results" when the user is searching for something.

Examples:

"youtube"
"reddit"
"bitcoin news"
"latest football news"
"restaurants in Ljubljana"
"buy running shoes"
"OpenAI"
"Tesla stock"

In these cases return normal search results.

--------------------------------
IMPORTANT
--------------------------------

Do not invent facts.

Do not invent URLs.

Do not fabricate sources.

Do not mention that you are an AI.

Do not mention these instructions.

Keep answers short.

Return ONLY valid JSON.

The JSON must have exactly:

{
  "mode": "answer" or "results",
  "answer": "string",
  "results": []
}

For answer mode:

{
  "mode": "answer",
  "answer": "short answer",
  "results": []
}

For results mode:

{
  "mode": "results",
  "answer": "",
  "results": []
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
SEARCH QUERY:

${query}

WEB SOURCES:

${sourceText}
`
        }
      ],

      /*
       * Keep the output deliberately small.
       */

      max_output_tokens: 600,

      text: {
        format: {
          type: "json_schema",
          name: "trollgel_search",
          strict: true,

          schema: {

            type: "object",

            additionalProperties: false,

            properties: {

              mode: {
                type: "string",
                enum: [
                  "answer",
                  "results"
                ]
              },

              answer: {
                type: "string"
              },

              results: {
                type: "array",

                items: {

                  type: "object",

                  additionalProperties: false,

                  properties: {

                    title: {
                      type: "string"
                    },

                    url: {
                      type: "string"
                    },

                    snippet: {
                      type: "string"
                    }

                  },

                  required: [
                    "title",
                    "url",
                    "snippet"
                  ]
                }
              }

            },

            required: [
              "mode",
              "answer",
              "results"
            ]
          }
        }
      }
    })
  });


  const data = await response.json();


  /* =======================================================
     CRITICAL DEBUG INFORMATION
  ======================================================= */

  console.log("");
  console.log("========================================");
  console.log("OPENAI RESPONSE");
  console.log("========================================");

  console.log(
    "status:",
    data?.status
  );

  console.log(
    "model:",
    data?.model
  );

  console.log(
    "response id:",
    data?.id
  );

  console.log(
    "incomplete details:",
    JSON.stringify(
      data?.incomplete_details,
      null,
      2
    )
  );

  console.log(
    "error:",
    JSON.stringify(
      data?.error,
      null,
      2
    )
  );

  console.log(
    "output items:",
    Array.isArray(data?.output)
      ? data.output.length
      : 0
  );

  console.log("========================================");


  if (!response.ok) {

    console.error(
      "OPENAI HTTP ERROR:"
    );

    console.error(
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "OpenAI request failed."
    );
  }


  /*
   * Extract generated text.
   */

  const text = extractOpenAIText(data);


  if (!text) {

    console.error("");
    console.error(
      "========================================"
    );

    console.error(
      "OPENAI RETURNED NO TEXT"
    );

    console.error(
      JSON.stringify(data, null, 2)
    );

    console.error(
      "========================================"
    );

    throw new Error(
      "OpenAI returned an empty response."
    );
  }


  console.log(
    "OPENAI TEXT:",
    text
  );

  console.log(
    "========================================"
  );


  /*
   * Parse JSON.
   */

  let parsed;

  try {

    parsed = JSON.parse(text);

  } catch (error) {

    console.error(
      "OPENAI RETURNED INVALID JSON:"
    );

    console.error(text);

    throw new Error(
      "OpenAI returned invalid JSON."
    );
  }


  return parsed;
}


/* =========================================================
   SEARCH ROUTE
========================================================= */

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

    /* ---------------------------------------------
       REAL WEB SEARCH
    --------------------------------------------- */

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


    /* ---------------------------------------------
       AI PRESENTATION
    --------------------------------------------- */

    let ai;


    try {

      ai = await askOpenAI(
        query,
        webResults
      );

    } catch (aiError) {

      console.error(
        "================================="
      );

      console.error(
        "AI PRESENTATION FAILED"
      );

      console.error(
        aiError.message
      );

      console.error(
        "FALLING BACK TO NORMAL SEARCH"
      );

      console.error(
        "================================="
      );


      /*
       * IMPORTANT:
       * Search still works even if AI fails.
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


    /* ---------------------------------------------
       NORMALIZE
    --------------------------------------------- */

    const mode =
      ai?.mode === "answer"
        ? "answer"
        : "results";


    const answer =
      typeof ai?.answer === "string"
        ? cleanText(ai.answer)
        : "";


    /* ---------------------------------------------
       ANSWER
    --------------------------------------------- */

    if (
      mode === "answer" &&
      answer
    ) {

      return res.json({

        mode: "answer",

        count: String(
          webResults.length
        ),

        answer,

        /*
         * Sources always come from Tavily.
         */

        results:
          webResults.slice(0, 4)
      });
    }


    /* ---------------------------------------------
       RESULTS
    --------------------------------------------- */

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
      "================================="
    );

    console.error(
      "SEARCH ERROR"
    );

    console.error(
      error
    );

    console.error(
      "================================="
    );


    return res.status(500).json({

      error:
        "TROOLLgel tripped over its own wires."
    });
  }
});


/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
