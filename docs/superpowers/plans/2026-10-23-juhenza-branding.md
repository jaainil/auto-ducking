# Juhenza branding implementation plan

**Goal:** Make AudioDuck's free, open-source identity and JUHENZA ownership clear, and direct prospective clients to Juhenza.

**Approved design:** Preserve the white-and-blue identity and upload-first flow. Add attribution, GitHub access, a dedicated client-work section, metadata and responsive styling. User approved this direction on October 23, 2026.

**Architecture:** React homepage additions and scoped CSS; no new dependencies or changes to media processing.

**Tasks**
- [x] Update Home.tsx with free/open-source messaging, JUHENZA attribution, repository access and a client enquiry section using verified service and contact URLs.
- [x] Style the additions for desktop/mobile and keyboard focus. Update index.html metadata and document the ownership in README.md and DESIGN.md.
- [x] Run the production build, existing browser checks and the Impeccable detector. Inspect desktop and mobile captures together and resolve material defects in one pass.

**Constraints:** No fabricated results, testimonials, client claims or license terms. Use https://github.com/jaainil/auto-ducking for source and https://juhenza.com/contact for enquiries. Preserve the existing editor and upload behavior.

**Review focus:** Small-screen navigation wrapping; CTA contrast and focus; working destination URLs; unchanged empty upload state; no assertion of an unchosen license.

Verification: production build and desktop/mobile upload-state checks passed. Impeccable detector returned no findings. Inspected both layouts and confirmed mobile navigation in the final capture. Fixed the existing browser-check HTML MIME type and image-loading wait. License selection remains with the owner.
