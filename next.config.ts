import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1MB. Shortlist chat attachments (photos, short video clips)
    // go through sendShortlistAttachmentAction as a Server Action, so the
    // request body cap has to cover them; the action itself enforces the
    // tighter per-file limits (see MAX_ATTACHMENT_BYTES in actions.ts).
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
