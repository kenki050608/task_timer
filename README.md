# task_timer

Two apps live in this repo, both static and offline-capable (PWA):

- `index.html` — the daily study tracker (Eigo Mimi / Studysapuri / Shadowing / Speaking / Writing).
- `words/index.html` — a vocabulary app for the 500 business English words, each with an example
  sentence. Answers are typed or spoken (Web Speech API), never picked from a list, in both
  directions: EN→JA (say/write the meaning) and JA→EN (say/write the word), plus flashcards
  and example-sentence cloze. Spaced repetition (Leitner boxes), speech playback, search,
  stats, and JSON export/import.
  Word data is generated into `words/words-data.js` from the source word list.

