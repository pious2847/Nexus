const express = require('express');
const ctrl = require('../controllers/newsController');
const { authenticate, requireRole } = require('../middleware/auth');

// NOTE: The AI columns on news_articles (ai_sentiment, ai_districts, ai_event_type,
// ai_processed) are defined in the baseline migration (src/db/migrations/0000_baseline.sql).
// Ad-hoc ALTER-on-import was removed in Phase 0 Step 0.2 — schema is managed by migrations.

const router = express.Router();

router.get('/', ctrl.list);
router.get('/recent', ctrl.recent);
router.get('/crawl/status', authenticate, ctrl.crawlStatus);
router.get('/:id', ctrl.getOne);
router.post('/crawl', authenticate, requireRole('admin', 'district_officer'), ctrl.crawl);
router.delete('/purge-irrelevant', authenticate, requireRole('admin'), ctrl.purgeIrrelevant);

module.exports = router;
