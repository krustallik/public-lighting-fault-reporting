import multer from 'multer';
import { AppError } from '../utils/AppError.js';

const ALLOWED_MIMES = new Set([
  'text/csv',
  'application/csv',
  'application/json',
  'application/geo+json',
  'text/plain',
]);

export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const allowedExt =
      name.endsWith('.csv') ||
      name.endsWith('.json') ||
      name.endsWith('.geojson');

    if (ALLOWED_MIMES.has(file.mimetype) || allowedExt) {
      cb(null, true);
      return;
    }
    cb(new AppError(400, 'Only CSV, JSON, or GeoJSON files are allowed'));
  },
});
