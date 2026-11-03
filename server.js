import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import nodemailer from 'nodemailer';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');

const dataDirectory = path.join(__dirname, 'data');
const uploadDirectory = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(uploadDirectory, { recursive: true });
const database = new Database(path.join(dataDirectory, 'makerspace.db'));
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')),
    verified INTEGER NOT NULL DEFAULT 0,
    verification_hash TEXT,
    verification_expires INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file_name TEXT,
    original_name TEXT,
    drive_url TEXT,
    kind TEXT NOT NULL DEFAULT 'resource',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL DEFAULT '',
    asked_by INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    link TEXT,
    author_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'published')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
for (const statement of [
  'ALTER TABLE resources ADD COLUMN drive_url TEXT',
  "ALTER TABLE resources ADD COLUMN kind TEXT NOT NULL DEFAULT 'resource'"
]) {
  try { database.exec(statement); } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}
try {
  database.exec('ALTER TABLE questions ADD COLUMN asked_by INTEGER');
} catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const existingAdmin = database.prepare('SELECT id FROM users WHERE email = ?').get(process.env.ADMIN_EMAIL);
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    database.prepare(`
      INSERT INTO users (name, email, password_hash, role, verified, created_at)
      VALUES (?, ?, ?, 'admin', 1, ?)
    `).run('Club Admin', process.env.ADMIN_EMAIL, passwordHash, Date.now());
  }
}
if (process.env.MEMBER_EMAIL && process.env.MEMBER_PASSWORD) {
  const memberEmail = process.env.MEMBER_EMAIL.trim().toLowerCase();
  const passwordHash = bcrypt.hashSync(process.env.MEMBER_PASSWORD, 12);
  const existingMember = database.prepare('SELECT id, role FROM users WHERE email = ?').get(memberEmail);
  if (!existingMember) {
    database.prepare(`
      INSERT INTO users (name, email, password_hash, role, verified, created_at)
      VALUES (?, ?, ?, 'member', 1, ?)
    `).run('Makerspace Member', memberEmail, passwordHash, Date.now());
  } else if (existingMember.role === 'member') {
    database.prepare(`
      UPDATE users
      SET password_hash = ?, verified = 1, verification_hash = NULL, verification_expires = NULL
      WHERE id = ?
    `).run(passwordHash, existingMember.id);
  }
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(__dirname, { index: 'index.html' }));

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
}) : null;

const createToken = (user) => jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '7d' });
const sendToken = (response, user) => response.cookie('session', createToken(user), {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000
});
const requireAuth = (request, response, next) => {
  const token = request.cookies.session;
  if (!token) return response.status(401).json({ error: 'You must be signed in.' });
  try {
    request.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
};
const requireAdmin = (request, response, next) => {
  if (request.user?.role !== 'admin') return response.status(403).json({ error: 'Admin access is required.' });
  next();
};
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, verified: Boolean(user.verified) });
const drivePreviewUrl = (url) => {
  if (!url) return null;
  const fileMatch = url.match(/\/file\/d\/([^/]+)/);
  const queryId = url.match(/[?&]id=([^&]+)/);
  const id = fileMatch?.[1] || queryId?.[1];
  return id ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}` : url;
};

app.post('/api/auth/signup', async (request, response) => {
  const { name, email, password } = request.body;
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return response.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return response.status(409).json({ error: 'An account with that email already exists.' });
  const code = String(crypto.randomInt(100000, 1000000));
  const passwordHash = await bcrypt.hash(password, 12);
  const verificationHash = await bcrypt.hash(code, 10);
  const result = database.prepare(`
    INSERT INTO users (name, email, password_hash, verification_hash, verification_expires, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name.trim(), normalizedEmail, passwordHash, verificationHash, Date.now() + 15 * 60 * 1000, Date.now());
  if (!mailer) {
    if (process.env.DEV_VERIFICATION === 'false') {
      return response.status(503).json({ error: 'Email delivery is not configured. Add SMTP settings or set DEV_VERIFICATION=true for local testing.' });
    }
    console.log(`[DEV VERIFICATION] ${normalizedEmail}: ${code}`);
    return response.status(201).json({ message: 'Account created. Check the server terminal for your development verification code.', userId: result.lastInsertRowid });
  }
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM,
      to: normalizedEmail,
      subject: 'Your Makerspace Club verification code',
      text: `Your verification code is ${code}. It expires in 15 minutes.`
    });
  } catch (error) {
    database.prepare('DELETE FROM users WHERE id = ?').run(result.lastInsertRowid);
    console.error('Verification email failed:', error);
    return response.status(502).json({ error: 'The verification email could not be sent. Check your SMTP settings.' });
  }
  return response.status(201).json({ message: 'Account created. Check your email for the verification code.', userId: result.lastInsertRowid });
});

