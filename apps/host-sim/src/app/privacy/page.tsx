import { notFound } from "next/navigation";
import { LegalShell } from "@/components/legal/LegalShell";
import { Markdown } from "@/components/Markdown";
import { readRepoDoc } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy | Hearth" };

export default async function PrivacyPage() {
  const source = await readRepoDoc("PRIVACY.md");
  if (source === null) notFound();
  return (
    <LegalShell kicker="Privacy">
      <Markdown source={source} />
    </LegalShell>
  );
}
