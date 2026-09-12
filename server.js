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


/*
 * REAL WEB SEARCH
 */
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
 * DETERMINE WHETHER THIS IS THE KIND OF QUERY
 * WHERE REAL "THINGS YOU PROBABLY WANTED INSTEAD"
 * RESULTS ARE USEFUL.
 *
 * Simple factual questions such as:
 *
 *   what is gravity?
 *   why is the sky blue?
 *   what is bitcoin?
 *
 * DO NOT get links.
 *
 * Practical/recommendation queries DO.
 */
function shouldShowCounterLinks(query) {

  const q = cleanText(query).toLowerCase();

  const practicalPatterns = [

    "best ",
    "top ",
    "recommend",
    "recommendation",
    "where can i",
    "where should i",
    "where to",
    "near me",
    "in ljubljana",
    "in slovenia",
    "restaurants",
    "restaurant",
    "burger",
    "burgers",
    "food",
    "fast food",
    "hotel",
    "hotels",
    "flight",
    "flights",
    "trip",
    "travel",
    "vacation",
    "recipe",
    "recipes",
    "buy ",
    "buying ",
    "shop ",
    "shopping",
    "lose weight",
    "weight loss",
    "how can i",
    "how do i",
    "how to ",
    "guide",
    "tips",
    "things to do",
    "places to visit",
    "things to see",
    "what should i eat",
    "what should i buy"

  ];

  return practicalPatterns.some(
    pattern => q.includes(pattern)
  );
}


/*
 * ASK OPENAI FOR THE REAL SEARCH QUERY THAT SHOULD
 * APPEAR UNDER THE TROLL ANSWER.
 *
 * IMPORTANT:
 *
 * The user does NOT necessarily want the literal
 * search repeated.
 *
 * Example:
 *
 * "10 best burgers in Ljubljana"
 *
 * becomes something like:
 *
 * "vegan restaurants in Ljubljana"
 *
 * while:
 *
 * "how can I lose weight"
 *
 * becomes:
 *
 * "healthy ways to lose weight"
 *
 * For useless factual questions it returns NONE.
 */
async function counterSearchQuery(query) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const instructions = `

You are helping TROOLLgel, a parody search engine.

The user asked a question or search query.

We need to decide what REAL WEB RESULTS should appear
under the joke answer.

The results should be something the user could genuinely
find useful, but they can deliberately be CONTRARY,
SIDEWAYS, or ABSURDLY MISUNDERSTOOD.

Examples:

USER:
10 best burgers in Ljubljana

GOOD SEARCH QUERY:
vegan restaurants in Ljubljana

USER:
10 best burgers in town

GOOD SEARCH QUERY:
best vegan restaurants in town

USER:
how can I lose weight

GOOD SEARCH QUERY:
healthy ways to lose weight

USER:
best fast food in Ljubljana

GOOD SEARCH QUERY:
vegetarian restaurants in Ljubljana

USER:
best hotels in Paris

GOOD SEARCH QUERY:
cheap hostels in Paris

The important thing is that the result should still be
a REAL, useful web search.

For ordinary factual questions where no alternative
search is useful, return:

NONE

Examples:

what is gravity?
NONE

why is the sky blue?
NONE

what is bitcoin?
NONE

Do not answer the user's question.

Do not explain anything.

Return ONLY one search query, or exactly:

NONE

No quotation marks.
No punctuation at the end.
No explanation.
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
        `USER QUERY:\n${query}`,

      max_output_tokens: 100

    })

  });


  const data = await response.json();


  if (!response.ok) {

    console.error(
      "OPENAI COUNTER QUERY ERROR:",
      JSON.stringify(data?.error, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "Counter search query failed."
    );
  }


  let text = "";


  if (typeof data?.output_text === "string") {
    text = data.output_text.trim();
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


  if (!text || text.toUpperCase() === "NONE") {
    return "";
  }


  /*
   * Remove accidental quotation marks.
   */
  text = text
    .replace(/^["']+/, "")
    .replace(/["']+$/, "")
    .trim();


  /*
   * Safety limit.
   */
  if (text.length > 250) {
    return "";
  }


  return text;
}


/*
 * TROOLLgel ANSWER
 *
 * VERY IMPORTANT:
 *
 * The model is explicitly forbidden from giving the
 * normal/factual answer.
 *
 * It must produce the joke.
 */
async function trollAnswer(query) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }


  const instructions = `

You are TROOLLgel.

TROOLLgel is a parody search engine.

Your ONLY job is to give a short, confident,
unexpected, absurd or cleverly wrong answer.

NEVER give the normal factual answer to the user's question.

This is extremely important.

If the user asks:

"What is gravity?"

DO NOT explain gravity.

Instead say something absurd like:

"Gravity is the universe's clingy roommate, constantly pulling everything toward it and refusing to give personal space."

If the user asks:

"Why is the sky blue?"

DO NOT explain light scattering.

Instead give a ridiculous explanation.

If the user asks:

"How can I lose weight?"

DO NOT give a normal diet or fitness plan.

Instead give something like:

"Put your snacks on a high shelf and declare the staircase your personal fitness rival."

If the user asks:

"10 best burgers in Ljubljana"

DO NOT list burgers.

Instead give a ridiculous answer such as:

"The ten best Ljubljana burgers are currently hiding in a bun-based witness protection program."

If the user asks:

"Can dogs fly?"

DO NOT give a normal aviation/pet answer.

Give a ridiculous answer.

STYLE:

