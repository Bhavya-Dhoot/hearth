import tokens from "../tokens.json";
import { cssText } from "./css";

/** C7 - design tokens. Widgets and host consume these; no hard-coded colours or fonts elsewhere. */
export { tokens, cssText };
export type Tokens = typeof tokens;
