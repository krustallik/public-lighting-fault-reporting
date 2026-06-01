import { Router } from 'express';
import {
  handleReportUploadError,
  sendReport,
} from '../controllers/reports.controller.js';
import { reportUpload } from '../middleware/reportUpload.js';

const router = Router();

router.post('/send', (req, res, next) => {
  reportUpload.array('files[]', 5)(req, res, (err) => {
    if (err) {
      handleReportUploadError(err, req, res, next);
      return;
    }
    void sendReport(req, res, next);
  });
});

export default router;
