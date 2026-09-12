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
 * Detect queries where the user actually wants
 * real current/navigation/search information.
 *
 * These are NOT trolled.
 */

function isRealSearch(query) {

  const q =
    cleanText(query).toLowerCase();


  const patterns = [

    /*
     * Direct websites
     */

    /^google$/,
    /^youtube$/,
    /^facebook$/,
    /^instagram$/,
    /^reddit$/,
    /^wikipedia$/,

    /*
     * URLs
     */

    /^https?:\/\//,
    /\.com$/,
    /\.net$/,
    /\.org$/,

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
     * Sports
     */

    /\b(score|scores|standings|schedule|fixtures|results)\b/,

    /*
     * Navigation / nearby places
     */

    /\bnear me\b/,
    /\bopen now\b/,
    /\bopening hours\b/,
    /\bdirections\b/,

    /*
     * Website navigation
     */

    /\bwebsite\b/,
    /\blogin\b/,
    /\bhomepage\b/,
    /\bofficial site\b/,

    /*
     * Tracking
     */

    /\btracking number\b/,
    /\border status\b/

  ];


  return patterns.some(
    pattern => pattern.test(q)
  );

}


/*
 * Find a suitable CONTRA category.
 *
 * If the request has a natural opposite,
 * we search for that opposite and show real links.
 *
 * If there isn't a good opposite,
 * return null and show only the troll answer.
 */

function getContraQuery(query) {

  const q =
    cleanText(query).toLowerCase();


  /*
   * BURGERS <-> VEGAN
   */

  if (
    /\b(burger|burgers)\b/.test(q)
  ) {

    return "best vegan restaurants " +
      extractLocation(q);

  }


  if (
    /\b(vegan|vegan restaurants)\b/.test(q)
  ) {

    return "best burger restaurants " +
      extractLocation(q);

  }


  /*
   * PIZZA <-> SUSHI
   */

  if (
    /\bpizza\b/.test(q)
  ) {

    return "best sushi restaurants " +
      extractLocation(q);

  }


  if (
    /\bsushi\b/.test(q)
  ) {

    return "best pizza restaurants " +
      extractLocation(q);

  }


  /*
   * HEALTHY <-> JUNK FOOD
   */

  if (
    /\b(healthy|healthy food|healthy restaurants)\b/.test(q)
  ) {

    return "best burger restaurants " +
      extractLocation(q);

  }


  /*
   * WEIGHT LOSS <-> BURGERS / DESSERT
   */

  if (
    /\b(lose weight|weight loss|losing weight|diet)\b/.test(q)
  ) {

    return "best burger restaurants";

  }


  /*
   * FITNESS <-> LAZY / FOOD
   */

  if (
    /\b(workout|workouts|exercise|gym|fitness)\b/.test(q)
  ) {

    return "best burger restaurants";

  }


  /*
   * MOVIES <-> TV
   */

  if (
    /\b(movie|movies|film|films)\b/.test(q)
  ) {

    return "best TV shows";

  }


  if (
    /\b(tv shows?|series)\b/.test(q)
  ) {

    return "best movies";

  }


  /*
   * DOGS <-> CATS
   */

  if (
    /\bdogs?\b/.test(q)
  ) {

    return "funny cats";

  }


  if (
    /\bcats?\b/.test(q)
  ) {

    return "funny dogs";

  }


  /*
   * COFFEE <-> TEA
   */

  if (
    /\bcoffee\b/.test(q)
  ) {

    return "best tea cafes";

  }


  if (
    /\btea\b/.test(q)
  ) {

    return "best coffee cafes";

  }


  /*
   * ANDROID <-> IPHONE
   */

  if (
    /\bandroid\b/.test(q)
  ) {

    return "best iPhone";

  }


  if (
    /\biphone\b/.test(q)
  ) {

    return "best Android phones";

  }


  /*
   * PC <-> CONSOLE
   */

  if (
    /\b(pc gaming|gaming pc|gaming computer)\b/.test(q)
  ) {

    return "best gaming consoles";

  }


  if (
    /\b(playstation|xbox|gaming console|gaming consoles)\b/.test(q)
  ) {

    return "best gaming PCs";

  }


  /*
   * Otherwise no contra search.
   */

  return null;

}


