---
name: appstore-metadata
description: Write, rewrite, localize or fill App Store Connect metadata (app name, subtitle, keywords, promotional text, description, What's New, subscription names) for the apps in this project, using the appstore-metadata MCP server. Use when asked to fill, update, translate or optimize App Store listing text.
---

# Filling App Store metadata

Use the `appstore-metadata` MCP tools (`mcp__appstore-metadata__*`). They read and write the App Store Connect account configured in `.env`.

## Workflow

1. **Find the app**: `list_apps`, then `get_app_metadata` with the `appId`. Narrow with `locales` and `fields` when you do not need everything; descriptions are long.
2. **Check it is writable**: if `meta.editable` is `false` there is no version in an editable state, so keywords, description, promotional text and What's New cannot be written. Tell the user instead of trying.
3. **Draft** the text for each locale.
4. **Count every draft with `count_metadata`**. Do not count characters yourself: your estimate will be wrong, especially for CJK, accented text and emoji. Pass all locales in one call with `locales`. If a field is not `ok`, shorten it and count again until it is.
5. **Show the user the final text with its counts** (`27/30`) and get a go-ahead.
6. **Write** with `update_app_metadata`, one call per locale, sending only the fields that changed. It re-validates and refuses to write anything over a limit.
7. Report what was written per locale, and any locale that failed with its error.

Use `dryRun: true` on any update tool to see exactly what would be sent.

## Limits (characters, not bytes)

| Field | Max |
| --- | --- |
| name | 30 (min 2) |
| subtitle | 30 |
| keywords | 100 |
| promotionalText | 170 |
| description | 4000 |
| whatsNew | 4000 |
| subscription name | 30 |
| subscription description | 45 |
| subscription group name | 75 |
| subscription group customAppName | 30 |

## Writing rules

- **Keywords**: comma-separated, no spaces after commas, single words over phrases, no word repeated, no word that already appears in the name or subtitle (Apple indexes those already), no competitor brand names, no filler like `app`, `free`, `best`. Aim to use 95 or more of the 100 characters. `count_metadata` returns the normalized string as `value` plus `warnings`; fix every warning.
- **Name and subtitle**: use the limit, lead with the strongest search term, do not repeat words between them.
- **Localizing**: adapt, do not translate word for word. Research keywords in the target language; a translated English keyword is often not what people search. Keep the brand name unchanged. Keep URLs character for character.
- **Description**: the first three lines show before "more", so put the value there. It is not indexed for search on the App Store, so write it for people.
- Do not write `name`/`subtitle` for a locale unless the user asked: they often need a new version in review to take effect.

## Without MCP

The same counter is an HTTP endpoint when the dev server is running:

```bash
curl -s localhost:3000/api/appstore/metadata/count -H 'content-type: application/json' \
  -d '{"fields":{"name":"My App","keywords":"photo, editor"}}'
```
