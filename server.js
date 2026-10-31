const path = require('path'); const fs = require('fs');
const { createApp } = require('./lib/app');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
const port = process.env.PORT || 3000;
createApp(path.join(dir, 'merapaisa.db')).listen(port, '0.0.0.0', () => console.log(`MERA PAISA AI chal raha hai: http://localhost:${port}`));
