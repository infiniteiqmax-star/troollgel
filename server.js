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


function shorten(text, max = 420) {
  text = cleanText(text);

  if (text.length <= max) {
    return text;
  }

  return text.slice(0, max).trim() + "...";
}


function safeResults(results) {

  return (Array.isArray(results) ? results : [])
    .slice(0, 8)
    .map((item) => ({

      title:
        cleanText(item.title) ||
        "Untitled result",

      url:
        cleanText(item.url),

      snippet:
        shorten(
          item.content || item.snippet || "",
          420
        )

    }))
    .filter(
      (item) =>
        item.title &&
        item.url
    );
}


/*
==================================================
TAVILY
==================================================
*/

async function tavilySearch(query) {

  if (!process.env.TAVILY_API_KEY) {
    throw new Error(
      "TAVILY_API_KEY is not configured."
    );
  }

  const response = await fetch(
    TAVILY_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({

        api_key:
          process.env.TAVILY_API_KEY,

        query,

        search_depth:
          "advanced",

        topic:
          "general",

        max_results:
          8,

        include_answer:
          false,

        include_raw_content:
          false

      })
    }
  );


  const data =
    await response.json();


  if (!response.ok) {

    console.error(
      "Tavily error:",
      data
    );

    throw new Error(
      "Web search is currently unavailable."
    );
  }


  return safeResults(
    data.results
  );
}


/*
==================================================
OPENAI
==================================================
*/

async function askOpenAI(
  query,
  results
) {

  if (!process.env.OPENAI_API_KEY) {

    throw new Error(
      "OPENAI_API_KEY is not configured."
    );

  }


  const sourceText =
    results
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

TROOLLgel is a search engine that looks normal at first,
but has a slightly cheeky, dry and unpredictable personality.

Your job is NOT to behave like a generic AI assistant.

You have two possible modes:

"answer"
or
"results"


========================================
WHEN TO USE "ANSWER"
========================================

Use "answer" when the user is clearly asking a question.

Examples:

what is bitcoin?
can dogs fly?
why is the sky blue?
how does inflation work?
who invented the telephone?
what is gravity?
is coffee healthy?
how does a black hole work?


The answer MUST be SHORT.

Normally:

1 to 3 sentences.

Sometimes even one sentence is enough.


DO NOT:

- write an article
- give a long explanation
- repeat the sources
- dump statistics
- summarize every source
- tell the user to read the sources
- write a generic ChatGPT essay


The answer should give the useful information immediately.


========================================
TROOLLgel PERSONALITY
========================================

The answer should often have a small amount of dry,
cheeky or absurd personality.

Think:

short
clever
slightly sarcastic
occasionally ridiculous

But factual accuracy comes first.


Examples:


QUESTION:
can dogs fly?

GOOD:

"No. Dogs haven't evolved wings yet, so gravity remains undefeated.
They can, however, fly commercially."



QUESTION:
what is bitcoin?

GOOD:

"Bitcoin is a decentralized digital currency that lets people transfer
value without a central bank. Basically, internet money that decided
it didn't want a boss."



QUESTION:
why is the sky blue?

GOOD:

"Because Earth's atmosphere scatters blue light from sunlight more
strongly than most other visible colors. The sky is basically doing
optics for free."



QUESTION:
what is 2+2?

GOOD:

"4. We checked with the calculator, and it reluctantly agreed."


========================================
IMPORTANT
========================================

Do NOT force a joke into every answer.

Some questions should simply get a clean,
straightforward answer.

The personality should feel natural,
not like a comedy routine.


========================================
WHEN TO USE "RESULTS"
========================================

Use "results" when the user is searching for:

- websites
- specific pages
- products
- shopping
- news
- places
- companies
- images
- videos
- current information where several sources matter
- a specific person or organization
- anything where links are more useful than an explanation


Examples:

Nike Air Max 95
Bitcoin price
OpenAI
YouTube
restaurants in Ljubljana
latest Bitcoin news
Amazon
Barcelona tickets


For these searches, return the web results.


========================================
SOURCE RULES
========================================

Use the supplied web sources as factual grounding.

Never invent:

- URLs
- websites
- facts
- citations
- claims about what a source says


If the sources do not contain enough information,
give the safest useful answer you can from the supplied material.


========================================
ANSWER LENGTH
========================================

This is extremely important.

For "answer" mode:

Maximum approximately 350 characters unless
the question genuinely requires more.

Prefer 100-250 characters.

SHORT IS BETTER.


========================================
OUTPUT
========================================

Return ONLY valid JSON.

Exactly this structure:

{
  "mode": "answer" or "results",
  "answer": "string or empty string",
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string"
    }
  ]
}

