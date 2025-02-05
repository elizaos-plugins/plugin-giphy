// src/actions/sendGif.ts
import {
  composeContext,
  elizaLogger as elizaLogger2,
  generateObjectDeprecated,
  ModelClass
} from "@elizaos/core";
import axios from "axios";

// src/utils/debug.ts
import { elizaLogger } from "@elizaos/core";
var debugLog = {
  request: (method, url, data) => {
    elizaLogger.log("\u{1F310} API Request:", {
      method,
      url,
      data: data || "No data"
    });
  },
  response: (response) => {
    elizaLogger.log("\u2705 API Response:", {
      status: response?.status,
      data: response?.data || "No data"
    });
  },
  error: (error) => {
    elizaLogger.error("\u26D4 Error Details:", {
      message: error?.message,
      response: {
        status: error?.response?.status,
        data: error?.response?.data
      },
      config: {
        url: error?.config?.url,
        method: error?.config?.method,
        data: error?.config?.data
      }
    });
  },
  validation: (config) => {
    elizaLogger.log("\u{1F50D} Config Validation:", config);
  }
};

// src/environment.ts
import { z } from "zod";
var giphyEnvSchema = z.object({
  GIPHY_API_KEY: z.string().min(1, "Giphy API key is required")
});
async function validateGiphyConfig(runtime) {
  try {
    const config = {
      GIPHY_API_KEY: runtime.getSetting("GIPHY_API_KEY")
    };
    return giphyEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `Giphy configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}

// src/actions/sendGif.ts
import crypto from "node:crypto";
var sendGifTemplate = `Given the message, determine if a gif should be sent based on the content.
If yes, extract relevant keywords or phrases to use as search terms for the gif.

Format the response as a JSON object with these fields:
- trigger: boolean (whether to send a gif)
- searchTerm: string (keywords to search for the gif, required if trigger is true)

Example response:
\`\`\`json
{
    "trigger": true,
    "searchTerm": "pudgy penguins beach"
}
\`\`\`

{{recentMessages}}

Analyze the above messages and decide whether to respond with a gif. If so, specify the search term.
`;
var GIPHY_SEARCH_ENDPOINT = "https://api.giphy.com/v1/gifs/search";
var sendGif_default = {
  name: "SEND_GIF",
  similes: ["REPLY_WITH_GIF", "GIF_RESPONSE"],
  validate: async (runtime, _message) => {
    elizaLogger2.log("\u{1F504} Validating Giphy configuration...");
    try {
      const config = await validateGiphyConfig(runtime);
      debugLog.validation(config);
      return true;
    } catch (error) {
      debugLog.error(error);
      return false;
    }
  },
  description: "Respond with a gif based on the user's message",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger2.log("\u{1F680} Starting Giphy SEND_GIF handler...");
    let currentState = state;
    if (!currentState) {
      elizaLogger2.log("Creating new state...");
      currentState = await runtime.composeState(message);
    } else {
      elizaLogger2.log("Updating existing state...");
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    try {
      elizaLogger2.log("Composing gif trigger context...");
      const gifContext = composeContext({
        state: currentState,
        template: sendGifTemplate
      });
      elizaLogger2.log("Generating content from context...");
      const content = await generateObjectDeprecated({
        runtime,
        context: gifContext,
        modelClass: ModelClass.LARGE
      });
      if (!content) {
        throw new Error("Failed to parse gif trigger content");
      }
      debugLog.validation(content);
      if (!content.trigger || !content.searchTerm) {
        elizaLogger2.log("No gif triggered for this message.");
        return false;
      }
      const config = await validateGiphyConfig(runtime);
      const requestParams = {
        api_key: config.GIPHY_API_KEY,
        q: content.searchTerm,
        limit: 10,
        rating: "pg",
        lang: "en"
        // Optional: specify language for better results
      };
      debugLog.request("GET", GIPHY_SEARCH_ENDPOINT, requestParams);
      const response = await axios.get(
        GIPHY_SEARCH_ENDPOINT,
        {
          params: requestParams
        }
      );
      debugLog.response(response);
      elizaLogger2.log(
        "Full Giphy API Response:",
        JSON.stringify(response.data, null, 2)
      );
      const gifs = response.data.data;
      if (!gifs.length) {
        throw new Error(
          `No gifs found for search term: ${content.searchTerm}`
        );
      }
      const gifGifs = gifs.filter(
        (gif) => gif.images.original.url.includes(".gif")
      );
      if (!gifGifs.length) {
        throw new Error(
          `No valid GIFs found for search term: ${content.searchTerm}`
        );
      }
      const selectedGif = gifGifs[Math.floor(Math.random() * gifGifs.length)];
      elizaLogger2.log(
        "Selected GIF:",
        JSON.stringify(selectedGif, null, 2)
      );
      const gifUrl = selectedGif.images.original.url.split("?")[0];
      if (!gifUrl.endsWith(".gif")) {
        throw new Error(`Invalid GIF URL format: ${gifUrl}`);
      }
      if (callback) {
        const message2 = {
          text: "Here's a GIF for you!",
          attachments: [
            {
              id: crypto.randomUUID(),
              url: gifUrl,
              // Use the original Giphy URL directly
              title: "Enjoy your GIF!",
              source: "giphyPlugin",
              description: selectedGif.title,
              text: selectedGif.title,
              contentType: "image/gif",
              type: "animation"
            }
          ]
        };
        elizaLogger2.log("\u2705 Sending callback with gif url:", message2);
        callback(message2);
      }
      return true;
    } catch (error) {
      debugLog.error(error);
      if (callback) {
        callback({
          text: `Error fetching gif: ${error instanceof Error ? error.message : "Unknown error"}`,
          content: {
            error: error instanceof Error ? error.message : "Unknown error"
          }
        });
      }
      return false;
    }
  },
  examples: [
    [
      // Example 1: Silly comment
      {
        user: "{{user1}}",
        content: {
          text: "Send me a gif about pudgy penguins"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Here's a pudgy penguins gif for you!",
          action: "SEND_GIF"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "https://media2.giphy.com/media/qP4CXhBeKJTbSzjNfC/giphy.gif"
        }
      }
    ]
  ]
};

// src/index.ts
var giphyPlugin = {
  name: "giphy",
  description: "Giphy Plugin for Eliza to send GIFs in responses",
  actions: [
    sendGif_default
  ],
  evaluators: [],
  providers: []
};
var index_default = giphyPlugin;
export {
  index_default as default,
  giphyPlugin
};
//# sourceMappingURL=index.js.map