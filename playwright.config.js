import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30_000,
    expect: { timeout: 7_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: "http://127.0.0.1:4173",
        headless: true,
        viewport: { width: 1280, height: 800 },
    },
    webServer: {
        command: "rm -f /tmp/vetrelci-stanice-e2e.sqlite && DB_PATH=/tmp/vetrelci-stanice-e2e.sqlite .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/",
        reuseExistingServer: false,
        timeout: 30_000,
    },
});
