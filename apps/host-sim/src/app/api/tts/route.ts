import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { awsRegion, hasAwsCredentials } from "@/server/orchestrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let polly: PollyClient | null = null;

/**
 * POST { text } -> audio/mpeg from Amazon Polly (neural, "Ruth") when the server has AWS credentials.
 * Otherwise 204: the browser falls back to its own speech synthesis and the UI says which voice it used.
 */
export async function POST(req: Request) {
  if (!hasAwsCredentials()) return new Response(null, { status: 204 });
  let text = "";
  try {
    text = String(((await req.json()) as { text?: unknown }).text ?? "").trim();
  } catch {
    return new Response("Body must be JSON.", { status: 400 });
  }
  if (!text) return new Response(null, { status: 204 });
  try {
    polly ??= new PollyClient({ region: awsRegion() });
    const out = await polly.send(
      new SynthesizeSpeechCommand({
        Engine: "neural",
        OutputFormat: "mp3",
        VoiceId: (process.env.HEARTH_POLLY_VOICE ?? "Ruth") as never,
        Text: text.slice(0, 1500),
        TextType: "text",
      }),
    );
    const bytes = await out.AudioStream?.transformToByteArray();
    if (!bytes?.length) return new Response(null, { status: 204 });
    return new Response(Buffer.from(bytes), { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return new Response(null, { status: 204, headers: { "x-tts-error": e instanceof Error ? e.message.slice(0, 200) : "polly failed" } });
  }
}