app.post('/api/auth/verify', async (request, response) => {
  const { email, code } = request.body;
  const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email?.trim().toLowerCase());
  if (!user || !user.verification_hash || !user.verification_expires || user.verification_expires < Date.now()) {
    return response.status(400).json({ error: 'That verification code is invalid or expired.' });
  }
  if (!(await bcrypt.compare(String(code), user.verification_hash))) {
    return response.status(400).json({ error: 'That verification code is invalid or expired.' });
  }
  database.prepare('UPDATE users SET verified = 1, verification_hash = NULL, verification_expires = NULL WHERE id = ?').run(user.id);
  sendToken(response, user);
  return response.json({ user: publicUser({ ...user, verified: 1 }) });
});

app.post('/api/auth/login', async (request, response) => {
  const user = database.prepare('SELECT * FROM users WHERE email = ?').get(request.body.email?.trim().toLowerCase());
  if (!user || !(await bcrypt.compare(request.body.password || '', user.password_hash))) {
    return response.status(401).json({ error: 'Email or password is incorrect.' });
  }
  if (!user.verified) {
    return response.status(403).json({
      error: 'Please verify your email before signing in.',
      verificationRequired: true,
      email: user.email
    });
  }
  sendToken(response, user);
  return response.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (request, response) => response.clearCookie('session').json({ message: 'Signed out.' }));
app.get('/api/auth/me', requireAuth, (request, response) => {
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);
  if (!user) return response.status(401).json({ error: 'Account not found.' });
  return response.json({ user: publicUser(user) });
});

app.get('/api/resources', requireAuth, (request, response) => {
  const resources = database.prepare('SELECT id, title, description, original_name, drive_url, kind, created_at FROM resources ORDER BY created_at DESC').all();
  response.json({ resources });
});
app.get('/api/gallery', (request, response) => {
  const photos = database.prepare("SELECT id, title, description, original_name, drive_url, created_at FROM resources WHERE kind = 'photo' ORDER BY created_at DESC").all();
  response.json({ photos: photos.map((photo) => ({ ...photo, image_url: drivePreviewUrl(photo.drive_url) })) });
});
app.get('/api/resources/:id/download', requireAuth, (request, response) => {
  const resource = database.prepare('SELECT * FROM resources WHERE id = ?').get(request.params.id);
  if (!resource) return response.status(404).json({ error: 'Resource not found.' });
  if (resource.drive_url) return response.redirect(resource.drive_url);
  if (!resource.file_name) return response.status(404).json({ error: 'This resource has no file or Google Drive link.' });
  return response.download(path.join(uploadDirectory, resource.file_name), resource.original_name);
});

