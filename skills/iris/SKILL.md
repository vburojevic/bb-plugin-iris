---
name: iris
description: Iris draws live, interactive UI in bb chat from ```iris blocks (JSX-style markup), ```iris-react apps (TSX with Iris's own components) and ```iris-app HTML pages. Use when writing or debugging an Iris card, checking one with iris_check or `bb iris check`, asking a rich question with iris_ask, or changing the Iris plugin's settings.
---

# Iris

Iris renders ```iris blocks in assistant replies as live UI in the person's bb theme. The full syntax and every component's props are in your instructions (the iris_* tools carry them); `bb iris docs <Name>` prints one component.

## Commands
- `bb iris check <file>`: validates a block and prints an outline of what the person will see. Exit 1 on errors.
- `bb iris components`: every component with its one-line summary.
- `bb iris docs <Name> [Name...]`: props and an example.
- `bb iris try "<prompt>"`: runs a prompt in a subthread whose agent knows Iris (works in trial rollout too).

## Settings (`bb plugin config iris`)
- `stance`: `eager` (default) shows anything that can be shown; `balanced` keeps short answers as prose.
- `rollout`: `everywhere` (default) or `trial` (only threads started with `bb iris try`), for testing beside another UI plugin.
- `workers`: teach agent-spawned threads too (off by default; it costs prompt tokens in every worker session).
Settings apply after `bb plugin reload iris`, in sessions that start afterwards.

## Limits
- load() and Snippet read only the thread's workspace and its thread storage, up to 8 MB.
- ```iris-app pages and ```iris-react apps run sandboxed with no network; window.iris.insert/send/copy/submit are the only way out, and each works only from a click.
- ```iris-react apps import only react, react-dom, lucide-react and "iris" (the kit: `bb iris docs React`). iris_check compiles them; compile and runtime errors show under the app with their line.
- iris_ask waits up to 60 minutes by default (timeoutMinutes up to 7 days).