`;


  const response =
    await fetch(
      OPENAI_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`
        },

        body: JSON.stringify({

          model:
            OPENAI_MODEL,

          input: [

            {
              role: "system",

              content:
                systemPrompt
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

          text: {

            format: {
              type: "json_object"
            }

          }

        })
      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    console.error(
      "OpenAI error:",
      data
    );

    throw new Error(
      data?.error?.message ||
      "OpenAI request failed."
    );

  }


  /*
   * Extract the generated text directly
   * from the Responses API output.
   */

  let outputText = "";


  if (
    Array.isArray(data.output)
  ) {

    for (
      const item of data.output
    ) {

      if (
        !Array.isArray(
          item.content
        )
      ) {
        continue;
      }


      for (
        const content of item.content
      ) {

        if (
          content &&
          content.type ===
            "output_text" &&
          typeof content.text ===
            "string"
        ) {

          outputText +=
            content.text;

        }

      }

    }

  }


  outputText =
    outputText.trim();


  if (!outputText) {

    console.error(
      "OpenAI returned no usable text:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      "OpenAI returned an empty response."
    );

  }


  let parsed;


  try {

    parsed =
      JSON.parse(
        outputText
      );

  } catch (error) {

    console.error(
      "Invalid OpenAI JSON:",
      outputText
    );

    throw new Error(
      "OpenAI returned invalid JSON."
    );

  }


  return parsed;
}


/*
==================================================
SEARCH API
==================================================
*/

app.post(
  "/api/search",
  async (req, res) => {

    const query =
      cleanText(
        req.body?.query
      );


    if (!query) {

      return res
        .status(400)
        .json({
          error:
            "Missing query"
        });

    }


    if (
      query.length > 500
    ) {

      return res
        .status(400)
        .json({
          error:
            "Query too long"
        });

    }


    try {

      /*
      ----------------------------------------------
      STEP 1
      REAL WEB SEARCH
      ----------------------------------------------
      */

      const webResults =
        await tavilySearch(
          query
        );


      if (
        !webResults.length
      ) {

        return res.json({

          mode:
            "results",

          count:
            "0",

          answer:
            "",

          results:
            []

        });

      }


      /*
      ----------------------------------------------
      STEP 2
      AI DECIDES HOW TO PRESENT IT
      ----------------------------------------------
      */

      let ai;


      try {

        ai =
          await askOpenAI(
            query,
            webResults
          );

      } catch (aiError) {

        console.error(
          "AI presentation error:",
          aiError
        );


        /*
         * If AI fails, don't kill the search.
         * Show the actual web results.
         */

        return res.json({

          mode:
            "results",

          count:
            String(
              webResults.length
            ),

          answer:
            "",

          results:
            webResults

        });

      }


      const mode =
        ai?.mode === "answer"
          ? "answer"
          : "results";


      /*
      ----------------------------------------------
      ANSWER MODE
      ----------------------------------------------
      */

      if (
        mode === "answer" &&
        cleanText(ai.answer)
      ) {

        return res.json({

          mode:
            "answer",

          count:
            String(
              webResults.length
            ),

          answer:
            shorten(
              ai.answer,
              500
            ),

          results:
            webResults.slice(
              0,
              4
            )

        });

      }


      /*
      ----------------------------------------------
      RESULTS MODE
      ----------------------------------------------
      */

      return res.json({

        mode:
          "results",

        count:
          String(
            webResults.length
          ),

        answer:
          "",

        results:
          webResults

      });


    } catch (error) {

      console.error(
        "Search error:",
        error
      );


      return res
        .status(500)
        .json({

          error:
            error.message ||
            "TROOLLgel tripped over its own wires."

        });

    }

  }
);


/*
==================================================
START
==================================================
*/

app.listen(
  PORT,
  () => {

    console.log(
      `TROOLLgel running on port ${PORT}`
    );

  }
);
