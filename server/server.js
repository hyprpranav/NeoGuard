const path = require('path');
const express = require('express');
const { initializeDatabase } = require('./database');
const { createRouter } = require('./routes');

const app = express();
const port = Number(process.env.PORT || 3000);
const webRoot = path.join(__dirname, '..', 'web');
const assetsRoot = path.join(__dirname, '..', 'assets');
const publicRoot = path.join(__dirname, '..', 'Public');

const rootDir = path.join(__dirname, '..');

app.use(express.json({ limit: '100kb' }));
app.use('/api', createRouter());
app.use('/assets', express.static(assetsRoot));
app.use('/public', express.static(publicRoot));
app.use('/web', express.static(webRoot));

app.get(['/', '/index.html'], (_request, response) => {
  response.sendFile(path.join(rootDir, 'index.html'));
});

app.get(['/video', '/video/', '/video.html'], (_request, response) => {
  response.sendFile(path.join(rootDir, 'video.html'));
});

app.get(['/simulation', '/simulation/', '/simulation.html'], (_request, response) => {
  response.sendFile(path.join(rootDir, 'simulation.html'));
});

app.get(['/auth', '/auth/', '/auth.html'], (_request, response) => {
  response.sendFile(path.join(rootDir, 'auth.html'));
});

app.get(['/admin', '/admin/', '/admin.html'], (_request, response) => {
  response.sendFile(path.join(rootDir, 'admin.html'));
});

app.get(['/dashboard', '/dashboard/', '/web/index.html'], (_request, response) => {
  response.sendFile(path.join(webRoot, 'index.html'));
});

app.use(express.static(rootDir));

app.get('*', (request, response) => {
  const filePath = path.join(rootDir, request.path);
  if (require('fs').existsSync(filePath)) {
    return response.sendFile(filePath);
  }
  response.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`NeoGuard server running at http://localhost:${port}`);
});

initializeDatabase().catch((err) => {
  console.warn('Database initialization warning:', err.message);
});