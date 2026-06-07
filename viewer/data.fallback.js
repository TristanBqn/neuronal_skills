// OpenClaw plugin dataset
// usage: 0..1   files: list of filenames   desc: short blurb
// Connections are bidirectional weights 0..1 (communication frequency)

window.PLUGINS = [
  {
    id: 'memory-lancedb',
    name: 'Memory · LanceDB',
    short: 'memory',
    usage: 0.96,
    desc: 'Vector memory store backed by LanceDB. Semantic recall, long-term context.',
    files: ['index.ts', 'lance_store.ts', 'embed.ts', 'schema.ts', 'query.ts', 'persist.ts', 'reindex.ts', 'cache.ts'],
  },
  {
    id: 'project-mgmt',
    name: 'Project Management',
    short: 'projects',
    usage: 0.88,
    desc: 'Tasks, milestones and cross-tool project state.',
    files: ['index.ts', 'tasks.ts', 'milestones.ts', 'sync.ts', 'graph.ts', 'reminders.ts', 'export.ts'],
  },
  {
    id: 'code-search',
    name: 'Code Search',
    short: 'code',
    usage: 0.81,
    desc: 'AST-aware code lookup across the workspace.',
    files: ['index.ts', 'ripgrep.ts', 'ast.ts', 'rank.ts', 'symbols.ts', 'workspace.ts', 'cache.ts'],
  },
  {
    id: 'browser',
    name: 'Browser',
    short: 'browser',
    usage: 0.74,
    desc: 'Headless browser session, page extraction and form fills.',
    files: ['index.ts', 'session.ts', 'extract.ts', 'screenshot.ts', 'form.ts', 'navigate.ts', 'cookies.ts'],
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    short: 'fs',
    usage: 0.71,
    desc: 'Sandboxed read/write across the project tree.',
    files: ['index.ts', 'read.ts', 'write.ts', 'glob.ts', 'watch.ts', 'permissions.ts'],
  },
  {
    id: 'notes-md',
    name: 'Notes · Markdown',
    short: 'notes',
    usage: 0.62,
    desc: 'Markdown notebook with bidirectional links and tags.',
    files: ['index.ts', 'parse.ts', 'links.ts', 'tags.ts', 'render.ts', 'frontmatter.ts', 'export.ts'],
  },
  {
    id: 'web-search',
    name: 'Web Search',
    short: 'search',
    usage: 0.58,
    desc: 'Live web search with provider fallback and ranking.',
    files: ['index.ts', 'providers.ts', 'rank.ts', 'cache.ts', 'parse.ts'],
  },
  {
    id: 'git-vcs',
    name: 'Git · VCS',
    short: 'git',
    usage: 0.42,
    desc: 'Repository state, diffs and commit synthesis.',
    files: ['index.ts', 'status.ts', 'diff.ts', 'commit.ts', 'log.ts', 'blame.ts', 'remote.ts'],
  },
  {
    id: 'shell-exec',
    name: 'Shell · Exec',
    short: 'shell',
    usage: 0.28,
    desc: 'Sandboxed command execution with output capture.',
    files: ['index.ts', 'spawn.ts', 'capture.ts', 'limits.ts', 'env.ts'],
  },
  {
    id: 'calendar',
    name: 'Calendar',
    short: 'calendar',
    usage: 0.18,
    desc: 'ICS read & schedule analysis.',
    files: ['index.ts', 'ics.ts', 'schedule.ts', 'tz.ts'],
  },
  {
    id: 'email',
    name: 'Email · IMAP',
    short: 'email',
    usage: 0.0,
    desc: 'Inactive. IMAP bridge — never invoked in the current session.',
    files: ['index.ts', 'imap.ts', 'parse.ts', 'send.ts', 'threads.ts', 'attachments.ts'],
  },
  {
    id: 'slack-bridge',
    name: 'Slack Bridge',
    short: 'slack',
    usage: 0.0,
    desc: 'Inactive. Slack workspace bridge — currently disabled.',
    files: ['index.ts', 'auth.ts', 'channels.ts', 'messages.ts', 'webhook.ts'],
  },
];

// Connections: [a, b, weight 0..1, coUses]
// weight  → line thickness / emphasis (communication frequency)
// coUses  → number of times the two were invoked together. Drives the pulse
//           animation: `coUses` pulses travel the link per 45s loop, directed
//           from the more-used skill toward its complement.
window.LINKS = [
  // memory is the central hub
  ['memory-lancedb', 'project-mgmt', 0.92, 58],
  ['memory-lancedb', 'notes-md',     0.88, 51],
  ['memory-lancedb', 'code-search',  0.78, 44],
  ['memory-lancedb', 'browser',      0.55, 33],
  ['memory-lancedb', 'web-search',   0.62, 42],
  ['memory-lancedb', 'filesystem',   0.48, 28],

  // project mgmt cross-talk
  ['project-mgmt', 'notes-md',       0.72, 39],
  ['project-mgmt', 'calendar',       0.35, 21],
  ['project-mgmt', 'filesystem',     0.30, 12],
  ['project-mgmt', 'git-vcs',        0.42, 19],

  // code / fs / git triangle
  ['code-search', 'filesystem',      0.84, 47],
  ['code-search', 'git-vcs',         0.66, 35],
  ['filesystem',  'git-vcs',         0.78, 41],
  ['code-search', 'shell-exec',      0.30, 11],
  ['shell-exec',  'git-vcs',         0.36, 14],
  ['shell-exec',  'filesystem',      0.24, 8],

  // browser ↔ web-search
  ['browser', 'web-search',          0.90, 55],
  ['browser', 'filesystem',          0.22, 7],
  ['web-search', 'notes-md',         0.30, 12],

  // notes
  ['notes-md', 'filesystem',         0.55, 24],

  // dead links — drawn but unused
  ['email', 'calendar',              0.0, 0],
  ['email', 'slack-bridge',          0.0, 0],
];
