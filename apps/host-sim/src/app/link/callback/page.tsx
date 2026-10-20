"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeLink } from "@/lib/auth";
import styles from "./callback.module.css";

/** Redirect target of the OAuth flow: exchanges the code for tokens in the browser (public client, PKCE). */
export default function LinkCallbackPage() {
  const router = useRouter();
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return; // the code is single-use; never exchange it twice (StrictMode runs effects twice)
    ran.current = true;
    completeLink(new URLSearchParams(window.location.search))
      .then((back) => router.replace(back))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [router]);

  return (
    <main className={styles.page}>
      <span className="label">Account linking</span>
      {error ? (
        <>
          <h1>That did not link.</h1>
          <p className={styles.problem} role="alert">
            {error}
          </p>
          <Link href="/" className={styles.back}>
            Back to the device
          </Link>
        </>
      ) : (
        <>
          <h1>Finishing the link.</h1>
          <p>Exchanging the one-time code for an access token.</p>
          <div className={styles.bar} aria-hidden />
        </>
      )}
    </main>
  );
}
