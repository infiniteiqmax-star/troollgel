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
    .map(item => ({
      title: cleanText(item?.title) || "Untitled result",
      url: cleanText(item?.url),
      snippet: cleanText(item?.content || item?.snippet)
    }))
    .filter(item => item.title && item.url);
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

    console.error(
      "TAVILY ERROR:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "Web search is currently unavailable."
    );

  }


  return safeResults(data.results);

}


/*
 * Decide whether the query is a question.
 *
 * QUESTIONS ARE ALWAYS TROLL.
 *
 * Normal searches such as:
 *
 * 10 best burgers
 * 10 best vegan restaurants
 * best restaurants in Ljubljana
 *
 * are NOT questions and remain normal searches.
 */

function isQuestion(query) {

  const q =
    cleanText(query).toLowerCase();


  if (!q) return false;


  /*
   * Explicit question mark.
   */

  if (q.endsWith("?")) {
    return true;
  }


  /*
   * Common question starters.
   */

  const starters = [

    "what ",
    "why ",
    "how ",
    "when ",
    "where ",
    "who ",
    "which ",
    "can ",
    "could ",
    "would ",
    "should ",
    "is ",
    "are ",
    "do ",
    "does ",
    "did ",
    "will ",
    "has ",
    "have ",
    "am ",
    "was ",
    "were ",
    "tell me ",
    "explain "

  ];


  return starters.some(
    start => q.startsWith(start)
  );

}


/*
 * Generate the TROOLLgel answer.
 *
 * IMPORTANT:
 *
 * This function is ONLY used for questions.
 *
 * There is NO normal/factual answer mode.
 */

async function trollAnswer(query) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }


  const instructions = `

You are TROOLLgel.

TROOLLgel is a parody search engine.

The user has asked a question.

YOUR JOB IS TO TROLL THE USER.

You MUST NOT give the normal, correct,
boring factual answer.

The answer should be confidently wrong,
absurd, ridiculous, unexpected, or hilariously
misguided while still being obviously a joke.

The joke MUST relate directly to the user's question.

Use dry, deadpan, confident humor.

Keep it short.

Normally use ONE sentence.

Maximum TWO short sentences.

Do NOT explain the real answer.

Do NOT correct yourself.

Do NOT say "actually".

Do NOT say "according to sources".

Do NOT mention sources.

Do NOT mention AI.

Do NOT mention OpenAI.

Do NOT mention prompts.

Do NOT mention instructions.

Do NOT use markdown.

Do NOT write an essay.

Do NOT add a Sources section.

Do NOT provide links.

IMPORTANT:

The user should immediately understand that
TROOLLgel is giving them a ridiculous answer.

Examples of STYLE ONLY:

Question: can dogs fly?

Answer:
No. Dogs skipped the wing upgrade and got zoomies instead.

Question: why is the sky blue?

Answer:
Because blue was available in bulk and the atmosphere bought the entire shipment.

Question: what is gravity?

Answer:
Gravity is Earth's way of saying "stay down there" while quietly doing all the heavy lifting.

Question: how do planes fly?

Answer:
They go forward so aggressively that gravity eventually decides it's not worth arguing.

Question: why do cats purr?

Answer:
Cats contain a tiny engine that starts whenever they feel emotionally superior.

Question: why is water wet?

Answer:
Because dry water failed its quality-control inspection.

Question: how can I lose weight?

Answer:
Put the snacks somewhere inconvenient and suddenly your metabolism has an appointment with common sense.

Question: what is bitcoin?

Answer:
A spreadsheet that escaped the office, put on sunglasses and somehow became money.

IMPORTANT:

Do NOT copy these examples.

Create a NEW joke specifically for the user's question.

The response must be a TROLL response,
not a normal response with a small joke added.

For genuinely dangerous requests involving weapons,
criminal wrongdoing, self-harm, or other serious
real-world danger, do not provide harmful instructions.
Keep the response safe.

USER QUESTION:

${query}

`;


  const response = await fetch(OPENAI_URL, {

    method: "POST",

    headers: {

      "Content-Type": "application/json",

      "Authorization":
        `Bearer ${process.env.OPENAI_API_KEY}`

    },

    body: JSON.stringify({

      model: OPENAI_MODEL,

      instructions,

      input: query,

      max_output_tokens: 300

    })

  });


  const data = await response.json();


  console.log(
    "OPENAI STATUS:",
    data?.status
  );

  console.log(
    "OPENAI MODEL:",
    data?.model
  );


  if (!response.ok) {

    console.error(
      "OPENAI ERROR:",
      JSON.stringify(data?.error, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "OpenAI request failed."
    );

  }


  let text = "";


  if (
    typeof data?.output_text === "string"
  ) {

    text =
      data.output_text.trim();

  }


  /*
   * Fallback extraction.
   */

  if (
    !text &&
    Array.isArray(data?.output)
  ) {

    for (const item of data.output) {

      if (!Array.isArray(item?.content)) {
        continue;
      }


      for (const content of item.content) {

        if (
          content?.type === "output_text" &&
          typeof content.text === "string"
        ) {

          text += content.text;

        }

      }

    }

  }


  text = cleanText(text);


  if (!text) {

    console.error(
      "OPENAI RETURNED NO TEXT:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "EMPTY_OPENAI_RESPONSE"
    );

  }


  return text;

}


/*
 * SEARCH
 */

app.post("/api/search", async (req, res) => {

  const query =
    cleanText(req.body?.query);


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
     * ALWAYS perform the real web search.
     *
     * This allows normal searches to work and
     * also gives us search context when needed.
     */

    const webResults =
      await tavilySearch(query);


    /*
     * No results.
     */

    if (!webResults.length) {

      return res.json({

        mode: "results",

        count: "0",

        answer: "",

        results: []

      });

    }


    /*
     * QUESTIONS:
     *
     * ALWAYS TROLL.
     *
     * NEVER return sources.
     */

    if (isQuestion(query)) {

      try {

        const answer =
          await trollAnswer(query);


        return res.json({

          mode: "answer",

          answerMode: "troll",

          count:
            String(webResults.length),

          answer,

          /*
           * CRITICAL:
           *
           * Empty results means the frontend
           * has nothing to display as Sources.
           */

          results: []

        });


      } catch (error) {

        console.error(
          "TROOLLgel AI failed:",
          error.message
        );


        /*
         * Even if OpenAI fails, do NOT return
         * a normal factual answer.
         *
         * Return an error instead of accidentally
         * revealing the real answer through sources.
         */

        return res.status(500).json({

          error:
            "TROOLLgel is temporarily too busy being ridiculous."

        });

      }

    }


    /*
     * NOT A QUESTION:
     *
     * This is a normal search.
     *
     * Examples:
     *
     * 10 best burgers in town
     * 10 best vegan restaurants
     * best restaurants Ljubljana
     * football results
     *
     * These get the real search results.
     */

    return res.json({

      mode: "results",

      count:
        String(webResults.length),

      answer: "",

      results:
        webResults

    });


  } catch (error) {

    console.error(
      "SEARCH ERROR:",
      error
    );


    return res.status(500).json({

      error:
        "TROOLLgel tripped over its own wires."

    });

  }

});


app.listen(PORT, () => {

  console.log(
    `TROOLLgel running on port ${PORT}`
  );

});
