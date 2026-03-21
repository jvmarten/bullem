# Lessons Learned

## CFR Strategy File Size (2026-03-21)

**Problem:** The CFR strategy JSON file grows with each retraining run (more iterations = more info sets). It grew from 7.6MB → 19MB after a 5M iteration retrain. Large strategy files cause:
1. Server startup blocks the event loop during `readFileSync` + `JSON.parse`, preventing auth/socket requests
2. No compression middleware meant 19MB sent over the wire uncompressed
3. On mobile, downloading and parsing large JSON freezes the app

**Root cause pattern:** Any file that grows with training iterations needs proactive size management. This isn't a one-time fix — it recurs after every CFR retrain.

**Prevention rules:**
- After ANY CFR retrain, check the output file size. If `cfr-strategy.json` exceeds 10MB, the compact format or further compression is needed
- The compact v2 format (dictionary-encoded keys, indexed actions) reduces size by ~60%
- Express `compression` middleware must always be enabled (reduces 7MB → 1.8MB gzipped)
- Server must use `fs.promises.readFile` (never `readFileSync`) for large files to avoid blocking the event loop
- The CFR training pipeline should output the compact v2 format directly, not the verbose v1 format

**What to check after every CFR retrain:**
1. `ls -lh client/public/data/cfr-strategy.json` — should be under 10MB
2. `npm run build` — verify main bundle stays under 500KB
3. `npm test` — verify CFR eval tests still pass
4. If file grew beyond 10MB, the training script or a post-processing step must compress it to v2 format
