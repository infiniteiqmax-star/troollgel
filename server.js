const express = require("express");
const path = require("path");

const app = express();

const PORT =
  process.env.PORT || 3000;


app.use(
  express.json({
    limit:"20kb"
  })
);


app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);


const OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  "gpt-5.6-luna";


const TAVILY_URL =
  "https://api.tavily.com/search";


const OPENAI_URL =
  "https://api.openai.com/v1/responses";


/* =========================================================
   HELPERS
========================================================= */

function cleanText(value){

  return String(
    value || ""
  )
    .replace(/\s+/g," ")
    .trim();

}


function safeResults(results){

  return (
    Array.isArray(results)
      ? results
      : []
  )
    .slice(0,8)
    .map(
      function(item){

        return {

          title:
            cleanText(
              item.title
            ) ||
            "Untitled result",

          url:
            cleanText(
              item.url
            ),

          snippet:
            cleanText(
              item.content ||
              item.snippet
            )

        };

      }
    )
    .filter(
      function(item){

        return (
          item.title &&
          item.url
        );

      }
    );

}


/* =========================================================
   SOURCE DISPLAY DECISION
========================================================= */

/*
 * Sources should NOT be shown for simple factual questions.
 *
 * They SHOULD be shown when the user is clearly asking
 * for practical help, recommendations, places, products,
 * instructions, etc.
 */

function shouldShowSources(query){

  const q =
    cleanText(
      query
    ).toLowerCase();


  /*
   * Practical / recommendation queries.
   *
   * These get Sources.
   */

  const showPatterns = [

    /^how can i\b/,
    /^how to\b/,
    /^ways to\b/,

    /^best\b/,
    /^top\b/,

    /\brestaurants?\b/,
    /\bburgers?\b/,

    /\brecommendation\b/,
    /\brecommendations\b/,
    /\brecommended\b/,

    /\bwhere can i\b/,
    /\bplaces to\b/,
    /\bnear me\b/,

    /\bguide\b/,
    /\btutorial\b/,

    /\bfix\b/,
    /\brepair\b/,

    /\bbuy\b/,
    /\bshopping\b/,
    /\bproducts?\b/,

    /\brecipe\b/,
    /\brecipes\b/

  ];


  /*
   * Simple factual questions.
   *
   * These do NOT get Sources.
   */

  const hidePatterns = [

    /^why\b/,

    /^what is\b/,
    /^what are\b/,

    /^who is\b/,
    /^who was\b/,

    /^when was\b/,
    /^when did\b/,

    /^where is\b/,

    /^can\b/,
    /^could\b/,

    /^does\b/,
    /^do\b/,

    /^is\b/,
    /^are\b/,

    /^will\b/,

    /^how does\b/,
    /^how do\b/,

    /^why do\b/,
    /^why does\b/

  ];


  /*
   * Explicit practical queries always win.
   */

  if(
    showPatterns.some(
      function(pattern){

        return pattern.test(q);

      }
    )
  ){

    return true;

  }


  /*
   * Simple factual questions hide Sources.
   */

  if(
    hidePatterns.some(
      function(pattern){

        return pattern.test(q);

      }
    )
  ){

    return false;

  }


  /*
   * Default:
   *
   * normal search results keep their sources.
   */

  return true;

}


/* =========================================================
   TAVILY WEB SEARCH
========================================================= */

