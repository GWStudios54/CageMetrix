# Fighter photography

The checked-in `public/headshots.json` maps CageMetrix fighter slugs to real portraits from UFC's public athlete directory and individual athlete pages. Each entry retains the source name and profile URL. Photos are served from UFC's image host, lazy-loaded in the rankings, and credited on fighter profiles. CageMetrix does not generate likenesses or substitute another fighter's photo when one is missing. Initials remain visible when an image is missing or its host is unavailable.

The September 3, 2026 inventory covers all **709 active fighters** and **2,146 of 2,693 total database entries**. The remaining **547 historical entries** have no unambiguous usable photo in the checked UFC sources. `headshot-coverage.json` lists every gap explicitly; these entries still use initials. This is complete active-roster coverage, not complete historical coverage.

Run `npm run photos:sync` to rebuild the mapping. The script follows UFC's directory pagination, joins exact normalized names/slugs, checks individual profiles when directory photos are absent, and applies only the reviewed aliases in `scripts/headshot-overrides.json`. Its local response cache is ignored by Git. Use `npm run photos:sync -- .cache/headshots --refresh` to fetch fresh source pages.

## Bruno Silva source identity needs correction

The existing CageMetrix `bruno-silva` record identifies the current division as Flyweight and the last bout as June 6, 2026, matching UFC's [Bruno “Bulldog” Silva profile](https://www.ufc.com/athlete/bruno-silva). Its date of birth (July 13, 1989), height (six feet), and 23-bout combined sample are inconsistent with that flyweight identity and appear to include [Bruno “Blindado” Silva](https://www.ufc.com/athlete/bruno-silva-blindado).

The photo override follows the displayed current Flyweight identity. It does not repair the combined underlying record. Correcting this requires separating the two fighters by stable source IDs through ingestion and recalculation; name-only joins in the existing dataset/model should be addressed before treating this fighter's rating as reliable. No rating/model changes are included in this UI and photography update.
