import { LegalShell, Lost } from "@/components/legal/LegalShell";

export default function NotFound() {
  return (
    <LegalShell kicker="Not found">
      <Lost title="Nothing is filed under that address." body="The page you asked for does not exist on this host, or the document behind it has not been added to the repository yet." />
    </LegalShell>
  );
}
