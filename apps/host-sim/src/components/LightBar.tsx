import type { Phase } from "@/lib/session";
import styles from "./LightBar.module.css";

/**
 * Alexa's light bar: a 4px brass line. Idle is a faint rule, listening pulses, thinking sweeps,
 * speaking holds steady. With reduced motion each state is a different static length/brightness.
 */
export function LightBar({ phase, variant = "line" }: { phase: Phase; variant?: "line" | "ring" }) {
  return (
    <div className={variant === "ring" ? styles.ring : styles.bar} data-phase={phase} aria-hidden>
      <span className={styles.base} />
      <span className={styles.sweep} />
    </div>
  );
}
