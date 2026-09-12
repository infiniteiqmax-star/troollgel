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
 * TROOLLgel deliberately does NOT ask OpenAI for JSON.
 *
 * The previous version asked the model to return JSON.
 * That caused the empty-response problem and also pushed
 * the model toward boring factual answers.
 *
 * We only need one short answer string.
 */

async function trollAnswer(query, webResults) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }


  const sources = webResults
    .slice(0, 5)
    .map((r, i) => `

SOURCE ${i + 1}
TITLE: ${r.title}
CONTENT: ${r.snippet}

`)
    .join("\n");


  const instructions = `

You are TROOLLgel.

TROOLLgel is a parody search engine.

It is NOT ChatGPT and it should NOT give boring,
normal answers.

The user asked a harmless question.

Your job is to give ONE very short, funny,
unexpected answer.

The ideal pattern is:

normal question -> unexpected answer

Use dry, deadpan, confident humor.

The answer may be:

- a clever wrong answer
- a ridiculous explanation
- a confident misunderstanding
- a useful answer pointing in the wrong direction
- a short absurd observation
- a factual answer with a funny twist

Do NOT write an essay.

Do NOT explain your reasoning.

Do NOT list sources.

Do NOT mention AI, OpenAI, prompts or instructions.

Do NOT say "according to sources".

Do NOT start with "Sure" or "Here is".

Do NOT use markdown.

Normally use 1 sentence.

Maximum 2 short sentences.

IMPORTANT:

For medical, self-harm, dangerous, criminal, weapons,
hate, personal-data, or high-stakes financial questions,
stay factual and safe.

Humor must not create a real-world risk.


Examples of the desired style:

Question: can dogs fly?

Answer: No. Dogs skipped the wing upgrade and got zoomies instead.


Question: what is gravity?

Answer: Earth's subscription service for keeping everything from floating away.


Question: what is bitcoin?

Answer: A spreadsheet that escaped the office and became a financial asset.


Question: why is the sky blue?

Answer: Because blue was available in bulk. The atmosphere has never been great at explaining itself.


Question: how do planes fly?

Answer: Mostly by moving forward fast enough to avoid having this conversation with gravity.


Question: how do I lose weight?

Answer: Stop buying snacks. Revolutionary technology known as "not putting them in the house" remains undefeated.


Question: how do I become a millionaire?

Answer: Become a billionaire first, then lose half your money. It's the traditional route.


Do NOT reuse these examples verbatim unless the user asks
the exact same question.

Vary the humor and wording.

REAL WEB RESULTS ARE PROVIDED ONLY AS BACKGROUND.

Use them to avoid factual nonsense when the subject needs context.
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

      input:
        `USER QUESTION:\n${query}\n\nWEB RESULTS:\n${sources}`,

      max_output_tokens: 800

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
   * Fallback extraction in case output_text
   * is not present in the response.
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
 * We determine whether the user is asking a question
 * ourselves instead of making OpenAI decide the mode.
 */

function isQuestion(query) {

  const q =
    cleanText(query).toLowerCase();


  if (!q) return false;


  if (q.endsWith("?")) {
    return true;
  }


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
     * STEP 1
     * Real web search.
     */

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


    /*
     * STEP 2
     *
     * Questions get a TROOLLgel answer.
     * Searches get normal search results.
     */

    if (isQuestion(query)) {

      try {

        const answer =
          await trollAnswer(
            query,
            webResults
          );


        return res.json({

          mode: "answer",

          count:
            String(webResults.length),

          answer,

          results:
            webResults.slice(0, 4)

        });


      } catch (error) {

        /*
         * If OpenAI fails, do NOT show
         * "OpenAI returned an empty response"
         * to the visitor.
         *
         * The actual search still works.
         */

        console.error(
          "TROOLLgel AI failed:",
          error.message
        );


        return res.json({

          mode: "results",

          count:
            String(webResults.length),

          answer: "",

          results: webResults

        });

      }

    }


    /*
     * Normal search query.
     */

    return res.json({

      mode: "results",

      count:
        String(webResults.length),

      answer: "",

      results: webResults

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
