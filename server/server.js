const path = require('path');
const express = require('express');
const { initializeDatabase } = require('./database');
const { createRouter } = require('./routes');

const app = express();
const port = Number(process.env.PORT || 3000);
const webRoot = path.join(__dirname, '..', 'web');
const assetsRoot = path.join(__dirname, '..', 'assets');
const publicRoot = path.join(__dirname, '..', 'Public');

app.use(express.json({ limit: '100kb' }));
app.use('/api', createRouter());
app.use('/assets', express.static(assetsRoot));
app.use('/public', express.static(publicRoot));
app.use(express.static(webRoot));

app.get('*', (_request, response) => {
  response.sendFile(path.join(webRoot, 'index.html'));
});

initializeDatabase().finally(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`NeoGuard server running at http://localhost:${port}`);
  });
});