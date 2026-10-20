import { notFound } from "next/navigation";
import { LegalShell } from "@/components/legal/LegalShell";
import { Markdown } from "@/components/Markdown";
import { readRepoDoc } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms | Hearth" };

export default async function TermsPage() {
  const source = await readRepoDoc("TERMS.md");
  if (source === null) notFound();
  return (
    <LegalShell kicker="Terms">
      <Markdown source={source} />
    </LegalShell>
  );
}
