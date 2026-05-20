import { describe, it, expect } from 'vitest';
import { defineAgent, defineTool, defineHandler, trigger, z } from './define.js';

describe('defineAgent', () => {
  it('가벼운 manifest 검증 통과', () => {
    const agent = defineAgent({
      name: 'jun',
      description: 'test',
      triggers: [trigger.slackMention()],
    });
    expect(agent.name).toBe('jun');
    expect(agent.version).toBe('0.1.0');
    expect(agent.tools).toEqual([]);
  });

  it('잘못된 trigger type은 throw', () => {
    expect(() =>
      defineAgent({
        name: 'jun',
        description: 'test',
        // @ts-expect-error invalid trigger
        triggers: [{ type: 'unknown.trigger' }],
      }),
    ).toThrow();
  });

  it('도구 선언 들어감', () => {
    const agent = defineAgent({
      name: 'sumi',
      description: 'with tools',
      triggers: [trigger.slackMention()],
      tools: ['slack.reply', 'telegram.send'],
    });
    expect(agent.tools).toContain('telegram.send');
  });
});

describe('defineTool', () => {
  it('도구는 메타 + run 함수 보존', async () => {
    const myTool = defineTool({
      id: 'test.add',
      name: 'Add',
      description: 'adds two numbers',
      category: 'utility',
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b };
      },
    });
    expect(myTool.id).toBe('test.add');
    const result = await myTool.run(
      { a: 1, b: 2 },
      {
        agentName: 't',
        runId: 'r1',
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        secret: () => '',
      },
    );
    expect(result.sum).toBe(3);
  });

  it('id 없으면 throw', () => {
    expect(() =>
      defineTool({
        id: '',
        name: 'x',
        description: '',
        category: 'utility',
        inputs: z.unknown(),
        outputs: z.unknown(),
        run: async () => null,
      }),
    ).toThrow();
  });
});

describe('trigger helpers', () => {
  it('slackMention 기본 OK', () => {
    expect(trigger.slackMention()).toEqual({ type: 'slack.mention' });
  });
  it('slackReaction 필수 emoji', () => {
    expect(trigger.slackReaction({ emoji: '👀' })).toEqual({
      type: 'slack.reaction_added',
      emoji: '👀',
    });
  });
  it('cron schedule', () => {
    expect(trigger.cron('0 9 * * *')).toEqual({ type: 'cron', schedule: '0 9 * * *' });
  });
});

describe('defineHandler', () => {
  it('named exports 그대로 반환', () => {
    const h = defineHandler({
      onSlackMention: async () => ({ ok: true }),
    });
    expect(typeof h.onSlackMention).toBe('function');
  });
});
