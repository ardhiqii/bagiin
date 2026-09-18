/**
 * BrandLogo: shows the official payment-brand logo, or a coloured name chip when
 * the brand has no logo / the image fails to load.
 *
 * Ported from the legacy `brandLogoHtml` + `upgradeBrandChips` behaviour: legacy
 * painted a chip first and swapped in the logo once the manifest landed, and an
 * <img onerror> downgraded back to the chip. In React the manifest is loaded once
 * before rows render, so a row shows the logo immediately, and the error path
 * still degrades to the chip rather than an empty box.
 */
import { useEffect, useState } from "react";

import { brandColor, brandLabel, brandLogoUrl, chipTextColor, loadBrandLogos } from "../lib/brand-logos";

/** Load the logo manifest once for the whole app. */
export function useBrandLogos(): number {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    void loadBrandLogos().then(() => { if (active) setGeneration(value => value + 1); });
    return () => { active = false; };
  }, []);
  return generation;
}

export function BrandLogo({ code }: { code: string }) {
  const generation = useBrandLogos();
  const [failed, setFailed] = useState(false);
  // generation is read so a late manifest load re-renders the row
  void generation;

  const label = brandLabel(code);
  const url = brandLogoUrl(code);
  const hex = brandColor(code);

  if (!url || failed) {
    return (
      <span
        className="brand-chip"
        data-code={code}
        style={{ background: hex, color: chipTextColor(hex) }}
        title={label}
      >
        {label}
      </span>
    );
  }

  return (
    <span className="brand-logo" data-code={code} title={label}>
      <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}
