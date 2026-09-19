import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures';
import { MOCK_LLM_URL, seedAgentFixture } from './seed';

const errors: string[] = [];

function sse(chunks: unknown[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): unknown {
  return { id: 'chatcmpl-e2e', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

/** First call: one register_character tool call. Second call (after the tool result): a closing sentence. */
function mockCompletions(calls: Array<{ body: unknown }>) {
  return async (route: Route) => {
    const body = route.request().postDataJSON() as { messages: unknown[]; tools?: unknown[] };
    calls.push({ body });
    const toolResultSeen = body.messages.some((message) => (message as { role?: string }).role === 'tool');
    const payload = toolResultSeen
      ? sse([chunk({ role: 'assistant', content: 'Registered 1 characters.' }, null), chunk({}, 'stop')])
      : sse([
          chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'register_character', arguments: '' } }] }, null),
          chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ name: 'Hero', summary: 'A tall farm hand.' }) } }] }, null),
          chunk({}, 'tool_calls'),
        ]);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: payload });
  };
}

async function openFixtureProject(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'E2E Fixture', exact: true }).click();
  await expect(page.locator('.project-phase-sidebar')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await seedAgentFixture(page);
});

test.afterEach(() => {
  expect(errors, 'no console/page errors').toEqual([]);
});

test('read book, then find characters through the mocked endpoint', async ({ page }) => {
  const calls: Array<{ body: unknown }> = [];
  await page.route(MOCK_LLM_URL, mockCompletions(calls));
  await openFixtureProject(page);

  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const readBook = page.locator('.project-top-bar-read-book');
  await expect(readBook).toBeEnabled();
  await readBook.click();
  await expect(page.locator('.pi-task-panel .pi-task-state-label')).toHaveText('Done');
  await expect(readBook).toBeDisabled();
  expect(calls).toHaveLength(0);

  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Find characters', exact: true }).click();
  await expect(page.locator('.pi-task-panel .pi-task-state-label').last()).toHaveText('Done', { timeout: 15_000 });
  await expect(page.getByText('Hero', { exact: true }).first()).toBeVisible();
  expect(calls).toHaveLength(2);
  const first = calls[0].body as { messages: Array<{ role: string; content: unknown }>; tools: Array<{ function: { name: string } }> };
  expect(first.tools.map((tool) => tool.function.name).sort()).toEqual(['list_characters', 'register_character']);
  expect(first.messages[0].role).toBe('system');
  const bookMessage = JSON.stringify(first.messages[1].content);
  expect(bookMessage).toContain('<book>');
  expect(bookMessage).toContain('Hero, a tall farm hand');

  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const findSession = page.locator('.agent-dashboard-session-item', { hasText: 'Find characters' });
  await expect(findSession).toHaveCount(1);
  await findSession.click();
  await expect(page.locator('.pi-trace-tool-label').first()).toContainText('register_character');
});
