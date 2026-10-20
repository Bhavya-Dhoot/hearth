import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import styles from "./LegalShell.module.css";

/** Shared frame for /privacy, /terms and the 404: editorial column, wordmark home link, honest host label. */
export function LegalShell({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} weight="bold" aria-hidden />
          <span className={styles.wordmark}>Hearth</span>
        </Link>
        <span className="label">{kicker}</span>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.foot}>
        <span className="label">Simulated Alexa+ host</span>
        <nav className={styles.links} aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}

export function Lost({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.lost}>
      <span className="label">404</span>
      <h1>{title}</h1>
      <p>{body}</p>
      <Link href="/">Back to the stage</Link>
    </div>
  );
}
