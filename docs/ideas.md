# Ideas for later

Captured so they aren't lost. Not in any plan yet.

## Opening: the shelf fills up (2026-09-19)

The first screen is the shelf itself. On load, realistic record spines slide in and fill the shelf from one side to the other. When the screen is full, "The Shelf" drops into the centre, then the sign-in screen comes in over it. The spines stay behind as the background, with the shelf and sign-in in the foreground.

Fits with: Plan 2 (sign-in screen). Notes for when we design it:
- Spines could be drawn from the person's real records once signed in; before sign-in, a generative set in the genre colours.
- Motion must respect reduced-motion (fade straight to the filled shelf) and must not delay sign-in on repeat opens (play fully once, shorten after).

## Your shelf sections (2026-11-12)

Kahrman: "The categories I have are because on my shelf I have those little separators… They should be able to match their physical shelf sections with their in app shelf sections." Some people use few dividers and combine genres; others use many.

So the nine genres are really **Kahrman's shelf dividers**, not a fixed list for everyone. The idea:
- Each shelf defines its own **sections**: name, order, colour. Both members of a shared shelf see the same sections.
- Each section lists which **Discogs genres/styles** go into it, so a record found through Discogs lands in the right section automatically.
- Sections can be added, renamed, reordered and merged. Merging moves the records.
- The colour rule (spine bar = section colour; label colours inside Jazz) needs rethinking per section.

Fits with: before friends get their own shelves (original spec, Project 3). It touches the database (`genre` enum → per-shelf sections), the genre filter, spine colours, the poster's colours, Add/Edit, Bought it, and the Discogs mapping.
Prepared for in Plan 4a build 2a: the Discogs → section mapping is a small table, so it can become per-shelf data later.
