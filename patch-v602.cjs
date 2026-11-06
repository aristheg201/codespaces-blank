const fs = require('node:fs');

const servicePath = 'manager/src/main/services/GithubDistributionService.ts';
const appPath = 'manager/src/renderer/src/App.tsx';
const packagePath = 'manager/package.json';

let service = fs.readFileSync(servicePath, 'utf8');
const start = service.indexOf('  async ensureRepository(preferred?: string): Promise<DistributionStatus> {');
const end = service.indexOf('\n  async publish(files: ManagedFile[]', start);
if (start < 0 || end < 0) throw new Error('Cannot locate ensureRepository block');

const replacement = `  async ensureRepository(preferred?: string): Promise<DistributionStatus> {
    const auth = await this.status();
    if (!auth.authenticated) throw new Error('Hãy kết nối GitHub trước.');

    const login = auth.login || (await this.runGh(['api', 'user', '--jq', '.login'])).stdout.trim();
    if (!login) throw new Error('Không đọc được tên tài khoản GitHub đang đăng nhập.');

    const raw = (preferred || this.settings.repository || '').trim();
    const repository = await this.normalizeRepository(raw, login);

    let repo = await this.readRepo(repository).catch(() => null);
    if (!repo) {
      this.onProgress?.({ phase: 'distribution', completed: 0, total: 1, message: \`Đang tạo \${repository}...\` });
      const create = await this.runGh(['repo', 'create', repository, '--public', '--add-readme', '--disable-issues', '--disable-wiki'], { allowFailure: true, timeoutMs: 120_000 });
      if (create.code !== 0) {
        const detail = (create.stderr || create.stdout).trim();
        throw new Error(detail ? \`Không tạo được \${repository}. \${detail}\` : \`Không tạo được \${repository}.\`);
      }
      repo = await this.readRepo(repository);
    }

    if (repo.visibility.toUpperCase() !== 'PUBLIC') throw new Error('Kho phát hành phải để Public.');
    this.settings.repository = repo.nameWithOwner;
    this.onProgress?.({ phase: 'distribution', completed: 1, total: 1, message: \`Đã kết nối \${repo.nameWithOwner}.\` });
    return { authenticated: true, login, repository: repo.nameWithOwner, repositoryPublic: true, message: \`Đã kết nối \${repo.nameWithOwner}.\` };
  }

  private async normalizeRepository(raw: string, login: string): Promise<string> {
    let value = raw.trim();
    if (!value) return \`\${login}/bestiary-distribution\`;

    if (/^https?:\\/\\/github\\.com\\//i.test(value)) {
      try {
        const url = new URL(value);
        value = url.pathname.replace(/^\\/+|\\/+$/g, '');
      } catch {
        throw new Error('Kho phát hành không hợp lệ.');
      }
    }

    value = value.replace(/^\\/+|\\/+$/g, '');
    const parts = value.split('/').filter(Boolean);
    if (parts.length === 1) return \`\${login}/\${this.validateRepositoryName(parts[0])}\`;
    if (parts.length !== 2) throw new Error('Kho phát hành chỉ cần tên repo hoặc dạng owner/repo.');

    const owner = parts[0].trim();
    const repoName = this.validateRepositoryName(parts[1]);
    if (!owner || owner.toLowerCase() === login.toLowerCase()) return \`\${login}/\${repoName}\`;

    const org = await this.runGh(['api', \`orgs/\${owner}\`, '--jq', '.login'], { allowFailure: true, timeoutMs: 20_000 });
    if (org.code === 0 && org.stdout.trim()) return \`\${org.stdout.trim()}/\${repoName}\`;

    this.onProgress?.({
      phase: 'distribution', completed: 0, total: 1,
      message: \`Đã sửa kho \${owner}/\${repoName} thành \${login}/\${repoName}.\`,
    });
    return \`\${login}/\${repoName}\`;
  }

  private validateRepositoryName(name: string): string {
    const value = name.trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/u.test(value) || value === '.' || value === '..') {
      throw new Error('Tên kho phát hành không hợp lệ.');
    }
    return value;
  }
`;

service = service.slice(0, start) + replacement + service.slice(end);
fs.writeFileSync(servicePath, service);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '6.0.2';
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

let app = fs.readFileSync(appPath, 'utf8');
app = app.replace('placeholder="Tự tạo: <username>/bestiary-distribution"', 'placeholder="bestiary-distribution"');
app = app.replace('Launcher sẽ tải manifest và object public từ kho này.', 'Kho public dùng để phát hành client.');
fs.writeFileSync(appPath, app);
