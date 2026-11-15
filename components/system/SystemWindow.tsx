/** Glass "System window": cyan glow border, scanlines, mono `[HEADER]`. */
type Tone = 'system' | 'gold' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  system: 'sys-window',
  gold: 'sys-window sys-window--gold',
  danger: 'sys-window sys-window--danger',
};

export function SystemWindow({
  title,
  tone = 'system',
  aside,
  className = '',
  children,
}: {
  title?: string;
  tone?: Tone;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${TONE_CLASS[tone]} ${className}`}>
      {title && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="sys-header">[{title}]</h2>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
