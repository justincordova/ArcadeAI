// Minimal document-head manager — sets <title> and a known set of meta
// tags, returning a cleanup function that restores the previous values.
// Used by routes that want correct unfurls / tab titles without
// pulling in react-helmet or @tanstack/react-meta-tags.
//
// Trade-off: this only runs in the browser, so social-media unfurl
// scrapers (Twitter, Facebook, Discord) that don't execute JS won't
// see these values. For those, the API route /api/og/:slug.png
// provides a server-rendered image that any future SSR'd HTML route
// can reference; the meta tags here help the in-browser tab and
// JS-aware preview generators.

interface HeadMeta {
  title?: string;
  description?: string;
  /** Absolute URL — the og:image scraper needs absolute, not relative. */
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
}

function setMetaTag(attr: "name" | "property", key: string, value: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (value === undefined) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

export function setDocumentHead(meta: HeadMeta): () => void {
  const previousTitle = document.title;
  const previous: Record<string, string | null> = {};

  function snapshot(attr: "name" | "property", key: string) {
    const el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    previous[`${attr}:${key}`] = el ? el.getAttribute("content") : null;
  }

  snapshot("name", "description");
  snapshot("property", "og:image");
  snapshot("property", "og:title");
  snapshot("property", "og:description");
  snapshot("property", "og:url");
  snapshot("name", "twitter:card");
  snapshot("name", "twitter:image");

  if (meta.title !== undefined) document.title = meta.title;
  setMetaTag("name", "description", meta.description);
  setMetaTag("property", "og:image", meta.ogImage);
  setMetaTag("property", "og:title", meta.ogTitle ?? meta.title);
  setMetaTag("property", "og:description", meta.ogDescription ?? meta.description);
  setMetaTag("property", "og:url", meta.ogUrl);
  // Twitter mirrors og:* automatically when a card is set; default to
  // summary_large_image so the unfurl uses the 16:9 thumbnail.
  if (meta.ogImage) {
    setMetaTag("name", "twitter:card", "summary_large_image");
    setMetaTag("name", "twitter:image", meta.ogImage);
  }

  return () => {
    document.title = previousTitle;
    for (const [combo, value] of Object.entries(previous)) {
      const [attr, key] = combo.split(":") as ["name" | "property", string];
      if (value === null) {
        // The tag did not exist before; remove ours.
        setMetaTag(attr, key, undefined);
      } else {
        setMetaTag(attr, key, value);
      }
    }
  };
}
