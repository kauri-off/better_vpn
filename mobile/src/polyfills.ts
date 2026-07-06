// Connect-ES on React Native needs TextEncoder/TextDecoder and, for its
// gRPC-Web response parsing, a ReadableStream implementation. All PanelService
// RPCs are unary, so this is the whole story — no server streaming to worry
// about. The fetch itself is supplied per-transport in api/client.ts
// (react-native-fetch-api with textStreaming), not swapped globally.
import { ReadableStream } from "web-streams-polyfill";

const g = globalThis as Record<string, unknown>;

// Recent Hermes provides TextEncoder/TextDecoder natively; only fall back to
// the native react-native-fast-encoder module when it doesn't (that module is
// not part of Expo Go, so requiring it unconditionally would break Go).
if (typeof g.TextEncoder === "undefined" || typeof g.TextDecoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const encoder = require("react-native-fast-encoder") as {
    TextEncoder: typeof globalThis.TextEncoder;
    TextDecoder: typeof globalThis.TextDecoder;
  };
  if (typeof g.TextEncoder === "undefined") g.TextEncoder = encoder.TextEncoder;
  if (typeof g.TextDecoder === "undefined") g.TextDecoder = encoder.TextDecoder;
}

if (typeof g.ReadableStream === "undefined") g.ReadableStream = ReadableStream;