async function tavilySearch(query){

  if(
    !process.env.TAVILY_API_KEY
  ){

    throw new Error(
      "TAVILY_API_KEY is not configured."
    );

  }


  const response =
    await fetch(
      TAVILY_URL,
      {

        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:JSON.stringify({

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


  if(!response.ok){

    console.error(
      "================================="
    );

    console.error(
      "TAVILY ERROR"
    );

    console.error(
      JSON.stringify(
        data,
        null,
        2
      )
    );

    console.error(
      "================================="
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

function extractOpenAIText(data){

  /*
   * Normal Responses API output.
   */

  if(
    typeof data?.output_text ===
      "string" &&
    data.output_text.trim()
  ){

    return data.output_text.trim();

  }


  /*
   * Fallback: inspect output items.
   */

  const pieces = [];


  if(
    Array.isArray(
      data?.output
    )
  ){

    for(
      const item of data.output
    ){

      if(
        !Array.isArray(
          item?.content
        )
      ){

        continue;

      }


      for(
        const content of item.content
      ){

        if(
          content?.type ===
            "output_text" &&
          typeof content.text ===
            "string"
        ){

          pieces.push(
            content.text
          );

        }


        /*
         * Preserve refusal information
         * in the server logs.
         */

        if(
          content?.type ===
            "refusal" &&
          typeof content.refusal ===
            "string"
        ){

          console.error(
            "OPENAI REFUSAL:",
            content.refusal
          );

          return "";

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
){

  if(
    !process.env.OPENAI_API_KEY
  ){

    throw new Error(
      "OPENAI_API_KEY is not configured."
    );

  }


  /*
   * Give OpenAI enough web context
   * to make a useful answer.
   */

  const sourceText =
    results
      .slice(0,6)
      .map(
        function(r,i){

          return `

[SOURCE ${i + 1}]
TITLE: ${r.title}
URL: ${r.url}
CONTENT: ${r.snippet}

`;

        }
      )
      .join("\n");


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

Do NOT fabricate sources.

The backend will provide the actual sources
separately when they are useful.

You do NOT need to reproduce URLs
inside the answer.

----------------------------------------
OUTPUT
----------------------------------------

Return ONLY valid JSON.

The JSON must have exactly:

{
  "mode": "answer" or "results",
  "answer": "string",
  "results": []
}

For answer mode:

{
  "mode": "answer",
  "answer": "short answer",
  "results": []
}

For results mode:

{
  "mode": "results",
  "answer": "",
  "results": []
}

`;


  const response =
    await fetch(
      OPENAI_URL,
      {

        method:"POST",

        headers:{

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`

        },

        body:JSON.stringify({

          model:
            OPENAI_MODEL,

          input:[

            {
              role:"system",

              content:
                systemPrompt
            },

            {
              role:"user",

              content:`

SEARCH QUERY:

${query}

WEB SOURCES:

${sourceText}

`
            }

          ],

          /*
           * Keep the response deliberately small.
           */

          max_output_tokens:
            retry
              ? 300
              : 600,

          text:{

            format:{

              type:
                "json_schema",

              name:
                "trollgel_search",

              strict:
                true,

              schema:{

                type:
                  "object",

                additionalProperties:
                  false,

                properties:{

                  mode:{

                    type:
                      "string",

                    enum:[
                      "answer",
                      "results"
                    ]

                  },

                  answer:{

                    type:
                      "string"

                  },

                  results:{

                    type:
                      "array",

                    items:{

                      type:
                        "object",

                      additionalProperties:
                        false,

                      properties:{

                        title:{

                          type:
                            "string"

                        },

                        url:{

                          type:
                            "string"

                        },

                        snippet:{

                          type:
                            "string"

                        }

                      },

                      required:[

                        "title",
                        "url",
                        "snippet"

                      ]

                    }

                  }

                },

                required:[

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


  console.log("");
  console.log(
    "========================================"
  );
  console.log(
    "OPENAI RESPONSE"
  );
  console.log(
    "========================================"
  );


  console.log(
    "status:",
    data?.status
  );


  console.log(
    "model:",
    data?.model
  );


  console.log(
    "response id:",
    data?.id
  );


  console.log(
    "incomplete details:",
    JSON.stringify(
      data?.incomplete_details,
      null,
      2
    )
  );


  console.log(
    "error:",
    JSON.stringify(
      data?.error,
      null,
      2
    )
  );


  console.log(
    "output items:",
    Array.isArray(
      data?.output
    )
      ? data.output.length
      : 0
  );


  console.log(
    "========================================"
  );


  if(!response.ok){

    console.error(
      "OPENAI HTTP ERROR:"
    );


    console.error(
      JSON.stringify(
        data,
        null,
        2
      )
    );


    throw new Error(
      data?.error?.message ||
      "OpenAI request failed."
    );

  }


  const text =
    extractOpenAIText(
      data
    );


  if(!text){

    console.error("");
    console.error(
      "========================================"
    );

    console.error(
      "OPENAI RETURNED NO TEXT"
    );

    console.error(
      JSON.stringify(
        data,
        null,
        2
      )
    );

    console.error(
      "========================================"
    );


    throw new Error(
      "EMPTY_OPENAI_RESPONSE"
    );

  }


  console.log(
    "OPENAI TEXT:",
    text
  );


  console.log(
    "========================================"
  );


  let parsed;


  try{

    parsed =
      JSON.parse(
        text
      );

  }catch(error){

    console.error(
      "OPENAI RETURNED INVALID JSON:"
    );

    console.error(
      text
    );


    throw new Error(
      "OpenAI returned invalid JSON."
    );

  }


  return parsed;

}


/* =========================================================
   ASK OPENAI WITH RETRY
========================================================= */

async function askOpenAI(
  query,
  results
){

  try{

    return await callOpenAI(
      query,
      results,
      false
    );

  }catch(error){

    /*
     * If OpenAI returned no text,
     * immediately try once more with
     * a smaller request.
     */

    if(
      error.message ===
      "EMPTY_OPENAI_RESPONSE"
    ){

      console.warn(
        "OpenAI returned empty response. Retrying..."
      );


      try{

        return await callOpenAI(
          query,
          results,
          true
        );

      }catch(retryError){

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
){

  if(
    !ai ||
    typeof ai !== "object"
  ){

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

  if(
    ai.mode === "answer" &&
    answer
  ){

    return {

      mode:
        "answer",

      answer,

      results:
        webResults.slice(
          0,
          4
        )

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
  async function(req,res){

    const query =
      cleanText(
        req.body?.query
      );


    if(!query){

      return res
        .status(400)
        .json({

          error:
            "Missing query"

        });

    }


    if(
      query.length > 500
    ){

      return res
        .status(400)
        .json({

          error:
            "Query too long"

        });

    }


    try{

      /*
       * STEP 1
       *
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

      if(
        !webResults.length
      ){

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
       *
       * Let TROOLLgel decide
       * how to present the result.
       */

      let ai;


      try{

        ai =
          await askOpenAI(
            query,
            webResults
          );

      }catch(aiError){

        console.error(
          "================================="
        );

        console.error(
          "AI PRESENTATION FAILED"
        );

        console.error(
          aiError.message
        );

        console.error(
          "FALLING BACK TO NORMAL SEARCH"
        );

        console.error(
          "================================="
        );


        /*
         * Search still works
         * if AI fails.
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

      if(
        normalized.mode ===
          "answer" &&
        normalized.answer
      ){

        return res.json({

          mode:
            "answer",

          count:
            String(
              webResults.length
            ),

          answer:
            normalized.answer,

          /*
           * This is the important part.
           *
           * Frontend will ONLY show
           * Sources if this is true.
           */

          showSources:
            shouldShowSources(
              query
            ),

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


    }catch(error){

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
  function(){

    console.log(
      `TROOLLgel running on port ${PORT}`
    );

  }
);
