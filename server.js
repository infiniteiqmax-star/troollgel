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
 * NAVIGATIONAL / REAL SEARCH QUERIES
 *
 * These are things where the user actually wants
 * to find a website, current information, a place,
 * a product, a result, etc.
 *
 * These should NOT be trolled.
 */

function isRealSearch(query) {

  const q =
    cleanText(query).toLowerCase();


  const patterns = [

    /*
     * Specific websites
     */

    /^google$/,
    /^youtube$/,
    /^facebook$/,
    /^instagram$/,
    /^reddit$/,
    /^wikipedia$/,

    /*
     * URLs / domains
     */

    /\.com$/,
    /\.net$/,
    /\.org$/,
    /^https?:\/\//,

    /*
     * Current information
     */

    /\b(latest|today|current|now|live|breaking|news)\b/,

    /*
     * Prices / markets
     */

    /\b(stock price|share price|btc price|bitcoin price|crypto price)\b/,
    /\b(exchange rate|currency rate)\b/,

    /*
     * Sports scores / results
     */

    /\b(score|scores|result|results|standings|schedule)\b/,

    /*
     * Specific places / navigation
     */

    /\bnear me\b/,
    /\bdirections\b/,
    /\bopening hours\b/,
    /\bopen now\b/,

    /*
     * Specific websites/pages
     */

    /\bwebsite\b/,
    /\blogin\b/,
    /\bhomepage\b/,
    /\bofficial site\b/,

    /*
     * Specific product lookup
     */

    /\btracking number\b/,
    /\border status\b/,

    /*
     * Specific news/current person searches
     */

    /\bwhat happened to\b/,
    /\bwhere is\b.*\bnow\b/

  ];


  return patterns.some(
    pattern => pattern.test(q)
  );

}


/*
 * EVERYTHING ELSE THAT LOOKS LIKE A QUESTION
 * OR A REQUEST FOR INFORMATION IS TROLLED.
 *
 * This is intentionally broad.
 *
 * Examples:
 *
 * what is gravity?
 * can dogs fly?
 * how do I lose weight?
 * why is the sky blue?
 * 10 best burgers
 * 10 best vegan restaurants
 * best pizza in town
 * give me 5 good movies
 * recommend a laptop
 *
 * All of those can become TROOLLgel answers.
 */

function shouldTroll(query) {

  if (isRealSearch(query)) {
    return false;
  }

  return true;

}


/*
 * TROOLL ANSWER
 */

async function trollAnswer(query) {

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured."
    );
  }


  const instructions = `

You are TROOLLgel.

TROOLLgel is a parody search engine.

Your job is to answer the user's request with
a SHORT, CONFIDENT, FUNNY, ABSURD answer.

You are deliberately NOT a normal search engine.

IMPORTANT:

The user may ask:

- a factual question
- a "how do I" question
- a recommendation
- a ranking
- a list
- a shopping question
- a request for restaurants
- a request for burgers
- a request for movies
- a request for products
- basically anything that is not clearly a
  navigational/current-information search.

You MUST troll these requests.

DO NOT simply give the real answer.

DO NOT give a real list.

DO NOT provide real recommendations.

DO NOT provide actual restaurants.

DO NOT provide actual burgers.

DO NOT provide actual products.

DO NOT provide links.

DO NOT list sources.

DO NOT explain that you are joking.

The answer should be obviously absurd,
confident and deadpan.

Keep it VERY SHORT.

Normally ONE sentence.

Maximum TWO short sentences.

The humor should directly relate to the request.

Examples:

USER:
what is gravity?

GOOD:
"Gravity is Earth's way of politely asking everyone to remain where they were placed."

USER:
can dogs fly?

GOOD:
"Only when launched by a very optimistic squirrel."

USER:
why is the sky blue?

GOOD:
"Because the atmosphere ordered blue in bulk and has been trying to use it up ever since."

USER:
how do I lose weight?

GOOD:
"Put your snacks on a high shelf and declare the staircase your personal fitness rival."

USER:
how do I become a millionaire?

GOOD:
"Become a billionaire first, then make several exciting financial decisions."

USER:
what are the 10 best burgers?

GOOD:
"The top ten burgers are currently unavailable because they formed a union and demanded better buns."

USER:
give me 10 best burgers in town

GOOD:
"I checked the rankings, and Burger #1 has been disqualified for excessive confidence."

USER:
10 best vegan restaurants

GOOD:
"The top ten are all secretly run by one very tired carrot."

USER:
recommend a laptop

GOOD:
"Buy the one that looks most expensive when you close the lid."

USER:
give me 5 good movies

GOOD:
"Five excellent films exist, but they are currently hiding from people who ask for lists."

USER:
what is bitcoin?

GOOD:
"Bitcoin is a spreadsheet that escaped the office and discovered that people enjoy making things unnecessarily complicated."

USER:
how do planes fly?

GOOD:
"Mostly by moving forward fast enough to convince gravity that it has somewhere else to be."

IMPORTANT:

These are STYLE examples only.

NEVER copy them word-for-word unless the user asks
the exact same question.

Always invent a fresh answer.

VERY IMPORTANT:

Do not turn the joke into a factual answer.

For example, if the user asks:

"10 best burgers in town"

DO NOT respond with actual burger names.

DO NOT respond with actual restaurants.

DO NOT provide a real ranking.

Instead produce a short absurd joke ABOUT the ranking.

If the user asks:

"10 best vegan restaurants"

DO NOT give actual restaurants.

Make fun of the request instead.

If the user asks:

"how can I lose weight"

DO NOT give normal weight-loss advice.

Make it a funny TROOLLgel answer.

The only exception is genuinely dangerous content,
where you must remain safe and must not provide
harmful instructions.

DO NOT mention AI.

DO NOT mention OpenAI.

DO NOT mention prompts.

DO NOT mention instructions.

DO NOT mention sources.

DO NOT use markdown.

DO NOT use bullet points.

DO NOT write an essay.

DO NOT use a disclaimer.

USER REQUEST:

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

      max_output_tokens: 250

    })

  });


  const data = await response.json();


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

    throw new Error(
      "EMPTY_OPENAI_RESPONSE"
    );

  }


  return text;

}


/*
 * MAIN SEARCH ENDPOINT
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
     * First do a real search.
     *
     * This gives TROOLLgel context if needed,
     * but the results are NOT shown when we troll.
     */

    const webResults =
      await tavilySearch(query);


    /*
     * NAVIGATIONAL / CURRENT SEARCH
     *
     * Show real results.
     */

    if (isRealSearch(query)) {

      return res.json({

        mode: "results",

        count:
          String(webResults.length),

        answer: "",

        results:
          webResults

      });

    }


    /*
     * EVERYTHING ELSE
     *
     * TROLL.
     */

    if (shouldTroll(query)) {

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
           * VERY IMPORTANT:
           *
           * No sources underneath the troll.
           */

          results: []

        });


      } catch (error) {

        console.error(
          "TROOLLgel AI failed:",
          error.message
        );


        /*
         * DO NOT reveal the real search results
         * when a troll answer fails.
         *
         * Give a short fallback troll instead.
         */

        return res.json({

          mode: "answer",

          answerMode: "troll",

          count: "0",

          answer:
            "TROOLLgel knows the answer, but it has temporarily misplaced it.",

          results: []

        });

      }

    }


    /*
     * Final fallback.
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
