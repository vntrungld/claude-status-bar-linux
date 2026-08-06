import { eq, ok } from './harness.mjs'
import { toolLabel, toolLabelShort, clawdAnim, THINKING_WORDS,
         pickThinkingWord, fmt, displayName } from '../../shared/labels.mjs'

eq(toolLabel('Edit'), 'Editing', 'Edit maps to Editing')
eq(toolLabel('Write'), 'Editing', 'Write maps to Editing')
eq(toolLabel('MultiEdit'), 'Editing', 'MultiEdit maps to Editing')
eq(toolLabel('Bash'), 'Running', 'Bash maps to Running')
eq(toolLabel('Read'), 'Reading', 'Read maps to Reading')
eq(toolLabel('Grep'), 'Searching', 'Grep maps to Searching')
eq(toolLabel('Glob'), 'Searching', 'Glob maps to Searching')
eq(toolLabel('WebFetch'), 'Browsing', 'WebFetch maps to Browsing')
eq(toolLabel('WebSearch'), 'Browsing', 'WebSearch maps to Browsing')
eq(toolLabel('Task'), 'Delegating', 'Task maps to Delegating')
eq(toolLabel('AskUserQuestion'), 'Awaiting you', 'AskUserQuestion maps to Awaiting you')
eq(toolLabel('mcp__srv__thing'), 'Using MCP', 'MCP tools collapse to one label')
eq(toolLabel('Unknown'), 'Unknown', 'unknown tools pass through')
eq(toolLabel(null), '', 'null tool is empty')

// The popup's narrower mapping, preserved exactly as it is today.
eq(toolLabelShort('mcp__srv__thing'), 'Using MCP', 'short: MCP collapses')
eq(toolLabelShort('AskUserQuestion'), 'Awaiting you', 'short: AskUserQuestion maps')
eq(toolLabelShort('Edit'), 'Edit', 'short: other tools stay raw')
eq(toolLabelShort(null), '', 'short: null tool is empty')

eq(clawdAnim('waiting', null), 'notification', 'waiting uses notification')
eq(clawdAnim('thinking', null), 'thinking', 'thinking uses thinking')
eq(clawdAnim('idle', null), 'idle', 'idle uses idle')
eq(clawdAnim('tool', 'AskUserQuestion'), 'notification', 'AskUserQuestion reads as your turn')
eq(clawdAnim('tool', 'Edit'), 'typing', 'Edit uses typing')
eq(clawdAnim('tool', 'Write'), 'typing', 'Write uses typing')
eq(clawdAnim('tool', 'MultiEdit'), 'typing', 'MultiEdit uses typing')
eq(clawdAnim('tool', 'Bash'), 'building', 'Bash uses building')
eq(clawdAnim('tool', 'Grep'), 'debugger', 'Grep uses debugger')
eq(clawdAnim('tool', 'Glob'), 'debugger', 'Glob uses debugger')
eq(clawdAnim('tool', 'Read'), 'carrying', 'Read uses carrying')
eq(clawdAnim('tool', 'Whatever'), 'typing', 'unknown tool falls back to typing')

ok(THINKING_WORDS.length > 1, 'there is more than one thinking word')
ok(THINKING_WORDS.indexOf('Brewing') === 0, 'Brewing is first')

// rand is injected, so selection is deterministic under test.
eq(pickThinkingWord('Brewing', () => 0), 'Pondering',
   'a rand landing on the current word advances past it')
eq(pickThinkingWord('Pondering', () => 0), 'Brewing',
   'a rand landing elsewhere returns that word')

eq(fmt(0), '0s', 'zero seconds')
eq(fmt(42), '42s', 'sub-minute')
eq(fmt(60), '1m 0s', 'exactly one minute')
eq(fmt(65), '1m 5s', 'over a minute')
eq(fmt(3600), '60m 0s', 'an hour stays in minutes')

eq(displayName({ alias: 'work', email: 'a@b.com' }), 'work', 'alias wins')
eq(displayName({ email: 'someone@example.com' }), 'someone', 'falls back to local-part')
eq(displayName({ email: 'nodomain' }), 'nodomain', 'email without @ passes through')
eq(displayName({}), '', 'empty account is empty string')
