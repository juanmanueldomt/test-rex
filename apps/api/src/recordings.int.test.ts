import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  scenarioTeam,
  type Harness,
  type Loose,
  type ScenarioTeam,
} from './testing/harness';

let container: StartedPostgreSqlContainer;
let harness: Harness;
let team: ScenarioTeam;
let clock = new Date('2026-11-03T10:00:00Z');

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await harness?.close();
  await container?.stop();
});

beforeEach(async () => {
  await harness?.close();
  clock = new Date('2026-11-03T10:00:00Z');
  harness = await createHarness(container, { now: () => clock });
  team = await scenarioTeam(harness);
});

async function start() {
  const res = await team.editor.post(`${team.chk}/recordings`, {
    startUrl: 'https://shop.example.com',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Loose;
}

describe('recording sessions', () => {
  it('start a session for the worker and accept input from its owner only', async () => {
    const session = await start();
    expect(session).toMatchObject({
      status: 'starting',
      startUrl: 'https://shop.example.com',
      steps: [],
      frameVersion: 0,
      viewport: { width: 1280, height: 720 },
      canDrive: true,
      createdBy: { name: 'Ana Editor' },
    });
    expect(harness.jobs.sent).toEqual([
      {
        queue: 'recordings.session',
        payload: { organizationId: expect.any(String), sessionId: session.id },
      },
    ]);
    const url = `${team.chk}/recordings/${session.id}`;
    const click = await team.editor.post(`${url}/commands`, { type: 'click', x: 10, y: 20 });
    expect(click.status).toBe(202);
    expect(click.body).toEqual({ pendingCommands: 1 });
    const invalid = await team.editor.post(`${url}/commands`, { type: 'click', x: -1, y: 0 });
    expect(invalid.status).toBe(400);
    expect(
      (await team.editor2.post(`${url}/commands`, { type: 'press', key: 'Tab' })).body.code,
    ).toBe('RECORDING_NOT_OWNER');
    expect((await team.viewer.post(`${url}/commands`, { type: 'press', key: 'Tab' })).status).toBe(
      403,
    );
    const watched = await team.viewer.get(url);
    expect(watched.body).toMatchObject({ canDrive: false, pendingCommands: 1 });
    expect((await team.editor.get(`${team.pay}/recordings/${session.id}`)).status).toBe(404);
  });

  it('serves the latest frame', async () => {
    const session = await start();
    const url = `${team.chk}/recordings/${session.id}`;
    expect((await team.viewer.get(`${url}/frame`)).status).toBe(404);
    await harness.superPool.query(
      `UPDATE recording_sessions SET frame = $2, frame_version = 1, status = 'active' WHERE id = $1`,
      [session.id, Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    );
    const frame = await team.viewer.get(`${url}/frame`);
    expect(frame.headers['content-type']).toBe('image/jpeg');
    expect(frame.headers['cache-control']).toBe('private, no-store');
    expect([...frame.raw]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it('stops a session the worker has not started, and expires silent sessions', async () => {
    const first = await start();
    const stopped = await team.editor.post(`${team.chk}/recordings/${first.id}/stop`);
    expect(stopped.body.status).toBe('stopped');
    const ended = await team.editor.post(`${team.chk}/recordings/${first.id}/commands`, {
      type: 'stop',
    });
    expect(ended.body.code).toBe('RECORDING_ENDED');

    const second = await start();
    clock = new Date(clock.getTime() + 7 * 60 * 1000);
    const expired = await team.editor.get(`${team.chk}/recordings/${second.id}`);
    expect(expired.body).toMatchObject({
      status: 'expired',
      canDrive: false,
      error: 'The recorder did not start. Is the worker running?',
    });
  });
});
