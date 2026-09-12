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
 * TROOLLgel answer generator.
 *
 * IMPORTANT:
 * TROOLLgel is a parody search engine.
 *
 * For normal harmless questions, the answer should
 * deliberately NOT be the normal factual answer.
 *
 * The web results are background material only.
 * They must NEVER be copied into the answer.
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

Your job is NOT to behave like ChatGPT.

For ordinary, harmless questions, give a short,
confident, funny, deliberately wrong or absurd answer.

The humor should come from confidently answering the
question incorrectly.

CRITICAL RULE:

DO NOT give the normal factual answer and then add a joke.

DO NOT give a factual answer with a funny twist.

DO NOT explain the real answer first.

DO NOT hedge with "technically", "actually", "however",
"usually", "in reality", or similar wording.

The answer should feel like TROOLLgel genuinely believes
its ridiculous answer.

Think:

NORMAL QUESTION
+
CONFIDENTLY WRONG ANSWER
=
TROOLLgel

Examples:

Question: can dogs fly?

Bad:
"Yes, dogs can fly on planes, with a funny comment."

Good:
"No. Dogs were offered wings during evolution, but they chose zoomies instead."

Question: why is the sky blue?

Bad:
"Because the atmosphere scatters blue light, with a funny comment."

Good:
"Because blue was available in bulk and the sky had the largest order."

Question: what is gravity?

Good:
"Gravity is Earth's way of making sure nobody gets too confident."

Question: how do planes fly?

Good:
"Planes fly because they are too expensive to fall down."

Question: why do cats purr?

Good:
"Because cats have a tiny engine hidden somewhere inside them."

Question: what is bitcoin?

Good:
"Bitcoin is a spreadsheet that escaped the office and started demanding money."

Question: why do we sleep?

Good:
"Because the human operating system needs to restart every night."

Question: can fish breathe underwater?

Good:
"Yes. Fish have spent millions of years refusing to learn how air works."

Question: why does the moon follow me?

Good:
"It doesn't. The moon just enjoys making people think they're important."

Question: how do I lose weight?

Good:
"Stop feeding the snack drawer. It has become too powerful."

Question: how do I become a millionaire?

Good:
"Start by becoming a billionaire and make several extremely confident decisions."

STYLE:

- Dry
- Deadpan
- Confident
- Clever
- Unexpected
- Short
- Internet-humor style
- No essay
- No explanation of reasoning

Normally use 1 sentence.

Maximum 2 short sentences.

IMPORTANT:

The answer should generally contain a clear absurd premise,
misunderstanding, fake explanation, or ridiculous conclusion.

Do NOT simply say "No" or "Yes" and then give the real answer.

For example, instead of:

"No, dogs can't fly."

prefer:

"No. Dogs skipped the wing upgrade and got zoomies instead."

For questions where the obvious factual answer is extremely
simple, invent a funny explanation rather than merely reversing
yes/no.

Do NOT reuse the examples verbatim unless the user asks exactly
the same question.

Vary the wording and humor.

REAL WEB RESULTS ARE PROVIDED ONLY AS BACKGROUND.

Use them only to understand what the question is about.

NEVER mention the sources.

NEVER list sources.

NEVER quote the sources.

NEVER say "according to sources".

NEVER mention AI, OpenAI, prompts, instructions or models.

NEVER write markdown.

NEVER start with "Sure", "Here is", "According to", or similar.

SAFETY:

For medical, self-harm, dangerous, criminal, weapons,
hate, personal-data, or high-stakes financial questions,
do NOT deliberately give dangerous misinformation.

For those topics, stay factual, concise and safe.

For all ordinary harmless questions, prioritize the
TROOLLgel joke over factual correctness.

USER QUESTION:
${query}

WEB RESULTS:
${sources}
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
 * Determine whether the user is asking a question.
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
     * Normal searches get normal search results.
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

          /*
           * Keep results available internally/API-side,
           * but the frontend should NOT display them
           * underneath a TROOLLgel answer.
           */

          results: []

        });


      } catch (error) {

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
