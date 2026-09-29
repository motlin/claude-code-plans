import { createContext, type ReactNode, useContext, useId } from "react";

/*
 * Settings section and row anatomy copied from claude.ai/code: an h3 at
 * 22/28 weight 580 over `settings-group-dividers` rows. Each row is a
 * role=group labelled by its title and described by its description, with the
 * control column (data-settings-control) on the right, gap-lg (24px) apart and
 * py-md (12px) with hairline dividers between rows.
 */

interface SettingsRowIds {
  titleId: string;
  descriptionId: string | undefined;
}

const SettingsRowContext = createContext<SettingsRowIds | null>(null);

/** The enclosing row's title/description ids, so controls can label themselves. */
export function useSettingsRowIds(): SettingsRowIds | null {
  return useContext(SettingsRowContext);
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 last:mb-0">
      <h3 className="text-[22px] leading-[28px] font-[580] text-primary">{title}</h3>
      <div className="divide-y divide-subtle">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  slug: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Extra content under the description (warnings, notes). */
  footnote?: ReactNode;
  className?: string;
}

export function SettingsRow({
  slug,
  title,
  description,
  children,
  footnote,
  className,
}: SettingsRowProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = description === undefined ? undefined : `${baseId}-description`;

  return (
    <SettingsRowContext.Provider value={{ titleId, descriptionId }}>
      <div
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-settings-row={slug}
        className={`flex items-center justify-between gap-6 py-3 ${className ?? ""}`}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div id={titleId} className="text-body text-primary">
            <span className="settings-row-title inline-block align-top">{title}</span>
          </div>
          {description === undefined ? null : (
            <div
              id={descriptionId}
              data-settings-desc=""
              className="text-body text-[var(--settings-muted)]"
            >
              {description}
            </div>
          )}
          {footnote}
        </div>
        {children === undefined ? null : (
          <div data-settings-control="" className="flex shrink-0 items-center">
            {children}
          </div>
        )}
      </div>
    </SettingsRowContext.Provider>
  );
}
