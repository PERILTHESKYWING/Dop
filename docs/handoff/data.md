# Game data
Summary: what datasets exist, their licences and gaps, so nobody re-researches them.

- Fox amateur + pro (featurecat/go-dataset, GPL-3.0, ≤2019): rank anchor; only statistics are shipped.
- Pro games 1940-2017 (yenw/computer-go-dataset), plus its AI folders; 73,519 games power `public/pro/openings.json`.
- OGS 2013 to 2025-05 via za3k.com/ogs (public domain); `scripts/ogs-recent.py` keeps 2022+ games, OGS ranks mapped onto Fox, 2022+ weighted 2x.
- cwi.nl Japanese title games; katagoarchive.org (rating games, self-play NPZ). Use katagoarchive, not katagotraining.org, for bulk.
- Gaps: no free bulk human archive after 2025-05; don't scrape OGS's API. Fox/Tygem/KGS after 2019 not public. go4go/GoGoD are paid.
- The cloud sandbox reaches GitHub but not katagotraining.org, OGS or 101weiqi; Actions runners can.
