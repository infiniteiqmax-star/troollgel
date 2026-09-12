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
 * Decide whether a query should receive a TROOLLgel
 * joke or a normal real-world search.
 *
 * Simple curiosity questions -> TROOLLgel
 *
 * Recommendations, places, products, current events,
 * advice and practical searches -> normal search.
 */

function isTrollQuestion(query) {

  const q = cleanText(query).toLowerCase();

  if (!q) {
    return false;
  }


  /*
   * These searches MUST remain normal searches.
   */

  const normalSearchPatterns = [

    /*
     * Lists and rankings
     */

    /\b\d+\s+(best|top|greatest|worst)\b/,
    /\b(best|top|greatest|worst)\s+\d+\b/,

    /*
     * Restaurants, food and places
     */

    /\b(best|top)\b.*\b(restaurants?|burgers?|pizza|hotels?|bars?|cafes?|places?)\b/,

    /\b(vegan|vegetarian|gluten[- ]free|halal|kosher)\b.*\b(restaurants?|places?|food)\b/,

    /\b(restaurants?|hotels?|bars?|cafes?|burgers?|pizza)\b.*\b(near me|in|near|around)\b/,

    /\b(best|top)\b.*\b(restaurants?|hotels?|bars?|cafes?)\b/,

    /*
     * Finding / recommendations
     */

    /\b(where can i|where to|find me|show me)\b/,

    /\b(recommend|recommendation|recommendations|suggest|suggestions)\b/,

    /*
     * Current information
     */

    /\b(latest|today|current|recent|news|now)\b/,

    /*
     * Shopping / buying / booking
     */

    /\b(buy|purchase|order|book|reserve|reservation)\b/,

    /\b(price|prices|cost|cheap|cheapest|affordable)\b/,

    /*
     * Travel
     */

    /\b(flights?|hotels?|trips?|vacations?|holiday|travel)\b/,

    /*
     * Practical advice where the user wants a real answer
     */

    /\b(how can i|how do i)\b.*\b(lose weight|make money|invest|buy|find|book|get|learn|start|cook|fix|repair)\b/,

    /*
     * Financial / crypto searches
     */

    /\b(stock|stocks|bitcoin|crypto|cryptocurrency|market|shares)\b/,

    /*
     * Specific products / services
     */

    /\b(best)\b.*\b(laptop|phone|car|camera|shoes|tv|computer|product)\b/,

    /*
     * Location searches
     */

    /\b(near me|in ljubljana|in maribor|in slovenia)\b/

  ];


  /*
   * If the query looks like a real search,
   * never send it to TROOLLgel.
   */

  if (
    normalSearchPatterns.some(
      pattern => pattern.test(q)
    )
  ) {
    return false;
  }


  /*
   * Simple curiosity questions are TROOLLgel territory.
   */

  const trollStarters = [

    "why ",
    "what is ",
    "what are ",
    "can ",
    "could ",
    "does ",
    "do ",
    "is ",
    "are ",
    "how do ",
    "how does ",
    "why does ",
    "why do "

  ];


  /*
   * Explicit question mark + curiosity wording.
   */

  if (
    q.endsWith("?") &&
    trollStarters.some(
      start => q.startsWith(start)
    )
  ) {
    return true;
  }


  return false;

}


/*
 * Generate the actual TROOLLgel answer.
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

You are NOT a normal search assistant.

For ordinary harmless curiosity questions,
your job is to give a short, confident, funny,
deliberately wrong or absurd answer.

The joke should come from the answer itself.

CRITICAL RULE:

DO NOT give the normal factual answer and then add a joke.

DO NOT give a factual answer with a funny twist.

DO NOT explain the real answer first.

DO NOT hedge.

DO NOT say "technically".

DO NOT say "actually".

DO NOT say "however".

DO NOT correct yourself.

DO NOT give a normal answer followed by a joke.

Instead, confidently commit to a ridiculous explanation.

The user should immediately understand that
TROOLLgel is joking.

STYLE:

- dry
- deadpan
- confident
- clever
- unexpected
- short
- absurd
- conversational

Normally use ONE sentence.

Maximum TWO short sentences.

Examples of the STYLE:

Question: can dogs fly?

Good:
"No. Dogs skipped the wing upgrade and got zoomies instead."

Question: why is the sky blue?

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

IMPORTANT:

These examples are only style references.

Do NOT reuse them word-for-word unless
the user asks exactly the same question.

Create a fresh joke every time.

REAL WEB RESULTS ARE PROVIDED BELOW ONLY AS BACKGROUND.

Use them only to understand what the question is about.

NEVER mention the web results.

NEVER list sources.

NEVER quote sources.

NEVER say "according to sources".

NEVER mention AI, OpenAI, prompts, instructions or models.

NEVER write markdown.

NEVER write an essay.

NEVER explain your reasoning.

SAFETY:

For medical, self-harm, dangerous, criminal, weapons,
hate, personal-data, or high-stakes financial questions,
stay factual and safe instead of deliberately misleading.

For ordinary harmless curiosity questions,
prioritize the TROOLLgel joke.

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
     * First perform the real web search.
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
     * Curiosity question:
     * show TROOLLgel answer ONLY.
     *
     * IMPORTANT:
     * results are deliberately empty so the real
     * sources cannot appear underneath the joke.
     */

    if (isTrollQuestion(query)) {

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

          results: []

        });


      } catch (error) {

        console.error(
          "TROOLLgel AI failed:",
          error.message
        );


        /*
         * If AI fails, fall back to normal search.
         * Never show an ugly OpenAI error to the visitor.
         */

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
     * Real search:
     * show the actual results.
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
