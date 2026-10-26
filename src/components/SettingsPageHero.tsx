import type { ReactNode } from "react";

/** 设置页统一头图（10-24）：四张「外观与体验」页共用，先一句话说清这页能做什么。 */
export function SettingsPageHero({ icon, title, subtitle, hint }: { icon: ReactNode; title: string; subtitle: string; hint?: string }) {
  return (
    <header className="settings-exp-hero">
      <span className="settings-exp-hero-icon">{icon}</span>
      <div className="settings-exp-hero-copy">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {hint && <span className="settings-exp-hero-hint">{hint}</span>}
    </header>
  );
}