const upload = multer({ dest: uploadDirectory, limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/admin/resources', requireAuth, requireAdmin, upload.single('file'), (request, response) => {
  if (!request.body.title?.trim() || (!request.file && !request.body.driveUrl?.trim())) {
    return response.status(400).json({ error: 'A title and Google Drive link are required.' });
  }
  if (request.body.driveUrl?.trim()) {
    try {
      const driveUrl = new URL(request.body.driveUrl.trim());
      if (driveUrl.protocol !== 'https:' || !driveUrl.hostname.endsWith('google.com')) throw new Error('invalid');
    } catch {
      return response.status(400).json({ error: 'Use a valid HTTPS Google Drive link.' });
    }
  }
  const result = database.prepare(`
    INSERT INTO resources (title, description, file_name, original_name, drive_url, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(request.body.title.trim(), request.body.description?.trim() || '', request.file?.filename || '', request.file?.originalname || 'Google Drive link', request.body.driveUrl?.trim() || null, request.body.kind === 'photo' ? 'photo' : 'resource', Date.now());
  response.status(201).json({ id: result.lastInsertRowid });
});
app.delete('/api/admin/resources/:id', requireAuth, requireAdmin, (request, response) => {
  const resource = database.prepare('SELECT file_name FROM resources WHERE id = ?').get(request.params.id);
  if (!resource) return response.status(404).json({ error: 'Resource not found.' });
  if (resource.file_name) fs.rmSync(path.join(uploadDirectory, resource.file_name), { force: true });
  database.prepare('DELETE FROM resources WHERE id = ?').run(request.params.id);
  response.json({ message: 'Resource deleted.' });
});
app.get('/api/admin/members', requireAuth, requireAdmin, (request, response) => {
  response.json({ members: database.prepare('SELECT id, name, email, role, verified, created_at FROM users ORDER BY created_at DESC').all() });
});
app.get('/api/admin/stats', requireAuth, requireAdmin, (request, response) => {
  const members = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const upcomingEvents = 4;
  response.json({ members, upcomingEvents });
});
app.delete('/api/admin/members/:id', requireAuth, requireAdmin, (request, response) => {
  if (Number(request.params.id) === Number(request.user.id)) return response.status(400).json({ error: 'You cannot remove your own admin account.' });
  const member = database.prepare('SELECT id FROM users WHERE id = ?').get(request.params.id);
  if (!member) return response.status(404).json({ error: 'Member not found.' });
  database.prepare('DELETE FROM users WHERE id = ?').run(request.params.id);
  response.json({ message: 'Member removed.' });
});
app.get('/api/questions', requireAuth, (request, response) => {
  const questions = request.user.role === 'admin'
    ? database.prepare('SELECT * FROM questions ORDER BY created_at DESC').all()
    : database.prepare('SELECT * FROM questions WHERE asked_by = ? ORDER BY created_at DESC').all(request.user.id);
  response.json({ questions });
});
app.get('/api/builds', requireAuth, (request, response) => {
  const builds = request.user.role === 'admin'
    ? database.prepare(`SELECT builds.*, users.name AS author_name FROM builds JOIN users ON users.id = builds.author_id ORDER BY builds.created_at DESC`).all()
    : database.prepare(`SELECT builds.*, users.name AS author_name FROM builds JOIN users ON users.id = builds.author_id WHERE builds.author_id = ? OR builds.status = 'published' ORDER BY builds.created_at DESC`).all(request.user.id);
  response.json({ builds });
});
app.post('/api/builds', requireAuth, (request, response) => {
  if (!request.body.title?.trim() || !request.body.description?.trim()) {
    return response.status(400).json({ error: 'A project title and description are required.' });
  }
  const result = database.prepare(`
    INSERT INTO builds (title, description, link, author_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(request.body.title.trim(), request.body.description.trim(), request.body.link?.trim() || null, request.user.id, Date.now());
  response.status(201).json({ id: result.lastInsertRowid, message: 'Build submitted for review.' });
});
app.patch('/api/admin/builds/:id', requireAuth, requireAdmin, (request, response) => {
  database.prepare('UPDATE builds SET status = ? WHERE id = ?').run(request.body.status === 'published' ? 'published' : 'pending', request.params.id);
  response.json({ message: 'Build status updated.' });
});
app.delete('/api/admin/builds/:id', requireAuth, requireAdmin, (request, response) => {
  database.prepare('DELETE FROM builds WHERE id = ?').run(request.params.id);
  response.json({ message: 'Build removed.' });
});
app.post('/api/questions', requireAuth, (request, response) => {
  if (!request.body.question?.trim()) return response.status(400).json({ error: 'Question text is required.' });
  const result = database.prepare('INSERT INTO questions (question, answer, asked_by, created_at) VALUES (?, ?, ?, ?)').run(request.body.question.trim(), '', request.user.id, Date.now());
  response.status(201).json({ id: result.lastInsertRowid });
});
app.post('/api/admin/questions', requireAuth, requireAdmin, (request, response) => {
  if (!request.body.question?.trim()) return response.status(400).json({ error: 'Question text is required.' });
  const result = database.prepare('INSERT INTO questions (question, answer, created_at) VALUES (?, ?, ?)').run(request.body.question.trim(), request.body.answer?.trim() || '', Date.now());
  response.status(201).json({ id: result.lastInsertRowid });
});
app.patch('/api/admin/questions/:id', requireAuth, requireAdmin, (request, response) => {
  database.prepare('UPDATE questions SET question = ?, answer = ? WHERE id = ?').run(request.body.question?.trim(), request.body.answer?.trim() || '', request.params.id);
  response.json({ message: 'Question updated.' });
});
app.delete('/api/admin/questions/:id', requireAuth, requireAdmin, (request, response) => {
  database.prepare('DELETE FROM questions WHERE id = ?').run(request.params.id);
  response.json({ message: 'Question deleted.' });
});

app.use('/api', (request, response) => response.status(404).json({ error: 'API route not found. Restart the Node server.' }));
app.listen(port, () => console.log(`Makerspace Club running at http://localhost:${port}`));
