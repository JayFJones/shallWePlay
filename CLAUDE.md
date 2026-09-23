# How we work here

Read this first. It is the whole agreement.

## Write like a person, not like a model

The unslop rules apply to everything you write: replies, comments, commit
messages, documents. They are not a skill to invoke. They are the baseline.

The ones that matter most here:

- No em dashes. Use a period or a comma.
- No AI vocabulary: additionally, crucial, delve, enhance, foster, garner,
  intricate, landscape, pivotal, showcase, tapestry, testament, underscore,
  vibrant. Use plain words.
- No "not just X, but Y". Say the point.
- No fancy ways to say "is": serves as, stands as, boasts, features.
- Sentence case headings. No decorative emoji. Straight quotes.
- No chatbot filler: "I hope this helps", "Let me know if", "Certainly".
- No sycophancy. No "Great question".
- Active voice. Name the actor.
- Cut adverbs or use a stronger verb.
- One idea per sentence. Split a sentence the reader has to re-read.
- Say what a thing does, not how it feels. If a sentence could appear
  unchanged in another project's documents, it says nothing. Cut it.

The full list is in the unslop skill. Run `/unslop` on anything you want
cleaned after the fact.

## How to report

Three things, in this order, every time:

1. What you did.
2. Whether it worked, with the evidence.
3. What I do now.

Short sentences. If tests failed, say so and show the output. If you skipped
something, say that. Do not hedge when a thing is done and checked.

## When you need a decision from me

Two options. Not five. Give me the context to choose fast, put your pick
first, and say it is your pick. If there is an obvious default, take it and
tell me you did rather than asking.

## Doing the work

- Do the whole task. Report finished only when it is finished.
- If part of it is blocked, do the rest and tell me exactly what you left.
- Commit each step, with a message that says why rather than what.
- Do not add documents, changelogs, coverage passes or formatting runs that
  I did not ask for.
- Do not widen the scope. If you spot something worth doing, say so in a
  line and carry on with what I asked.

## Checks run on this machine

All checks are local. No cloud CI, no GitHub Actions. GitHub is storage and
history, nothing else.

One command runs everything, and git hooks call the same command. If a check
cannot run locally with free tools, it does not go in.

## Comments and documents

Comments explain **why**, not what. The code already says what. A comment
that repeats the line above it is noise, and a comment that records the bug
which caused the line is worth its space.

Design decisions go in a living plan document, written when the decision is
made and not after. Record the decision, the reason, and what it gives up.

## Files stay small on purpose

A file that holds the state a feature needs is the file every feature lands
in, and that is how one file becomes four thousand lines. Watched files get
a line budget, checked by the same local command as everything else. Over
budget means one of two things, both fine:

1. Split something out and lower the number in the same commit.
2. Decide the file earned the room and raise the number, with a line saying
   why.

Doing neither, quietly, is the thing the budget exists to stop.

## Before you do something hard to undo

Ask first. Deleting, overwriting, pushing to a shared place, anything
outward facing. Approval for one of those is not approval for the next one.
