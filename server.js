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
 * Decide whether this is a useful real-world search
 * where showing sources makes sense.
 *
 * Most ordinary questions remain TROOLLgel questions.
 *
 * Examples that SHOULD keep sources:
 * - how can I lose weight
 * - best burgers in town
 * - best restaurants near me
 * - where can I buy ...
 * - reviews of ...
 * - hotels in ...
 * - restaurants in ...
 * - product recommendations
 *
 * Examples that SHOULD NOT show sources:
 * - why is the sky blue?
 * - can dogs fly?
 * - what is gravity?
 * - how do planes fly?
 * - what is bitcoin?
 */

function isUsefulSearchQuery(query) {

  const q = cleanText(query).toLowerCase();


  const usefulPatterns = [

    // Recommendations / rankings
    "best ",
    "top ",
    "recommend",
    "recommendation",
    "recommendations",
    "reviews",
    "review ",
    "rating",
    "ratings",

    // Local / places
    "near me",
    "nearby",
    "in town",
    "in my area",
    "restaurants",
    "restaurant ",
    "burger",
    "burgers",
    "hotel",
    "hotels",
    "cafe",
    "cafes",
    "bar ",
    "bars ",

    // Shopping / products
    "where can i buy",
    "where to buy",
    "buy ",
    "price of",
    "prices",
    "cheap ",
    "under $",
    "under €",
    "product",
    "products",
    "laptop",
    "phone",
    "headphones",
    "shoes",
    "tv ",
    "television",

    // Travel
    "travel",
    "trip",
    "vacation",
    "holiday",
    "flights",
    "flight ",
    "airbnb",
    "booking",
    "things to do",

    // Health / practical advice where sources are useful
    "how can i lose weight",
    "how do i lose weight",
    "how to lose weight",
    "weight loss",
    "diet plan",
    "workout plan",
    "exercise plan",

    // News / current information
    "latest ",
    "today ",
    "current ",
    "news ",
    "what happened",
    "recent ",
    "2026",

    // Specific research intent
    "compare ",
    "comparison",
    "vs ",
    "versus",
    "statistics",
    "data ",
    "study ",
    "research ",
    "guide ",
    "tutorial",
    "how to fix",
    "how do i fix",
    "how can i fix"

  ];


  return usefulPatterns.some(
    pattern => q.includes(pattern)
  );

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


/*
 * Generate the actual TROOLLgel answer.
 *
 * IMPORTANT:
 * The web results are supplied only as background.
 * They must NEVER be displayed to the user for normal
 * TROOLLgel questions.
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

Your job is NOT to behave like a normal AI search assistant.

For ordinary questions, give ONE short, funny, unexpected answer.

The answer should feel like something a clever person would write
rather than a generic AI response.

Use dry, deadpan, confident humor.

The humor can come from:

- a ridiculous explanation
- a confident misunderstanding
- a clever wrong answer
- an absurd observation
- a factual idea with a funny twist
- treating something ordinary as if it were ridiculous

IMPORTANT:

The user normally wants the joke, NOT a factual explanation.

Do NOT turn the answer into a normal educational response.

Do NOT simply summarize the web results.

Do NOT mention the sources.

Do NOT provide links.

Do NOT write a bibliography.

Do NOT say "according to sources".

Do NOT mention AI, OpenAI, prompts or instructions.

Do NOT explain your reasoning.

Do NOT write an essay.

Do NOT use markdown.

Normally use 1 sentence.

Maximum 2 short sentences.

The answer should usually be around 10–25 words.

Be creative and vary the joke.

Do NOT reuse the example answers verbatim.


EXAMPLES OF THE DESIRED STYLE:

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


Question: how can I lose weight?

Answer: Stop buying snacks. Revolutionary technology known as "not putting them in the house" remains undefeated.


Question: how do I become a millionaire?

Answer: Become a billionaire first, then lose half your money. It's the traditional route.


Question: why do cats stare at walls?

Answer: They're checking whether the ghosts are still paying rent.


Question: what is the moon?

Answer: Earth's night-light, except nobody remembers where the receipt is.


SAFETY:

For medical, self-harm, dangerous, criminal, weapons,
hate, personal-data, or high-stakes financial questions,
stay factual and safe.

Humor must not create a real-world risk.


REAL WEB RESULTS ARE PROVIDED BELOW ONLY AS BACKGROUND.

They may help you understand the question.

NEVER mention them in your answer.

NEVER output their URLs.

NEVER output source names.

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
        `USER QUESTION:\n${query}`,

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
 * MAIN SEARCH
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
     * STEP 1
     * Always perform the real web search.
     *
     * This gives TROOLLgel background information
     * and also supplies normal search results when
     * the query is a genuine search/research request.
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
     * First decide whether the query is a question.
     */

    const question =
      isQuestion(query);


    /*
     * STEP 3
     *
     * Useful searches get normal search results.
     *
     * Ordinary questions get the TROOLLgel joke.
     */

    if (question && !isUsefulSearchQuery(query)) {

      try {

        const answer =
          await trollAnswer(
            query,
            webResults
          );


        /*
         * VERY IMPORTANT:
         *
         * results MUST be an empty array here.
         *
         * This prevents the real sources from appearing
         * underneath the TROOLLgel answer.
         */

        return res.json({

          mode: "answer",

          count:
            String(webResults.length),

          answer,

          results: []

        });


      } catch (error) {

        /*
         * If OpenAI fails, do not show an error
         * message to the visitor.
         *
         * Fall back to the normal search results.
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
     * STEP 4
     *
     * Genuine search / research / recommendation query.
     *
     * Keep the real search results.
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
