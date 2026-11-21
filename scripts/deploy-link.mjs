import fs from 'node:fs';
const name = process.argv[2] || process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(name || '')) {
  console.error('请传入 GitHub 仓库，例如 npm run prepare:github -- owner/repo');
  process.exit(1);
}
const readme = new URL('../README.md', import.meta.url);
const text = fs.readFileSync(readme, 'utf8').replace(/https:\/\/render\.com\/deploy\?repo=[^\s)]+/,
  'https://render.com/deploy?repo=https://github.com/' + name);
fs.writeFileSync(readme, text);