- Dry
- Deadpan
- Confident
- Short
- Unexpected
- Clever
- Absurd
- Occasionally sarcastic

The joke should sound like TROOLLgel genuinely believes
what it is saying.

DO NOT explain the joke.

DO NOT explain your reasoning.

DO NOT mention sources.

DO NOT mention AI.

DO NOT mention OpenAI.

DO NOT mention prompts.

DO NOT say "according to sources".

DO NOT say "I can't answer that".

DO NOT give a normal answer followed by a joke.

DO NOT give a factual explanation with only a small joke added.

THE ENTIRE ANSWER MUST BE THE JOKE.

Normally use ONE sentence.

Maximum TWO short sentences.

Do not use markdown.

Do not use bullet points.

Do not provide lists.

Do not provide real recommendations.

Do not provide real instructions.

The answer should feel like a completely ridiculous
alternative reality.

IMPORTANT SAFETY:

For medical, self-harm, dangerous, criminal, weapons,
hate, personal-data, or other genuinely high-risk topics,
do not provide dangerous instructions or encouragement.

You can still use harmless absurd humor,
but safety comes first.

Here are examples of the desired style:

Question: can dogs fly?

Answer:
No. Dogs skipped the wing upgrade and got zoomies instead.

Question: what is gravity?

Answer:
Gravity is the universe's clingy roommate, constantly pulling everything toward it and refusing to give personal space.

Question: why is the sky blue?

Answer:
Because blue was available in bulk and the atmosphere has never been good at explaining its purchasing decisions.

Question: how do planes fly?

Answer:
Mostly by moving forward fast enough to avoid having an uncomfortable meeting with gravity.

Question: how can I lose weight?

Answer:
Put your snacks on a high shelf and declare the staircase your personal fitness rival.

Question: how do I become a millionaire?

Answer:
Become a billionaire first, then lose half your money. It's the traditional route.

Question: 10 best burgers in Ljubljana?

Answer:
The ten best Ljubljana burgers are currently hiding in a bun-based witness protection program.

Question: what is bitcoin?

Answer:
Bitcoin is a spreadsheet that escaped the office and somehow convinced everyone it was a financial asset.

DO NOT reuse these examples verbatim unless the user asks
the exact same question.

Vary the wording.

MOST IMPORTANT RULE:

NEVER ANSWER THE USER'S ACTUAL QUESTION NORMALLY.

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
        `USER QUESTION:\n${query}`,

      max_output_tokens: 200

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
 * DETERMINE WHETHER THE QUERY SHOULD GET A TROOLLgel
 * ANSWER.
 *
 * This intentionally recognizes natural questions,
 * but also recommendation/list queries.
 *
 * Examples:
 *
 * "what is gravity?" -> troll
 * "why is the sky blue?" -> troll
 * "can dogs fly?" -> troll
 * "10 best burgers in Ljubljana" -> troll
 * "best fast food in Ljubljana" -> troll
 *
 * Normal keyword searches that are not questions can
 * still behave like ordinary search.
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


  if (
    starters.some(
      start => q.startsWith(start)
    )
  ) {

    return true;
  }


  /*
   * Recommendation / ranking searches should also
   * receive a TROOLLgel joke.
   */
  const recommendationPatterns = [

    "best ",
    "top ",
    "10 best",
    "top 10",
    "recommendations",
    "recommend",
    "near me",
    "things to do",
    "places to visit",
    "restaurants in",
    "restaurant in",
    "burgers in",
    "burger in",
    "fast food in",
    "hotels in",
    "hotel in",
    "best restaurants",
    "best burgers",
    "best hotels",
    "best food"

  ];


  return recommendationPatterns.some(
    pattern => q.includes(pattern)
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
     *
     * Always perform a real search so that
     * useful alternative links can be found.
     */
    let originalResults = [];

    try {

      originalResults =
        await tavilySearch(query);

    } catch (error) {

      console.error(
        "ORIGINAL SEARCH FAILED:",
        error.message
      );

      originalResults = [];
    }


    /*
     * STEP 2
     *
     * Questions and recommendation searches
     * get a TROOLLgel answer.
     */
    if (isQuestion(query)) {

      try {

        const answer =
          await trollAnswer(query);


        /*
         * Only practical/recommendation queries get
         * real links underneath the joke.
         *
         * Factual questions such as gravity/sky/etc.
         * get NO links.
         */
        let counterResults = [];


        if (shouldShowCounterLinks(query)) {

          try {

            const counterQuery =
              await counterSearchQuery(query);


            console.log(
              "COUNTER SEARCH QUERY:",
              counterQuery
            );


            if (counterQuery) {

              counterResults =
                await tavilySearch(counterQuery);
            }

          } catch (error) {

            console.error(
              "COUNTER SEARCH FAILED:",
              error.message
            );
          }
        }


        return res.json({

          mode: "answer",

          count:
            String(
              counterResults.length ||
              originalResults.length
            ),

          answer,

          results:
            counterResults

        });


      } catch (error) {

        /*
         * If OpenAI fails, do not expose internal
         * errors to the visitor.
         */
        console.error(
          "TROOLLgel AI failed:",
          error.message
        );


        /*
         * We still return a harmless fallback joke.
         */
        return res.json({

          mode: "answer",

          count: "0",

          answer:
            "The answer is currently hiding behind a suspiciously convenient curtain.",

          results: []

        });
      }
    }


    /*
     * STEP 3
     *
     * Normal search query.
     */
    return res.json({

      mode: "results",

      count:
        String(originalResults.length),

      answer: "",

      results:
        originalResults

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
