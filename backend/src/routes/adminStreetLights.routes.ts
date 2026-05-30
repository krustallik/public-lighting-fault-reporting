import { Router } from 'express';
import * as controller from '../controllers/adminStreetLights.controller.js';
import { importUpload } from '../middleware/upload.js';

const router = Router();

router.get('/', controller.list);
router.get('/export', controller.exportFile);
router.post('/import/preview', importUpload.single('file'), controller.importPreview);
router.post('/import/confirm', controller.importConfirm);
router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

export default router;
