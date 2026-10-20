"use client";

/* ------------------------------------------------------------------------------------------------
 * Speech in: the Web Speech API (SpeechRecognition). Chrome and Edge ship it; Firefox does not, and
 * in Chromium it streams audio to a vendor service, which is why the UI says so next to the mic.
 * ---------------------------------------------------------------------------------------------- */

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const sttSupported = () => recognitionCtor() !== null;

export type Listener = {
  /** Stop capturing and deliver what was heard so far as a final result. */
  stop(): void;
  /** Throw the audio away. */
  abort(): void;
};

export type ListenHandlers = {
  onStart(): void;
  /** the user began speaking: the barge-in moment */
  onSpeech(): void;
  onInterim(text: string): void;
  onFinal(text: string): void;
  onEnd(): void;
  onError(code: string, message: string): void;
};

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked for this page.",
  "service-not-allowed": "This browser will not run speech recognition for this page.",
  "no-speech": "Nothing was heard.",
  "audio-capture": "No microphone was found.",
  network: "The browser's speech service could not be reached.",
  "language-not-supported": "English speech recognition is not available here.",
};

export function listen(h: ListenHandlers): Listener | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let delivered = false;
  let heard = "";
  rec.onstart = () => h.onStart();
  rec.onspeechstart = () => h.onSpeech();
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]!;
      text += r[0].transcript;
      if (r.isFinal) final = true;
    }
    heard = text.trim();
    if (final && !delivered) {
      delivered = true;
      h.onFinal(heard);
    } else if (!final) h.onInterim(heard);
  };
  rec.onerror = (e) => {
    if (e.error === "aborted") return;
    h.onError(e.error, ERRORS[e.error] ?? `Speech recognition stopped (${e.error}).`);
  };
  rec.onend = () => {
    if (!delivered && heard) {
      delivered = true;
      h.onFinal(heard);
    }
    h.onEnd();
  };
  try {
    rec.start();
  } catch {
    h.onError("start-failed", "Speech recognition could not start.");
    return null;
  }
  return { stop: () => rec.stop(), abort: () => rec.abort() };
}

/* ------------------------------------------------------------------------------------------------
 * Speech out: Amazon Polly neural "Ruth" through /api/tts when the server has AWS credentials,
 * otherwise the browser's speechSynthesis. Cancelling is always available (barge-in).
 * ---------------------------------------------------------------------------------------------- */

export type VoiceEngine = "polly" | "browser" | "none";

export class Speaker {
  engine: VoiceEngine = "none";
  private pollyUnavailable = false;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private finish: (() => void) | null = null;
  private token = 0;

  constructor(private readonly onSpeaking: (speaking: boolean, engine: VoiceEngine) => void) {}

  /** Resolves when the line has been spoken or cut off. Never rejects. */
  async speak(text: string): Promise<void> {
    this.cancel();
    const mine = ++this.token;
    const clean = text.trim();
    if (!clean) return;

    if (!this.pollyUnavailable) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (mine !== this.token) return; // barged in while the audio was rendering
        if (res.status === 200) {
          const blob = await res.blob();
          if (mine !== this.token) return;
          if (await this.play(blob, mine)) return;
        } else {
          this.pollyUnavailable = true;
        }
      } catch {
        this.pollyUnavailable = true;
      }
    }
    if (mine !== this.token) return;
    await this.browserSpeak(clean, mine);
  }

  cancel() {
    this.token++;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.settle();
  }

  private settle() {
    const f = this.finish;
    this.finish = null;
    this.onSpeaking(false, this.engine);
    f?.();
  }

  private play(blob: Blob, mine: number): Promise<boolean> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      this.url = url;
      this.engine = "polly";
      this.finish = () => resolve(true);
      audio.onended = () => {
        if (mine === this.token) this.cleanup();
      };
      audio.onerror = () => {
        if (mine === this.token) {
          this.cleanup();
        }
      };
      audio
        .play()
        .then(() => this.onSpeaking(true, "polly"))
        .catch(() => {
          // autoplay policy: no user gesture yet. Fall through to the caption-only path.
          this.finish = null;
          this.cleanup();
          resolve(false);
        });
    });
  }

  private cleanup() {
    this.audio = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.settle();
  }

  private browserSpeak(text: string, mine: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === "undefined") {
        this.engine = "none";
        resolve();
        return;
      }
      this.engine = "browser";
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 1;
      const voices = speechSynthesis.getVoices();
      const pick =
        voices.find((v) => /ruth|jenny|aria|samantha|zira|google us english/i.test(v.name) && v.lang.startsWith("en")) ??
        voices.find((v) => v.lang === "en-US");
      if (pick) u.voice = pick;
      this.finish = resolve;
      const done = () => {
        if (mine === this.token) this.settle();
      };
      u.onstart = () => this.onSpeaking(true, "browser");
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
    });
  }
}
