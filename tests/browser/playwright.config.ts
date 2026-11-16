import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.ts',
	fullyParallel: true,
	use: { baseURL: 'http://127.0.0.1:5187', headless: true, trace: 'retain-on-failure' },
	webServer: {
		command: 'pnpm exec vite --config tests/browser/vite.config.ts',
		cwd: fileURLToPath(new URL('../..', import.meta.url)),
		url: 'http://127.0.0.1:5187',
		reuseExistingServer: !process.env.CI,
	},
});
