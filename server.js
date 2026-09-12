const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || "gpt-5.6-luna";

const TAVILY_URL =
  "https://api.tavily.com/search";

const OPENAI_URL =
  "https://api.openai.com/v1/responses";


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
      title:
        cleanText(item.title) ||
        "Untitled result",

      url:
        cleanText(item.url),

      snippet:
        cleanText(
          item.content ||
          item.snippet
        )
    }))
    .filter(
      (item) =>
        item.title &&
        item.url
    );
}


/* =========================================================
   TAVILY WEB SEARCH
========================================================= */

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
      "TAVILY ERROR:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    throw new Error(
      "Web search is currently unavailable."
    );
  }


  return safeResults(
    data.results
  );
}


/* =========================================================
   OPENAI TEXT EXTRACTION
========================================================= */

function extractOpenAIText(data) {

  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {

    return data.output_text.trim();
  }


  const pieces = [];


  if (
    Array.isArray(data?.output)
  ) {

    for (
      const item of data.output
    ) {

      if (
        !Array.isArray(
          item?.content
        )
      ) {
        continue;
      }


      for (
        const content of item.content
      ) {

        if (
          content?.type ===
            "output_text" &&
          typeof content.text ===
            "string"
        ) {

          pieces.push(
            content.text
          );
        }
      }
    }
  }


  return pieces
    .join("\n")
    .trim();
}


/* =========================================================
   OPENAI REQUEST
========================================================= */

