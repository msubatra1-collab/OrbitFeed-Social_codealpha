'use strict';

const { z } = require('zod');
const multer = require('multer');

const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, 'Use 3–30 letters, numbers, or underscores.');
const passwordSchema = z.string().min(10).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer.');
const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  displayName: z.string().trim().min(1).max(60),
  password: passwordSchema
});
const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be 72 UTF-8 bytes or fewer.') });
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(160).optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
  avatarKey: z.string().max(256).nullable().optional()
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
const postSchema = z.object({
  body: z.string().trim().min(1).max(500),
  imageUrl: z.string().max(2048).nullable().optional(),
  imageKey: z.string().max(256).nullable().optional()
});
const commentSchema = z.object({ body: z.string().trim().min(1).max(500) });
const listSchema = z.object({
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15)
});
const searchSchema = z.object({ q: z.string().trim().min(1).max(40), cursor: z.string().max(1024).optional(), limit: z.coerce.number().int().min(1).max(30).default(10) });

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowed.has(file.mimetype)) {
      const error = new Error('Upload a JPEG, PNG, WebP, or GIF image.');
      error.status = 415;
      error.code = 'unsupported_image';
      return callback(error);
    }
    callback(null, true);
  }
});

module.exports = { usernameSchema, registerSchema, loginSchema, profileSchema, postSchema, commentSchema, listSchema, searchSchema, imageUpload };