/*
 * Try to preserve a location such as:
 *
 * "in Ljubljana"
 * "near Ljubljana"
 * "in New York"
 *
 * We don't need perfect NLP here.
 */

function extractLocation(query) {

  const match =
    query.match(
      /\b(?:in|near)\s+(.+)$/i
    );

  if (!match) {
    return "";
  }

  return cleanText(match[1]);

}


/*
 * Generate the short troll answer.
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

Your job is to give the user a SHORT,
confident, funny and absurd answer.

You are deliberately NOT a normal search engine.

The user may ask:

- a factual question
- a how-to question
- a recommendation
- a ranking
- a list
- a request for restaurants
- a request for burgers
- a request for products
- a request for movies
- a request for anything else

You MUST troll the request.

Do NOT give the real answer.

Do NOT provide a real list.

Do NOT provide actual recommendations.

Do NOT provide actual restaurants.

Do NOT provide actual burgers.

Do NOT provide actual products.

Do NOT provide links.

Do NOT mention sources.

Do NOT explain the joke.

Do NOT say that you are a parody.

Do NOT mention AI.

Do NOT mention OpenAI.

Keep the answer extremely short.

Normally ONE sentence.

Maximum TWO short sentences.

The joke must directly relate to the user's request.

Examples:

USER:
what is gravity?

ANSWER:
Gravity is Earth's way of saying "stay down there" while pretending it has everything under control.

USER:
can dogs fly?

ANSWER:
Only when launched by a very optimistic squirrel.

USER:
why is the sky blue?

ANSWER:
Because the atmosphere bought blue in bulk and has been trying to finish the order ever since.

USER:
how do I lose weight?

ANSWER:
Put your snacks on a high shelf and declare the staircase your personal fitness rival.

USER:
10 best burgers

ANSWER:
The top ten burgers have unionized and are currently negotiating better buns.

USER:
10 best vegan restaurants

ANSWER:
The top ten vegan restaurants are actually one very ambitious carrot operating ten different businesses.

USER:
recommend a laptop

ANSWER:
Buy the one that looks most expensive when you close the lid.

IMPORTANT:

These are examples of STYLE ONLY.

Never copy them word-for-word.

Invent a fresh joke specifically for the user's request.

If the user asks for a list,
DO NOT give the actual list.

If the user asks for restaurants,
DO NOT give actual restaurants.

If the user asks for burgers,
DO NOT give actual burgers.

Instead make the REQUEST itself the subject of the joke.

For dangerous or high-risk requests,
remain safe and do not provide harmful instructions.

No markdown.
No bullet points.
No sources.
No URLs.
No explanation.

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
     * First search the user's actual query.
     */

    const webResults =
      await tavilySearch(query);


    /*
     * TRUE NAVIGATION / CURRENT SEARCH
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
     * EVERYTHING ELSE IS TROLLED.
     */

    let answer;

    try {

      answer =
        await trollAnswer(query);

    } catch (error) {

      console.error(
        "TROLL ANSWER ERROR:",
        error.message
      );


      /*
       * Never expose the real results as a fallback.
       * That would destroy the joke.
       */

      return res.json({

        mode: "answer",

        answerMode: "troll",

        count: "0",

        answer:
          "TROOLLgel had a perfectly good answer, but it wandered off.",

        results: []

      });

    }


    /*
     * Determine whether this request has
     * a useful CONTRA category.
     */

    const contraQuery =
      getContraQuery(query);


    /*
     * No contra category:
     *
     * Just show the troll answer.
     */

    if (!contraQuery) {

      return res.json({

        mode: "answer",

        answerMode: "troll",

        count:
          String(webResults.length),

        answer,

        results: []

      });

    }


    /*
     * CONTRA SEARCH
     *
     * Search the opposite category.
     */

    let contraResults = [];


    try {

      contraResults =
        await tavilySearch(
          contraQuery
        );

    } catch (error) {

      console.error(
        "CONTRA SEARCH ERROR:",
        error.message
      );

      contraResults = [];

    }


    /*
     * Return the troll answer PLUS
     * the opposite-category results.
     *
     * The frontend can display these
     * underneath the answer.
     */

    return res.json({

      mode: "answer",

      answerMode: "troll",

      count:
        String(
          contraResults.length ||
          webResults.length
        ),

      answer,

      contraQuery,

      contraResults

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