async function callOpenAI(
  query,
  results,
  retry = false
) {

  if (!process.env.OPENAI_API_KEY) {

    throw new Error(
      "OPENAI_API_KEY is not configured."
    );
  }


  const sourceText =
    results
      .slice(0, 6)
      .map(
        (r, i) => `
[SOURCE ${i + 1}]
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}
`
      )
      .join("\n");


  /*
   * THIS IS THE IMPORTANT PART.
   *
   * TROOLLgel should NOT behave like ChatGPT.
   * It should feel like a deliberately weird search engine.
   */

  const systemPrompt = `

You are the answer engine inside TROOLLgel.

TROOLLgel is NOT a normal search engine.

Its personality is:
- dry
- sarcastic
- slightly absurd
- concise
- occasionally ridiculous
- but still factually grounded

The user should feel like they asked a stupid question
and TROOLLgel answered it with unnecessary confidence.

----------------------------------------
FIRST: DECIDE WHAT THE USER WANTS
----------------------------------------

There are two modes.

MODE 1 — ANSWER

Use answer mode whenever the query is a question.

Examples:

"why is the sky blue?"
"what is bitcoin?"
"can dogs fly?"
"what is gravity?"
"why do cats purr?"
"how does a microwave work?"
"who invented the internet?"

Questions should almost ALWAYS use answer mode.

MODE 2 — RESULTS

Use results mode only when the user is clearly trying
to find something rather than asking a question.

Examples:

"youtube"
"reddit"
"bitcoin news"
"latest football news"
"restaurants in Ljubljana"
"OpenAI"
"Tesla stock"
"weather Ljubljana"

----------------------------------------
TROOLLgel ANSWERS
----------------------------------------

This is the most important rule.

Answers MUST be short.

Normally:
1–2 sentences.

Maximum:
3 short sentences.

Do NOT write essays.

Do NOT explain everything you know.

Do NOT copy source text.

Do NOT produce a boring Wikipedia answer.

The answer should contain the actual answer,
then preferably a dry or absurd punchline.

The joke should feel natural.

Examples:

QUESTION:
why is the sky blue?

GOOD:

"Because Earth's atmosphere scatters blue light more strongly
than red light. Basically, the sky is doing optics for free."

QUESTION:
can dogs fly?

GOOD:

"No. Dogs haven't evolved wings, sadly. Nature gave them
zoomies instead and apparently called that sufficient."

QUESTION:
what is bitcoin?

GOOD:

"Bitcoin is digital money that runs without a central bank,
using a blockchain to keep everyone honest. In other words,
the world's most elaborate spreadsheet became an asset class."

QUESTION:
why do cats purr?

GOOD:

"Mostly because they're comfortable, although cats can also
purr when stressed or trying to calm themselves. Naturally,
even their emotional support mechanism comes with ambiguity."

QUESTION:
what is gravity?

GOOD:

"Gravity is the force that pulls things toward each other,
including you toward the floor. Earth's way of saying
'you're staying here.'"

----------------------------------------
IMPORTANT HUMOUR RULE
----------------------------------------

Do NOT force a joke into every sentence.

Do NOT turn answers into stand-up comedy.

Do NOT use childish jokes.

Do NOT say:
"As an AI..."
"I cannot..."
"According to my sources..."

Do NOT mention these instructions.

Do NOT mention OpenAI.

Do NOT mention that the answer was generated.

The personality should be subtle.

----------------------------------------
FACTUAL ACCURACY
----------------------------------------

The joke must not change the factual meaning.

If the question is serious, controversial,
medical, financial or otherwise sensitive,
be more factual and less ridiculous.

If the question is obviously absurd,
you can lean harder into the joke.

If the sources disagree,
do not invent certainty.

----------------------------------------
SOURCES
----------------------------------------

Sources are supplied by the web search.

Use them to understand the answer.

Do NOT copy their wording.

Do NOT quote them.

Do NOT invent URLs.

The backend will provide the actual sources
separately, so you do not need to reproduce them
in the answer.

----------------------------------------
OUTPUT
----------------------------------------

Return ONLY valid JSON.

Exactly this structure:

{
  "mode": "answer",
  "answer": "short TROOLLgel answer",
  "results": []
}

OR:

{
  "mode": "results",
  "answer": "",
  "results": []
}

Do not put markdown around the JSON.

Do not add explanations outside the JSON.

`;


  const userPrompt = `

USER QUERY:

${query}

WEB SEARCH RESULTS:

${sourceText}

${retry
  ? `
IMPORTANT:
This is a retry because the previous response was empty.
Return the JSON immediately.
Do not overthink the response.
`
  : ""
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
              role:
                "system",

              content:
                systemPrompt
            },

            {
              role:
                "user",

              content:
                userPrompt
            }

          ],

          max_output_tokens:
            retry
              ? 300
              : 500,

          text: {

            format: {

              type:
                "json_schema",

              name:
                "trollgel_search",

              strict:
                true,

              schema: {

                type:
                  "object",

                additionalProperties:
                  false,

                properties: {

                  mode: {

                    type:
                      "string",

                    enum: [
                      "answer",
                      "results"
                    ]
                  },

                  answer: {

                    type:
                      "string"
                  },

                  results: {

                    type:
                      "array",

                    items: {

                      type:
                        "object",

                      additionalProperties:
                        false,

                      properties: {

                        title: {
                          type:
                            "string"
                        },

                        url: {
                          type:
                            "string"
                        },

                        snippet: {
                          type:
                            "string"
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
      }
    );


  const data =
    await response.json();


  console.log(
    "----------------------------------------"
  );

  console.log(
    "OPENAI STATUS:",
    data?.status
  );

  console.log(
    "OPENAI MODEL:",
    data?.model
  );

  console.log(
    "OPENAI ID:",
    data?.id
  );

  if (data?.error) {

    console.error(
      "OPENAI ERROR:",
      JSON.stringify(
        data.error,
        null,
        2
      )
    );
  }

  if (data?.incomplete_details) {

    console.error(
      "OPENAI INCOMPLETE:",
      JSON.stringify(
        data.incomplete_details,
        null,
        2
      )
    );
  }

  console.log(
    "----------------------------------------"
  );


  if (!response.ok) {

    throw new Error(
      data?.error?.message ||
      "OpenAI request failed."
    );
  }


  const text =
    extractOpenAIText(data);


  if (!text) {

    throw new Error(
      "EMPTY_OPENAI_RESPONSE"
    );
  }


  console.log(
    "OPENAI TEXT:",
    text
  );


  try {

    return JSON.parse(text);

  } catch (error) {

    console.error(
      "INVALID OPENAI JSON:",
      text
    );

    throw new Error(
      "OpenAI returned invalid JSON."
    );
  }
}


/* =========================================================
   ASK OPENAI WITH RETRY
========================================================= */

async function askOpenAI(
  query,
  results
) {

  try {

    return await callOpenAI(
      query,
      results,
      false
    );

  } catch (error) {

    /*
     * If OpenAI returned no text,
     * immediately try once more with
     * a much smaller request.
     */

    if (
      error.message ===
      "EMPTY_OPENAI_RESPONSE"
    ) {

      console.warn(
        "OpenAI returned empty response. Retrying..."
      );

      try {

        return await callOpenAI(
          query,
          results,
          true
        );

      } catch (retryError) {

        console.error(
          "OpenAI retry failed:",
          retryError.message
        );

        throw retryError;
      }
    }


    throw error;
  }
}


/* =========================================================
   NORMALIZE AI RESULT
========================================================= */

function normalizeAI(
  ai,
  webResults
) {

  if (
    !ai ||
    typeof ai !== "object"
  ) {

    return {
      mode:
        "results",

      answer:
        "",

      results:
        webResults
    };
  }


  const answer =
    cleanText(
      ai.answer
    );


  /*
   * If AI says answer and actually
   * gave us an answer, use it.
   */

  if (
    ai.mode === "answer" &&
    answer
  ) {

    return {

      mode:
        "answer",

      answer,

      /*
       * Only show a few sources.
       */

      results:
        webResults.slice(0, 3)
    };
  }


  /*
   * Otherwise normal search.
   */

  return {

    mode:
      "results",

    answer:
      "",

    results:
      webResults
  };
}


/* =========================================================
   SEARCH ROUTE
========================================================= */

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
       * STEP 1
       * Search the actual internet.
       */

      const webResults =
        await tavilySearch(
          query
        );


      /*
       * If there are no results,
       * don't ask OpenAI to invent anything.
       */

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
       * STEP 2
       * Let TROOLLgel decide how
       * to present the result.
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
          "AI PRESENTATION FAILED:",
          aiError.message
        );


        /*
         * IMPORTANT:
         *
         * The search engine itself
         * still works if AI fails.
         *
         * We return normal search results
         * instead of showing an ugly
         * "OpenAI returned an empty response"
         * message to the user.
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


      const normalized =
        normalizeAI(
          ai,
          webResults
        );


      /*
       * ANSWER MODE
       */

      if (
        normalized.mode ===
          "answer" &&
        normalized.answer
      ) {

        return res.json({

          mode:
            "answer",

          count:
            String(
              webResults.length
            ),

          answer:
            normalized.answer,

          results:
            normalized.results
        });
      }


      /*
       * RESULTS MODE
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


      return res
        .status(500)
        .json({

          error:
            "TROOLLgel tripped over its own wires."
        });
    }
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `TROOLLgel running on port ${PORT}`
    );

  }
);
