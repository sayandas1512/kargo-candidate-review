import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: false,
  preview: {
    // AI Gateway is not used. All AI calls go to the Gemini API.
    // aiGateway: true,
  },
});
