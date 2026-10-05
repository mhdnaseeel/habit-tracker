# ADR-0002: Use the approved terracotta, evergreen, cream and sage palette

**Date:** 2026-10-05
**Status:** accepted
**Decider:** product owner

## Context

The UI/UX PRD proposed a dark background and teal accent. The product owner later specified a different palette. The later explicit instruction governs the implementation without altering the original PRD.

## Decision

Use `#B9674B` as the primary accent, `hsl(161 25% 19%)` as the sidebar, `hsl(42 44% 96%)` as the background, and `#668C72` for progress. The exact HSL cream value computes to about `#F9F7F0`; the supplied `#FAF3F0` was labelled approximate. Text and focus use darker supporting tones where needed for contrast. Terracotta buttons use `#121212` text, about 4.55:1. Small terracotta text on cream would be about 3.84:1, so use darker `#93462E` for it.

## Alternatives considered

The PRD's teal/dark scheme conflicts with the product owner's later instruction. Using terracotta for all text fails normal-text contrast on cream. The supporting dark terracotta is used only where required for readability.

## Consequences

The core visual tokens now reflect the approved palette. Full responsive, keyboard and screen-reader validation remains necessary for each product screen. This decision supersedes the colour-specific statement in ADR-0001; other ADR-0001 decisions remain in force.
