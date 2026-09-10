import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { OkfVaultParser } from './parser.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

// Parse CLI argument for --vault=/path or environment variable
let vaultPath = process.env.VAULT_PATH;
for (const arg of process.argv) {
  if (arg.startsWith('--vault=')) {
    vaultPath = arg.replace('--vault=', '').trim();
  }
}

if (!vaultPath) {
  vaultPath = path.resolve(process.cwd(), 'sample_vault');
} else {
  vaultPath = path.resolve(vaultPath);
}

const parser = new OkfVaultParser(vaultPath);

app.use(cors());
app.use(express.json());

// Serve static frontend assets
const publicDir = path.resolve(process.cwd(), 'src/public');
app.use(express.static(publicDir));

// Serve media from vault if requested
app.use('/media', express.static(vaultPath));

// API: Graph Data
app.get(['/api/graph', '/api/okf-graph'], (req, res) => {
  try {
    const data = parser.parseVault();
    res.json(data);
  } catch (err: any) {
    console.error('❌ [API Error] Failed to parse vault:', err);
    res.status(500).json({ error: 'Failed to parse vault', details: err.message });
  }
});

// API: Quick Stats
app.get('/api/stats', (req, res) => {
  try {
    const data = parser.parseVault();
    res.json({
      vaultPath,
      ...data.stats
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// Fallback to visualizer index.html
app.get('*', (req, res) => {
  const indexHtml = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(404).send('Visualizer index.html not found.');
  }
});

app.listen(PORT, () => {
  console.log(`
=====================================================
🌌 OKF 3D GALAXY VISUALIZER
=====================================================
• Running on port:  ${PORT}
• Local URL:        http://localhost:${PORT}
• Mounted Vault:    ${vaultPath}
=====================================================
`);
});
