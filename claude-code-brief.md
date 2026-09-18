# The Shelf — project brief

Paste this whole file into Claude Code as your first message, with `collection.json` in the same folder.

---

## What I want

I'm a UX/UI designer learning to code. I have a working prototype of a vinyl collection app and I want to rebuild it properly so I own the code and the data. I want to understand what you're doing as you go — explain decisions, don't just produce output.

Build a personal vinyl record collection app. `collection.json` in this folder is my real data: 11 records. Use it as the seed and as the shape of the data model.

## The two moments it has to serve

These are different jobs and they should not be the same screen.

**At a record show** — one-handed, fast, under pressure, possibly bad signal:
1. Search: do I already own this?
2. If not, is it on my want list?
3. What's a fair price for the copy in my hand, given its condition?
4. If I buy it, photograph the sleeve and log it on the spot.

**At home** — browsing, no urgency:
Pick a genre by mood, look at covers, choose something to play.

## Data model

Every record: `artist`, `title`, `label`, `catalog`, `year`, `format` (pressing), `genre`, `grade` (the disc), `sleeveGrade`, `rating` (0–5, how much I love it), `price` (what I paid — usually unknown, keep it minor), `valueLow` / `valueHigh` (fair price range), `valueNote`, `notes`, `coverId` (photo), `addedAt`.

Also needed: a **want list** (records I'm hunting) and an **upgrade list** (records I own but want a better copy of — a real third state, not a want and not settled).

## Fixed decisions — please don't re-litigate these

These came out of using the prototype. They're settled.

- **Genres are exactly these nine**, in this order: Jazz / big band, Rock, Pop / soul / contemporary, Popular pop, Miscellaneous, Country, Reggae, Soundtracks, Christmas. Genre is a dropdown defaulting to "All", not a row of chips — there are too many for chips.
- **Grading uses the Goldmine scale**: Sealed, M, NM, VG+, VG, G+, G, P. Disc and sleeve are graded separately. Remember VG means *worn*, not good — the UI should make that clear.
- **Colour encodes whatever the current filter is asking.** Viewing all genres: the colour bar is the genre. Filtered to Jazz: the bar switches to the record *label* (Impulse! orange, Blue Note blue, Argo purple) because I'm curious whether I'm drifting toward a label. Other genres don't have a sub-dimension yet.
- **Artist reads first, then the record title**, then year / label / catalog.
- **Price paid is deliberately unimportant.** I don't know it for most of my collection. It must never be a required field or a headline number. The price range and condition matter; what I paid does not.
- **Reference material lives at the point of decision**, not at the top of the app. Grading help sits inside the condition control; pricing help sits inside the price check.
- Rows read like **spines in a crate** — a colour bar, then text — not like cards.

## The price check

The most useful feature. Each record has a fair price range. I enter what a seller is asking and see where it falls: under market / fair / overpriced, with a plain-English verdict.

**Improve on the prototype:** the range should shift with condition. A VG copy is worth roughly half an NM one, so I should pick the grade of the copy in my hand and have the range adjust before comparing.

## Stack

I'm new to coding. Prefer boring and readable over clever. Suggest a stack and explain the trade-offs before you build — I'd rather understand three choices than be handed one.

Needs: works on my phone (add-to-home-screen is fine, no App Store), stores data somewhere I control, holds cover photos, and eventually lets my wife sign in and see the same collection. Free tiers are fine. Offline at record shows matters.

## Please do

- Set up git from the first commit, and commit in small steps.
- Explain what each file is for as you create it.
- Use visual analogies when you explain concepts — I'm a very visual thinker.
- Tell me when I'm asking for something that's a bad idea.
- Fail loudly rather than silently. If a script can't find what it's editing, it should stop, not write garbage. (I've been bitten by this already.)

## Please don't

- Don't add features I didn't ask for.
- Don't build a tracklist field — Discogs has that and it's a lot of typing for something I'll never read.
- Don't try to fetch album art off the internet. It's copyrighted. I photograph my own covers.
- Don't promise live price syncing unless the app can genuinely call an API. A stale number is worse than no number.

## Start here

Before writing any code: read `collection.json`, then tell me what you understand the app to be, what stack you'd pick and why, and what you'd build first. Wait for me to agree before you build.
