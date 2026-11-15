export function SampleNotice({ what }: { what: string }) {
  return (
    <p className="mb-4 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 font-mono text-[11px] tracking-wider text-gold">
      SAMPLE DATA · {what} API not connected yet
    </p>
  );
}
