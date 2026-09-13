# Daleelak Social Dashboard

Dashboard for **دليلك البنكي** based on the supplied Figma direction.

## Current build

- Arabic RTL dashboard
- Sidebar navigation
- Drafts / Scheduled / Published / Failed KPI cards
- Content queue
- Create Post composer
- Facebook / Instagram / TikTok / X selection
- Opens the three generators from `banks.1.2`
- Receives generated poster + caption using `window.postMessage`
- Saves posts in `localStorage` for the first version

## Generator bridge

The bank generator sends:

```ts
window.opener?.postMessage({
  type: "DALEELAK_SOCIAL_POST",
  source: "certificates" | "deposits" | "treasury",
  title: "...",
  caption: "...",
  image: "data:image/png;base64,..."
}, "*");
```

The next integration step is to add a **Send to Social Dashboard** button to the three existing poster clients in `banks.1.2`, immediately after poster generation. The dashboard is already listening for this event.
